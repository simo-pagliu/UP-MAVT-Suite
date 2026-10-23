"""Tests for the offline export bundle scripts (frontend/public/load_LOCAL.py and
main.py) on data laid out exactly like the Suite export writes it: a comma input.csv
with an is_qi row, semicolon-separated per-session CSVs, and JSON settings.

main.py computes every step with scripts/workflow_steps.py, the worker's own code,
so these tests cover what is specific to the bundle: the loading, the step options
it passes (which must match the web app's Run page) and its outputs."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from scripts.session_inputs import (
    build_alternatives_with_qualitative,
    build_comparisons_from_session,
    build_value_functions_from_session,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
OFFLINE_DIR = REPO_ROOT / 'frontend' / 'public'
# In the bundle these scripts sit next to scripts/; here worker/ (conftest) provides it.
if str(OFFLINE_DIR) not in sys.path:
    sys.path.insert(0, str(OFFLINE_DIR))

import load_LOCAL  # noqa: E402

_spec = importlib.util.spec_from_file_location('offline_main', OFFLINE_DIR / 'main.py')
offline_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(offline_main)

INPUT_CSV = 'Alternative,Cost,Quality\nis_qi,FALSE,TRUE\nA,100,\nB,200,\n'
SESSIONS = {
    'expert_1': {
        'value_functions.csv': 'CRITERION_NAME;CONFIDENCE;LIST OF POINTS\n'
                               'Cost;3;"100.0:1.0;150.0:0.5;200.0:0.0"\n'
                               'Quality;4;"0.0:0.0;1.0:1.0"\n',
        'qualitative_indicators.csv': 'CRITERION_NAME;ALTERNATIVE;RANK;VALUE;CONFIDENCE\n'
                                      'Quality;A;0;0.9;4\nQuality;B;1;0.2;4\n',
        'bwt_comparisons.csv': 'REFERENCE_CRITERION;ADJUSTED_CRITERION;DATA_VALUE;TYPE;GROUP\n'
                               'Quality;Cost;150.5;best;G1\n',
        'practitioner_settings.json': {'overall_weight': 3.0,
                                       'confidence_adjustments': {'overall': -1.0, 'vf': 0.0, 'qi': 0.0}},
    },
    'expert_2': {
        'value_functions.csv': 'CRITERION_NAME;CONFIDENCE;LIST OF POINTS\n'
                               'Cost;4;"100.0:1.0;200.0:0.0"\n',
        'qualitative_indicators.csv': 'CRITERION_NAME;ALTERNATIVE;RANK;VALUE;CONFIDENCE\n'
                                      'Quality;A;1;0.3;4\nQuality;B;0;0.8;4\n',
        'bwt_comparisons.csv': 'REFERENCE_CRITERION;ADJUSTED_CRITERION;DATA_VALUE;TYPE;GROUP\n'
                               'Quality;Cost;120;best;G1\n',
        'practitioner_settings.json': {'overall_weight': 1.0},
    },
}
SETTINGS = {'use_non_linear_model': False, 'phase3_tolerance_pct': 2.5,
            'weight_space_parameters': {'max_results': 3, 'max_restarts': 10}}
AGGREGATION = {
    'chosen_method': 'weighted_power_mean',
    'compared_methods': ['weighted_sum', 'weighted_power_mean', 'geometric_mean_offset'],
    'alphas': {'weighted_power_mean': 0.3, 'geometric_mean_offset': 0.6},
}
WEIGHTS = {'expert_1': [{'Cost': 0.4, 'Quality': 0.6}], 'expert_2': [{'Cost': 0.5, 'Quality': 0.5}]}


def write_bundle_data(root, input_csv=INPUT_CSV, settings=SETTINGS):
    data_dir = root / 'data'
    data_dir.mkdir()
    (data_dir / 'input.csv').write_text(input_csv, encoding='utf-8')
    if settings is not None:
        (data_dir / 'settings.json').write_text(json.dumps(settings), encoding='utf-8')
    for session, files in SESSIONS.items():
        session_dir = data_dir / session
        session_dir.mkdir()
        for name, content in files.items():
            text = json.dumps(content) if name.endswith('.json') else content
            (session_dir / name).write_text(text, encoding='utf-8')
    return str(data_dir)


def load_sessions(data_dir, names=('expert_1', 'expert_2')):
    return [load_LOCAL.load_session_data(data_dir, name) for name in names]


@pytest.fixture()
def data_dir(tmp_path):
    return write_bundle_data(tmp_path)


@pytest.fixture()
def criteria(data_dir):
    return load_LOCAL.load_input_data(data_dir)['criteria']


class TestLoading:
    def test_reads_semicolon_value_functions(self, data_dir, criteria):
        vfs = build_value_functions_from_session(load_LOCAL.load_session_data(data_dir, 'expert_1'), criteria)
        assert set(vfs) == {'Cost', 'Quality'}
        assert vfs['Cost'](150) == pytest.approx(0.5)

    def test_reads_semicolon_comparisons(self, data_dir):
        comparisons = build_comparisons_from_session(load_LOCAL.load_session_data(data_dir, 'expert_1'))
        assert comparisons == [{'REFERENCE_CRITERION': 'Quality', 'ADJUSTED_CRITERION': 'Cost',
                                'DATA_VALUE': 150.5, 'TYPE': 'best', 'GROUP': 'G1'}]

    def test_is_qi_row_marks_qualitative_criteria(self, data_dir):
        input_data = load_LOCAL.load_input_data(data_dir)
        assert [c['is_qualitative'] for c in input_data['criteria']] == [False, True]
        assert set(input_data['alternatives']) == {'A', 'B'}  # the is_qi row is not an alternative

    def test_older_exports_infer_qualitative_criteria_from_rankings(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, input_csv='Alternative,Cost,Quality\nA,100,\nB,200,\n')
        criteria = load_LOCAL.load_input_data(data_dir)['criteria']
        assert [c['is_qualitative'] for c in criteria] == [False, True]

    def test_practitioner_confidence_adjustment_is_loaded(self, data_dir, criteria):
        session = load_LOCAL.load_session_data(data_dir, 'expert_1')
        _, confidences = build_value_functions_from_session(session, criteria, return_confidence=True)
        assert confidences == {'Cost': 2.0, 'Quality': 4}  # 3 + overall -1; qualitative VF stays 4

    def test_each_session_fills_its_own_qualitative_values(self, data_dir, criteria):
        expert_1, expert_2 = load_sessions(data_dir)
        alternatives_1, _ = build_alternatives_with_qualitative(
            {'criteria': criteria}, expert_1['qualitative_indicators'], expert_1['practitioner_settings'])
        alternatives_2, _ = build_alternatives_with_qualitative(
            {'criteria': criteria}, expert_2['qualitative_indicators'], expert_2['practitioner_settings'])
        # expert_1's practitioner lowered all confidences by 1 (4 -> 3 = ±2.5%)
        assert alternatives_1['A']['Quality'] == '0.9 ± 2.5%'
        assert alternatives_2['A']['Quality'] == 0.3
        assert alternatives_1['A']['Cost'] == '100'


class TestSessionSelection:
    def test_uses_the_web_app_selection_in_its_order(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, settings={**SETTINGS, 'sessions': ['expert_2', 'expert_1']})
        assert load_LOCAL.select_sessions(data_dir) == (['expert_2', 'expert_1'], True)

    def test_leaves_out_sessions_not_selected_in_the_web_app(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, settings={**SETTINGS, 'sessions': ['expert_2']})
        assert load_LOCAL.select_sessions(data_dir) == (['expert_2'], True)

    def test_older_exports_use_every_session(self, data_dir):
        assert load_LOCAL.select_sessions(data_dir) == (['expert_1', 'expert_2'], False)

    def test_missing_selected_folders_fall_back_to_every_session(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, settings={**SETTINGS, 'sessions': ['deleted']})
        assert load_LOCAL.select_sessions(data_dir) == (['expert_1', 'expert_2'], False)


class TestWeightSettings:
    def test_reads_settings_json(self, data_dir):
        assert load_LOCAL.load_analysis_settings(data_dir) == SETTINGS

    def test_falls_back_to_exported_computed_weights(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, settings=None)
        (tmp_path / 'weights').mkdir()
        (tmp_path / 'weights' / 'computed_weights.json').write_text(
            json.dumps({'phase3_tolerance_pct': 4.0, 'use_non_linear_model': True, 'weight_solutions': {}}),
            encoding='utf-8')
        settings = load_LOCAL.load_analysis_settings(data_dir)
        assert settings['phase3_tolerance_pct'] == 4.0

    def test_defaults_match_the_web_app(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, settings=None)
        assert load_LOCAL.load_analysis_settings(data_dir) == load_LOCAL.DEFAULT_ANALYSIS_SETTINGS

    def test_step_1_passes_the_study_settings_to_the_worker_code(self, data_dir, criteria, tmp_path, monkeypatch):
        calls = []

        def fake_compute_session_weights(session_doc, session_criteria, **kwargs):
            calls.append((session_doc['name'], kwargs))
            return {'accepted_solutions': [{'Cost': 0.4, 'Quality': 0.6}]}

        monkeypatch.setattr(offline_main, 'compute_session_weights', fake_compute_session_weights)
        weights = offline_main.step_1_compute_weights(
            data_dir, str(tmp_path / 'results'), load_sessions(data_dir), criteria)

        assert weights == {'expert_1': [{'Cost': 0.4, 'Quality': 0.6}], 'expert_2': [{'Cost': 0.4, 'Quality': 0.6}]}
        name, kwargs = calls[0]
        assert name == 'expert_1'
        assert kwargs['use_non_linear_model'] is False
        assert kwargs['phase3_tolerance_pct'] == 2.5
        assert kwargs['weight_space_parameters'] == SETTINGS['weight_space_parameters']

    def test_step_1_skips_a_session_whose_weights_fail_like_the_worker(
            self, data_dir, criteria, tmp_path, monkeypatch):
        def fake_compute_session_weights(session_doc, session_criteria, **kwargs):
            if session_doc['name'] == 'expert_2':
                raise ValueError('No feasible solution')
            return {'accepted_solutions': [{'Cost': 0.4, 'Quality': 0.6}]}

        monkeypatch.setattr(offline_main, 'compute_session_weights', fake_compute_session_weights)
        weights = offline_main.step_1_compute_weights(
            data_dir, str(tmp_path / 'results'), load_sessions(data_dir), criteria)
        assert list(weights) == ['expert_1']

    def test_step_1_can_reuse_saved_weights(self, data_dir, criteria, tmp_path, monkeypatch):
        results_dir = tmp_path / 'results'
        load_LOCAL.save_weight_solutions_csv(
            str(results_dir / 'step1_weight_solutions.csv'), {'expert_1': [{'Cost': 0.25, 'Quality': 0.75}]})
        monkeypatch.setattr(offline_main.ConsolePrompt, 'yes_no', staticmethod(lambda *a, **k: True))
        weights = offline_main.step_1_compute_weights(
            data_dir, str(results_dir), load_sessions(data_dir, ['expert_1']), criteria)
        assert weights == {'expert_1': [{'Cost': 0.25, 'Quality': 0.75}]}


class TestAggregationSettings:
    def test_reads_the_step_2_choices(self, tmp_path):
        data_dir = write_bundle_data(tmp_path, settings={**SETTINGS, 'aggregation': AGGREGATION})
        assert load_LOCAL.load_aggregation_settings(data_dir) == AGGREGATION

    def test_older_exports_get_the_run_page_defaults(self, data_dir):
        assert load_LOCAL.load_aggregation_settings(data_dir) == load_LOCAL.DEFAULT_AGGREGATION_SETTINGS

    def test_offers_every_engine_method(self):
        from scripts import upmavt
        for _, method, _ in offline_main.AGGREGATION_METHODS:
            assert callable(getattr(upmavt, method))


class TestSteps:
    """main.py must run each step with the options the web app's Run page sends."""

    @pytest.fixture()
    def runner(self, data_dir, criteria):
        return offline_main.StepRunner(load_sessions(data_dir), criteria, WEIGHTS)

    @pytest.fixture()
    def step_calls(self, monkeypatch):
        calls = []

        def fake_run_step(step_number, session_docs, criteria, weight_solutions_list, params, print_fn=None):
            calls.append((step_number, params))
            if step_number == 4:
                return {'results_by_aggregation': {
                    method: {'alternative_names': ['A', 'B'], 'aggregated_results': [[0.5, 0.4]]}
                    for method in params['aggregation_methods']
                }}
            if params['mc_mode'] == 'strict':
                return {'alternative_names': ['A', 'B'],
                        'results_by_elicitation': {'0': [[0.5, 0.4]], '1': [[0.4, 0.5]]}}
            return {'alternative_names': ['A', 'B'], 'aggregated_results': [[0.5, 0.4]]}

        monkeypatch.setattr(offline_main, 'run_step', fake_run_step)
        monkeypatch.setattr(offline_main, 'PLOTTING_AVAILABLE', False)
        monkeypatch.setattr(offline_main.ConsolePrompt, 'yes_no', staticmethod(lambda *a, **k: True))
        # Pressing Enter at every prompt keeps the defaults.
        monkeypatch.setattr('builtins.input', lambda *a, **k: '')
        return calls

    def test_runner_lines_weights_up_with_the_sessions(self, runner):
        assert runner.session_names == ['expert_1', 'expert_2']
        assert runner.weight_solutions_list == [WEIGHTS['expert_1'], WEIGHTS['expert_2']]

    def test_step_2_compares_the_web_app_methods_then_keeps_its_choice(self, runner, tmp_path, step_calls):
        method, alpha = offline_main.step_2_choose_aggregation(runner, str(tmp_path), AGGREGATION, [0.75, 0.25])
        assert step_calls == [(4, {
            'mc_iterations': 200,
            'aggregation_method': 'weighted_sum',
            'aggregation_alpha': 0.0,
            'mc_mode': 'non_strict',
            'use_random_weights': False,
            'opinion_weights': [0.75, 0.25],
            'aggregation_methods': ['weighted_sum', 'weighted_power_mean', 'geometric_mean_offset'],
            'aggregation_alphas': {'weighted_sum': 0.0, 'weighted_power_mean': 0.3, 'geometric_mean_offset': 0.6},
        })]
        assert (method, alpha) == ('weighted_power_mean', 0.3)
        assert (tmp_path / 'step2_aggregation_weighted_power_mean_results.csv').exists()

    def test_steps_3_to_5_use_the_chosen_method(self, runner, tmp_path, step_calls):
        out = str(tmp_path)
        offline_main.step_3_uncertainty_analysis(runner, out, 'weighted_power_mean', 0.3, None)
        offline_main.step_4_consensus_analysis(runner, out, 'weighted_power_mean', 0.3, None)
        offline_main.step_5_final_results(runner, out, 'weighted_power_mean', 0.3, None)
        assert [
            (step, p['mc_mode'], p['aggregation_method'], p['aggregation_alpha'], p['mc_iterations'])
            for step, p in step_calls
        ] == [
            (5, 'strict', 'weighted_power_mean', 0.3, 1000),
            (2, 'strict', 'weighted_power_mean', 0.3, 1000),
            (6, 'non_strict', 'weighted_power_mean', 0.3, 10000),
        ]

    def test_smc_results_are_labelled_by_session(self, runner, tmp_path, step_calls):
        offline_main.step_4_consensus_analysis(runner, str(tmp_path), 'weighted_sum', 0.0, None)
        lines = (tmp_path / 'step4_consensus_results.csv').read_text(encoding='utf-8').splitlines()
        assert lines[0] == 'expert_1'
        assert 'expert_2' in lines


def test_real_offline_run_on_exported_data(data_dir, criteria, tmp_path, monkeypatch):
    """Regression: the comma-only reader produced no value functions and 0 solutions."""
    monkeypatch.setattr(offline_main, 'PLOTTING_AVAILABLE', False)
    sessions = load_sessions(data_dir)
    weights = offline_main.step_1_compute_weights(data_dir, str(tmp_path / 'results'), sessions, criteria)
    assert set(weights) == {'expert_1', 'expert_2'}
    assert all(len(solutions) >= 1 for solutions in weights.values())

    runner = offline_main.StepRunner(sessions, criteria, weights)
    results = runner(6, offline_main.step_params('non_strict', 100, 'weighted_power_mean', 0.3, None))
    assert results['alternative_names'] == ['A', 'B']
    assert len(results['aggregated_results']) == 100
