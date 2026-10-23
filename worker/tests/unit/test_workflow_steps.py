"""Tests for scripts.workflow_steps: the workflow steps run by both the web worker
and the offline export bundle."""
import numpy as np
import pytest

from scripts import workflow_steps
from scripts.workflow_steps import compute_session_weights, run_step

CRITERIA = [
    {'criterion_name': 'Cost', 'is_qualitative': False,
     'alternatives': [{'name': 'A', 'value': '100'}, {'name': 'B', 'value': '200'}]},
    {'criterion_name': 'Quality', 'is_qualitative': True,
     'alternatives': [{'name': 'A', 'value': ''}, {'name': 'B', 'value': ''}]},
]


def session(quality_a, quality_b, cost_confidence=4):
    return {
        'value_functions': {'criteria': {'Cost': {
            'points': [{'x': 100, 'y': 1}, {'x': 200, 'y': 0}], 'confidence': cost_confidence,
        }}},
        'qualitative_indicators': {'Quality': {
            'ranking': {'A': 0, 'B': 1},
            'values': {'0': quality_a, '1': quality_b},
            'confidences': {'0': 4, '1': 4},
        }},
        'bwt': {'comparisons': [{
            'reference_criterion': 'Quality', 'adjusted_criterion': 'Cost',
            'data_value': 150, 'type': 'best', 'group': 'G1',
        }]},
    }


SESSIONS = [session(0.9, 0.2), session(0.1, 0.8)]
WEIGHTS = [[{'Cost': 0.5, 'Quality': 0.5}], [{'Cost': 0.5, 'Quality': 0.5}]]


def params(**overrides):
    base = {'mc_iterations': 100, 'aggregation_method': 'weighted_sum', 'aggregation_alpha': 0.0,
            'mc_mode': 'strict', 'use_random_weights': False, 'opinion_weights': None}
    return {**base, **overrides}


class TestRunStep:
    def test_strict_step_keeps_each_session_separate(self):
        np.random.seed(0)
        results = run_step(2, SESSIONS, CRITERIA, WEIGHTS, params(), print_fn=lambda msg: None)
        assert results['alternative_names'] == ['A', 'B']
        assert set(results['results_by_elicitation']) == {'0', '1'}
        assert results['mc_mode'] == 'strict'
        # Each session scores with its own qualitative values (full confidence, so
        # no noise): score = 0.5 * vf(cost) + 0.5 * quality, vf floored at 0.001.
        first = np.mean(results['results_by_elicitation']['0'], axis=0)
        second = np.mean(results['results_by_elicitation']['1'], axis=0)
        assert first == pytest.approx([0.95, 0.1], abs=1e-3)
        assert second == pytest.approx([0.55, 0.4], abs=1e-3)

    def test_step_4_runs_every_compared_method_with_its_alpha(self):
        np.random.seed(0)
        results = run_step(4, SESSIONS, CRITERIA, WEIGHTS, params(
            mc_mode='non_strict',
            aggregation_methods=['weighted_sum', 'weighted_power_mean'],
            aggregation_alphas={'weighted_sum': 0.0, 'weighted_power_mean': 0.5},
        ), print_fn=lambda msg: None)
        assert results['aggregation_methods'] == ['weighted_sum', 'weighted_power_mean']
        assert results['aggregation_alphas'] == {'weighted_sum': 0.0, 'weighted_power_mean': 0.5}
        assert set(results['results_by_aggregation']) == {'weighted_sum', 'weighted_power_mean'}
        assert len(results['results_by_aggregation']['weighted_power_mean']['aggregated_results']) == 100

    def test_passes_each_method_its_alpha(self, monkeypatch):
        calls = []

        def fake_run_upmavt(vf_lists, confidence_lists, weight_solutions_list, alternatives_list,
                            criteria_names, step_params, print_fn=None):
            calls.append(step_params)
            return {'alternative_names': ['A', 'B'], 'aggregated_results': []}

        monkeypatch.setattr(workflow_steps, 'run_upmavt', fake_run_upmavt)
        run_step(4, SESSIONS, CRITERIA, WEIGHTS, params(
            mc_mode='non_strict', aggregation_alpha=0.2,
            aggregation_methods=['weighted_exponential_mean', 'weighted_sum_min_mix'],
            aggregation_alphas={'weighted_exponential_mean': -0.4},
        ), print_fn=lambda msg: None)
        # A method without its own alpha falls back to aggregation_alpha.
        assert [(c['aggregation_method'], c['aggregation_alpha']) for c in calls] == [
            ('weighted_exponential_mean', -0.4),
            ('weighted_sum_min_mix', 0.2),
        ]


class TestComputeSessionWeights:
    def test_returns_the_solver_metadata(self):
        result = compute_session_weights(
            SESSIONS[0], CRITERIA, use_non_linear_model=False,
            weight_space_parameters={'max_results': 3, 'max_restarts': 10}, print_fn=lambda msg: None)
        assert result['accepted_solutions']
        assert all(sum(solution.values()) == pytest.approx(1.0) for solution in result['accepted_solutions'])
        assert 'runtime_parameters' in result
