"""Tests for scripts.upmavt.weight_sampler: picks one weight vector per MC
iteration, either by drawing uniformly from compute_weights' precomputed
feasible solutions (the normal path), or -- if use_random_weights is set and
no solutions exist -- from an unconstrained Dirichlet distribution.
"""
import numpy as np
import pytest

from scripts.upmavt import weight_sampler


class TestSamplingFromPrecomputedSolutions:
    def test_returns_one_of_the_given_solutions(self):
        np.random.seed(0)
        solutions = [{"A": 0.2, "B": 0.8}, {"A": 0.6, "B": 0.4}]
        for _ in range(50):
            sampled = weight_sampler(solutions, ["A", "B"])
            assert sampled in solutions

    def test_both_solutions_get_drawn_eventually(self):
        np.random.seed(0)
        solutions = [{"A": 0.2, "B": 0.8}, {"A": 0.6, "B": 0.4}]
        drawn = {tuple(sorted(weight_sampler(solutions, ["A", "B"]).items())) for _ in range(200)}
        assert len(drawn) == 2

    def test_restricts_output_to_requested_criteria(self):
        solutions = [{"A": 0.3, "B": 0.3, "C": 0.4}]
        sampled = weight_sampler(solutions, ["A", "C"])
        assert set(sampled.keys()) == {"A", "C"}


class TestEmptySolutions:
    def test_raises_without_random_weights_fallback(self):
        with pytest.raises(ValueError):
            weight_sampler([], ["A", "B"])

    def test_none_input_raises(self):
        with pytest.raises(ValueError):
            weight_sampler(None, ["A", "B"])

    def test_falls_back_to_dirichlet_when_enabled(self):
        np.random.seed(0)
        sampled = weight_sampler([], ["A", "B", "C"], use_random_weights=True)
        assert set(sampled.keys()) == {"A", "B", "C"}
        assert abs(sum(sampled.values()) - 1.0) < 1e-9
        assert all(0.0 <= w <= 1.0 for w in sampled.values())


class TestMalformedSolution:
    def test_non_dict_entry_raises(self):
        with pytest.raises(ValueError):
            weight_sampler([0.5], ["A"])
