"""Tests for scripts.upmavt.run_monte_carlo's two modes -- see
USER_MANUAL/README.md's Glossary entry "SMC vs. NSMC (Strict vs. Non-Strict
Monte Carlo)": strict (SMC) keeps each decision-maker's simulated results
separate; non_strict (NSMC) pools all decision-makers into one combined
distribution per alternative, drawing which decision-maker's weights/value
functions to use each iteration according to `opinion_weights`.
"""
import numpy as np

from scripts.upmavt import run_monte_carlo, weighted_sum


def make_two_elicitation_setup():
    alternatives = {"A": {"Cost": "100"}, "B": {"Cost": "50"}}
    criteria = ["Cost"]
    # Two decision-makers with different (but each internally deterministic)
    # value functions, so their per-elicitation results are distinguishable.
    vf_lists = [{"Cost": lambda x: 0.9}, {"Cost": lambda x: 0.1}]
    confidence_lists = [{"Cost": 4}, {"Cost": 4}]
    weight_solutions_list = [[{"Cost": 1.0}], [{"Cost": 1.0}]]
    constraint_data_list = [{}, {}]
    return alternatives, criteria, weight_solutions_list, vf_lists, confidence_lists, constraint_data_list


class TestStrictMode:
    def test_keeps_one_series_per_elicitation(self):
        alts, crit, ws, vf, conf, cd = make_two_elicitation_setup()
        results = run_monte_carlo(alts, crit, ws, vf, conf, cd, "weighted_sum",
                                   np.array([0.5, 0.5]), num_iterations=30, mc_mode="strict")
        assert set(results.keys()) == {0, 1}
        assert len(results[0]["A"]) == 30
        assert len(results[1]["A"]) == 30

    def test_each_elicitation_only_ever_sees_its_own_value_function(self):
        alts, crit, ws, vf, conf, cd = make_two_elicitation_setup()
        results = run_monte_carlo(alts, crit, ws, vf, conf, cd, "weighted_sum",
                                   np.array([0.5, 0.5]), num_iterations=20, mc_mode="strict")
        # vf 0 always returns 0.9, vf 1 always returns 0.1, so with weight=1.0
        # every strict-mode score for elicitation 0 must be ~0.9 and for 1 ~0.1,
        # regardless of alternative (both alternatives share the same VF here).
        assert all(abs(v - 0.9) < 1e-9 for v in results[0]["A"])
        assert all(abs(v - 0.1) < 1e-9 for v in results[1]["A"])


class TestNonStrictMode:
    def test_pools_into_a_single_series_per_alternative(self):
        alts, crit, ws, vf, conf, cd = make_two_elicitation_setup()
        results = run_monte_carlo(alts, crit, ws, vf, conf, cd, "weighted_sum",
                                   np.array([0.5, 0.5]), num_iterations=30, mc_mode="non_strict")
        assert set(results.keys()) == {"A", "B"}
        assert len(results["A"]) == 30

    def test_mixes_both_elicitations_values(self):
        np.random.seed(0)
        alts, crit, ws, vf, conf, cd = make_two_elicitation_setup()
        results = run_monte_carlo(alts, crit, ws, vf, conf, cd, "weighted_sum",
                                   np.array([0.5, 0.5]), num_iterations=500, mc_mode="non_strict")
        distinct_values = {round(v, 6) for v in results["A"]}
        # Pooled results should show BOTH elicitations' fixed outputs (0.9 and
        # 0.1), not just one -- that's what distinguishes NSMC from SMC.
        assert distinct_values == {0.9, 0.1}

    def test_opinion_weights_bias_the_pooled_mixture(self):
        np.random.seed(0)
        alts, crit, ws, vf, conf, cd = make_two_elicitation_setup()
        # Heavily favor elicitation 0 (which always scores 0.9).
        results = run_monte_carlo(alts, crit, ws, vf, conf, cd, "weighted_sum",
                                   np.array([0.95, 0.05]), num_iterations=4000, mc_mode="non_strict")
        mean_score = np.mean(results["A"])
        # Expected mean ~= 0.95*0.9 + 0.05*0.1 = 0.86; allow generous tolerance
        # for finite-sample noise.
        assert 0.80 < mean_score < 0.92
