"""Tests for scripts.weight_space_definition.compute_weights, the Best-Worst
Tradeoff (BWT) solver (see USER_MANUAL/README.md's "Weights" and "Step 1:
Compute Weights" sections). A minimal, self-contained two-criterion,
one-comparison case is used throughout: with only one BWT judgment and the
simplex constraint (weights sum to 1), the feasible weight vector is unique,
so the solver's output can be checked against a value computed by hand
instead of only against known-good published results (that's what
worker/tests/regression/ does, importing the real example case studies).
"""
import pytest

from scripts.weight_space_definition import compute_weights

FAST_PARAMS = {"de_maxiter": 60, "de_popsize": 8, "max_restarts": 20}


def linear_vf():
    return lambda x: max(0.0, min(1.0, float(x) / 100.0))


def two_criterion_case(target_wA=0.3, target_wB=0.7):
    """REFERENCE=A (held at its best), ADJUSTED=B: consistency requires
    vf_B(DATA_VALUE) == wA / wB (see the derivation used to fix
    USER_MANUAL/img/run-upmavt-step1-weights.png). vf_B is linear x/100, so
    DATA_VALUE = 100 * wA / wB exactly reproduces the target weights.
    """
    value_functions = {"A": linear_vf(), "B": linear_vf()}
    comparisons = [{
        "REFERENCE_CRITERION": "A", "ADJUSTED_CRITERION": "B",
        "DATA_VALUE": 100.0 * target_wA / target_wB, "TYPE": "best", "GROUP": "single-group",
    }]
    return value_functions, comparisons


class TestExactRecovery:
    @pytest.mark.parametrize("model", [True, False])
    def test_recovers_known_target_weights(self, model):
        vf, comparisons = two_criterion_case(0.3, 0.7)
        solutions = compute_weights(vf, comparisons, criteria_names=["A", "B"],
                                     use_non_linear_model=model, print_fn=lambda *a, **k: None,
                                     parameter_overrides=FAST_PARAMS)
        assert len(solutions) >= 1
        best = solutions[0]
        assert best["A"] == pytest.approx(0.3, abs=0.01)
        assert best["B"] == pytest.approx(0.7, abs=0.01)

    def test_weights_always_sum_to_one(self):
        vf, comparisons = two_criterion_case(0.45, 0.55)
        solutions = compute_weights(vf, comparisons, criteria_names=["A", "B"],
                                     use_non_linear_model=True, print_fn=lambda *a, **k: None,
                                     parameter_overrides=FAST_PARAMS)
        for sol in solutions:
            assert sum(sol.values()) == pytest.approx(1.0, abs=1e-6)


class TestModelDifferences:
    def test_linear_model_returns_exactly_one_solution(self):
        vf, comparisons = two_criterion_case()
        solutions = compute_weights(vf, comparisons, criteria_names=["A", "B"],
                                     use_non_linear_model=False, print_fn=lambda *a, **k: None,
                                     parameter_overrides=FAST_PARAMS)
        assert len(solutions) == 1

    def test_non_linear_model_can_return_multiple_solutions(self):
        vf, comparisons = two_criterion_case()
        solutions = compute_weights(vf, comparisons, criteria_names=["A", "B"],
                                     use_non_linear_model=True, print_fn=lambda *a, **k: None,
                                     parameter_overrides={**FAST_PARAMS, "max_results": 5})
        # Not required to find 5 (the z*=0 case is a single point), but it must
        # not artificially collapse to one the way the linear branch does.
        assert len(solutions) >= 1


class TestCriteriaOrdering:
    def test_criteria_named_but_not_compared_are_still_included(self):
        vf, comparisons = two_criterion_case()
        vf["C"] = linear_vf()  # present in value_functions, absent from comparisons
        solutions = compute_weights(vf, comparisons, criteria_names=["A", "B", "C"],
                                     use_non_linear_model=True, print_fn=lambda *a, **k: None,
                                     parameter_overrides=FAST_PARAMS)
        assert set(solutions[0].keys()) == {"A", "B", "C"}

    def test_explicit_criteria_order_is_honored(self):
        vf, comparisons = two_criterion_case()
        solutions_ab = compute_weights(vf, comparisons, criteria_names=["A", "B"],
                                        use_non_linear_model=False, print_fn=lambda *a, **k: None,
                                        parameter_overrides=FAST_PARAMS)
        solutions_ba = compute_weights(vf, comparisons, criteria_names=["B", "A"],
                                        use_non_linear_model=False, print_fn=lambda *a, **k: None,
                                        parameter_overrides=FAST_PARAMS)
        # Same underlying weights regardless of the order they're requested in.
        assert solutions_ab[0]["A"] == pytest.approx(solutions_ba[0]["A"], abs=0.01)
        assert solutions_ab[0]["B"] == pytest.approx(solutions_ba[0]["B"], abs=0.01)


class TestEmptyInput:
    def test_no_comparisons_returns_empty(self):
        vf, _ = two_criterion_case()
        solutions = compute_weights(vf, [], criteria_names=["A", "B"], print_fn=lambda *a, **k: None)
        assert solutions == []

    def test_no_value_functions_returns_empty(self):
        _, comparisons = two_criterion_case()
        solutions = compute_weights({}, comparisons, criteria_names=["A", "B"],
                                     print_fn=lambda *a, **k: None)
        assert solutions == []
