"""Tests for scripts.session_inputs: the session -> engine-input helpers shared by
the web worker and the offline export bundle."""
import numpy as np

from scripts.session_inputs import (
    build_alternatives_with_qualitative,
    build_value_functions_from_session,
    compute_opinion_weights,
)
from scripts.upmavt import run_monte_carlo

INPUT_DOC = {'criteria': [
    {'criterion_name': 'Quality', 'is_qualitative': True,
     'alternatives': [{'name': 'A', 'value': ''}, {'name': 'B', 'value': ''}]},
]}


def qualitative_session(value_a, value_b, confidence=4):
    return {'Quality': {
        'ranking': {'A': 0, 'B': 1},
        'values': {'0': value_a, '1': value_b},
        'confidences': {'0': confidence, '1': confidence},
    }}


class TestComputeOpinionWeights:
    def test_equal_weights_mean_uniform_sampling(self):
        assert compute_opinion_weights([{}, {'overall_weight': 1.0}, None]) is None

    def test_normalizes_practitioner_weights(self):
        assert compute_opinion_weights([{'overall_weight': 1}, {'overall_weight': 3}]) == [0.25, 0.75]

    def test_invalid_weights_fall_back_to_one(self):
        weights = compute_opinion_weights([{'overall_weight': -2}, {'overall_weight': 'x'}, {'overall_weight': 2}])
        assert weights == [0.25, 0.25, 0.5]

    def test_all_zero_means_uniform_sampling(self):
        assert compute_opinion_weights([{'overall_weight': 0}, {'overall_weight': 0}]) is None


class TestQualitativeSubstitution:
    def test_fills_qualitative_cells_from_the_session(self):
        alternatives, names = build_alternatives_with_qualitative(INPUT_DOC, qualitative_session(0.9, 0.2))
        assert names == ['Quality']
        assert alternatives == {'A': {'Quality': 0.9}, 'B': {'Quality': 0.2}}

    def test_practitioner_adjustment_widens_the_uncertainty(self):
        settings = {'confidence_adjustments': {'overall': -1, 'qi_criteria': {'Quality': -1}}}
        alternatives, _ = build_alternatives_with_qualitative(INPUT_DOC, qualitative_session(0.9, 0.2), settings)
        # confidence 4 - 2 = 2 -> 10% * (4 - 2) / 4 = 5% error
        assert alternatives['A']['Quality'] == '0.9 ± 5.0%'

    def test_value_function_confidence_gets_practitioner_adjustment(self):
        session = {
            'value_functions': {'criteria': {'Cost': {'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}], 'confidence': 3}}},
            'practitioner_settings': {'confidence_adjustments': {'vf': -1, 'vf_criteria': {'Cost': -0.5}}},
        }
        criteria = [{'criterion_name': 'Cost', 'alternatives': []}]
        _, confidences = build_value_functions_from_session(session, criteria, return_confidence=True)
        assert confidences == {'Cost': 1.5}


class TestEachDecisionMakerUsesTheirOwnQualitativeValues:
    """The worker passes one decision matrix per session to the engine."""

    def setup_method(self):
        self.alternatives_list = [
            build_alternatives_with_qualitative(INPUT_DOC, qualitative_session(0.9, 0.2))[0],
            build_alternatives_with_qualitative(INPUT_DOC, qualitative_session(0.1, 0.7))[0],
        ]
        identity = lambda x: float(x)  # noqa: E731  (qualitative value functions are identity)
        self.vf_lists = [{'Quality': identity}, {'Quality': identity}]
        self.confidence_lists = [{'Quality': 4}, {'Quality': 4}]
        self.weight_solutions = [[{'Quality': 1.0}], [{'Quality': 1.0}]]

    def run(self, mc_mode, opinion_weights):
        return run_monte_carlo(
            self.alternatives_list, ['Quality'], self.weight_solutions, self.vf_lists,
            self.confidence_lists, [{}, {}], 'weighted_sum', 0.0,
            np.array(opinion_weights), 50, mc_mode, print_fn=lambda m: None,
        )

    def test_strict_mode_scores_each_session_with_its_own_matrix(self):
        results = self.run('strict', [0.5, 0.5])
        assert set(np.round(results[0]['A'], 6)) == {0.9}
        assert set(np.round(results[1]['A'], 6)) == {0.1}
        assert set(np.round(results[1]['B'], 6)) == {0.7}

    def test_non_strict_mode_pairs_values_with_the_sampled_session(self):
        np.random.seed(0)
        results = self.run('non_strict', [0.5, 0.5])
        assert set(np.round(results['A'], 6)) == {0.9, 0.1}
