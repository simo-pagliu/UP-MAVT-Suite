"""Tests for the offline export bundle scripts (frontend/public/load_LOCAL.py and
main.py) on data laid out exactly like the Suite export writes it: a comma input.csv
with an is_qi row, semicolon-separated per-session CSVs, and JSON settings."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from scripts.session_inputs import build_alternatives_with_qualitative

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


@pytest.fixture()
def data_dir(tmp_path):
    return write_bundle_data(tmp_path)


class TestLoading:
    def test_reads_semicolon_value_functions(self, data_dir):
        criteria = load_LOCAL.load_input_data(data_dir)['criteria']
        vfs = load_LOCAL.build_value_functions_from_csv(data_dir, 'expert_1', criteria)
        assert set(vfs) == {'Cost', 'Quality'}
        assert vfs['Cost'](150) == pytest.approx(0.5)

    def test_reads_semicolon_comparisons(self, data_dir):
        comparisons = load_LOCAL.build_comparisons_from_csv(data_dir, 'expert_1')
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

    def test_practitioner_confidence_adjustment_is_applied(self, data_dir):
        criteria = load_LOCAL.load_input_data(data_dir)['criteria']
        _, confidences = load_LOCAL.build_value_functions_from_csv(
            data_dir, 'expert_1', criteria, return_confidence=True)
        assert confidences == {'Cost': 2.0, 'Quality': 4}  # 3 + overall -1; qualitative VF stays 4


class TestQualitativeValues:
    def test_each_session_fills_its_own_qualitative_values(self, data_dir):
        alternatives_1, _ = load_LOCAL.build_alternatives_from_csv(data_dir, 'expert_1')
        alternatives_2, _ = load_LOCAL.build_alternatives_from_csv(data_dir, 'expert_2')
        # expert_1's practitioner lowered all confidences by 1 (4 -> 3 = ±2.5%)
        assert alternatives_1['A']['Quality'] == '0.9 ± 2.5%'
        assert alternatives_2['A']['Quality'] == 0.3
        assert alternatives_1['A']['Cost'] == '100'

    def test_matches_the_web_worker_builder(self, data_dir):
        criteria = load_LOCAL.load_input_data(data_dir)['criteria']
        session = load_LOCAL.load_session_data(data_dir, 'expert_1')
        expected = build_alternatives_with_qualitative(
            {'criteria': criteria}, session['qualitative_indicators'], session['practitioner_settings'])
        assert load_LOCAL.build_alternatives_from_csv(data_dir, 'expert_1') == expected

    def test_prepare_upmavt_data_gives_one_matrix_per_session(self, data_dir):
        criteria = load_LOCAL.load_input_data(data_dir)['criteria']
        weights = {'expert_1': [{'Cost': 0.5, 'Quality': 0.5}], 'expert_2': [{'Cost': 0.3, 'Quality': 0.7}]}
        _, _, ws_list, alternatives, names, opinion_weights = offline_main.prepare_upmavt_data(
            data_dir, ['expert_1', 'expert_2'], criteria, weights)
        assert [a['B']['Quality'] for a in alternatives] == ['0.2 ± 2.5%', 0.8]
        assert names == ['Cost', 'Quality']
        assert ws_list == [weights['expert_1'], weights['expert_2']]
        assert opinion_weights == [0.75, 0.25]


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

    def test_step_1_passes_the_study_settings_to_the_solver(self, data_dir, tmp_path, monkeypatch):
        calls = []

        def fake_compute_weights(value_functions, comparisons, **kwargs):
            calls.append((sorted(value_functions), comparisons, kwargs))
            return [{'Cost': 0.4, 'Quality': 0.6}]

        monkeypatch.setattr(offline_main, 'compute_weights', fake_compute_weights)
        weights = offline_main.step_1_compute_weights(data_dir, str(tmp_path / 'results'), ['expert_1', 'expert_2'])

        assert weights == {'expert_1': [{'Cost': 0.4, 'Quality': 0.6}], 'expert_2': [{'Cost': 0.4, 'Quality': 0.6}]}
        vf_names, comparisons, kwargs = calls[0]
        assert vf_names == ['Cost', 'Quality'] and len(comparisons) == 1
        assert kwargs['use_non_linear_model'] is False
        assert kwargs['step_c_lim_percent'] == 2.5
        assert kwargs['parameter_overrides'] == SETTINGS['weight_space_parameters']

    def test_step_1_can_reuse_saved_weights(self, data_dir, tmp_path, monkeypatch):
        results_dir = tmp_path / 'results'
        load_LOCAL.save_weight_solutions_csv(
            str(results_dir / 'step1_weight_solutions.csv'), {'expert_1': [{'Cost': 0.25, 'Quality': 0.75}]})
        monkeypatch.setattr(offline_main.ConsolePrompt, 'yes_no', staticmethod(lambda *a, **k: True))
        weights = offline_main.step_1_compute_weights(data_dir, str(results_dir), ['expert_1'])
        assert weights == {'expert_1': [{'Cost': 0.25, 'Quality': 0.75}]}


def test_real_solver_finds_weights_on_exported_data(data_dir, tmp_path):
    """Regression: the comma-only reader produced no value functions and 0 solutions."""
    weights = offline_main.step_1_compute_weights(data_dir, str(tmp_path / 'results'), ['expert_1', 'expert_2'])
    assert set(weights) == {'expert_1', 'expert_2'}
    assert all(len(solutions) >= 1 for solutions in weights.values())
