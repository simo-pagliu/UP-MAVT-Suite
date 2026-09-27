"""Regression test: UP-MAVT's solver must keep reproducing the closed-form
weights and analytically-derived Monte Carlo mean/bounds for the "Cost vs.
Quality" supplier-selection problem in
examples/05-analytically-tractable-verification/README.md. Wraps that
example's own verification/run_verification.py as pytest tests, reusing its
data and closed-form EXPECTED values unmodified.
"""
import numpy as np
import pytest

from scripts.weight_space_definition import compute_weights
from scripts.upmavt import run_upmavt


@pytest.fixture
def verification_module(import_example_script):
    return import_example_script(
        "05-analytically-tractable-verification", "run_verification.py", "_regression_05",
    )


class TestClosedFormWeights:
    def test_computed_weights_match_closed_form(self, verification_module):
        mod = verification_module
        solutions = compute_weights(
            mod.VALUE_FUNCTIONS, mod.COMPARISONS, criteria_names=mod.CRITERIA_NAMES,
            print_fn=lambda *a, **k: None, use_non_linear_model=True,
            parameter_overrides={"max_results": 5, "max_restarts": 50},
        )
        computed = solutions[0]
        for crit, expected in mod.EXPECTED_WEIGHTS.items():
            assert computed[crit] == pytest.approx(expected, abs=1e-6)


class TestMonteCarloAgainstClosedFormBounds:
    def test_mean_and_bounds_match_analytical_derivation(self, verification_module):
        mod = verification_module
        solutions = compute_weights(
            mod.VALUE_FUNCTIONS, mod.COMPARISONS, criteria_names=mod.CRITERIA_NAMES,
            print_fn=lambda *a, **k: None, use_non_linear_model=True,
            parameter_overrides={"max_results": 5, "max_restarts": 50},
        )
        params = {
            "mc_iterations": 50000, "aggregation_method": "weighted_sum",
            "mc_mode": "non_strict", "use_random_weights": False, "opinion_weights": None,
        }
        results = run_upmavt(
            [mod.VALUE_FUNCTIONS], [mod.CONFIDENCE], [solutions],
            mod.ALTERNATIVES, mod.CRITERIA_NAMES, params, print_fn=lambda *a, **k: None,
        )
        alt_names = results["alternative_names"]
        rows = np.array(results["aggregated_results"])

        for i, alt in enumerate(alt_names):
            col = rows[:, i]
            expected = mod.EXPECTED[alt]
            # Standard error at 50k iterations is ~1e-4; 0.005 leaves ample margin.
            assert col.mean() == pytest.approx(expected["mean"], abs=0.005), alt
            # Every sample is drawn from a uniform distribution truncated at
            # these exact bounds by construction, so these must hold up to
            # floating-point tolerance, not just approximately.
            assert col.min() >= expected["min"] - 1e-9, alt
            assert col.max() <= expected["max"] + 1e-9, alt
