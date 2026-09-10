"""Tests for scripts.upmavt's three aggregation methods (WAM/GEO/HAR -- see
USER_MANUAL/README.md's "Step 2: Choose Aggregation Method" for the
user-facing description of each). intermediate_results is a list of
(weight, value) tuples, value in [0, 1].
"""
import math

from scripts.upmavt import weighted_sum, geometric_mean, harmonic_mean


class TestWeightedSum:
    def test_matches_hand_computation(self):
        results = [(0.6, 0.5), (0.4, 1.0)]
        assert weighted_sum(results) == 0.6 * 0.5 + 0.4 * 1.0

    def test_equal_weights_average(self):
        results = [(0.5, 0.2), (0.5, 0.8)]
        assert abs(weighted_sum(results) - 0.5) < 1e-9

    def test_single_criterion_returns_its_value(self):
        assert weighted_sum([(1.0, 0.73)]) == 0.73


class TestGeometricMean:
    def test_matches_hand_computation(self):
        results = [(0.5, 0.4), (0.5, 0.9)]
        expected = math.sqrt(0.4) * math.sqrt(0.9)
        assert abs(geometric_mean(results) - expected) < 1e-9

    def test_a_single_zero_value_dominates(self):
        # geometric_mean skips non-positive values rather than zeroing the whole
        # product outright (see the `if value > 0` guard) -- verify that behavior
        # explicitly, since it differs from the textbook definition.
        results = [(0.5, 0.0), (0.5, 0.8)]
        assert abs(geometric_mean(results) - 0.8 ** 0.5) < 1e-9

    def test_penalizes_imbalance_more_than_weighted_sum(self):
        balanced = [(0.5, 0.6), (0.5, 0.6)]
        imbalanced = [(0.5, 0.2), (0.5, 1.0)]
        # Same weighted-sum total (0.6), but geometric mean should punish the
        # imbalanced case (per USER_MANUAL/README.md: "a very poor score on one
        # criterion pulls the total down harder").
        assert weighted_sum(balanced) == weighted_sum(imbalanced)
        assert geometric_mean(imbalanced) < geometric_mean(balanced)


class TestHarmonicMean:
    def test_matches_hand_computation(self):
        results = [(0.5, 0.4), (0.5, 0.8)]
        expected = 1.0 / (0.5 / 0.4 + 0.5 / 0.8)
        assert abs(harmonic_mean(results) - expected) < 1e-9

    def test_zero_value_returns_floor_not_crash(self):
        results = [(0.5, 0.0), (0.5, 0.8)]
        assert harmonic_mean(results) == 0.001

    def test_penalizes_imbalance_more_than_geometric_mean(self):
        balanced = [(0.5, 0.6), (0.5, 0.6)]
        imbalanced = [(0.5, 0.2), (0.5, 1.0)]
        # Per USER_MANUAL/README.md: HAR "punishes weak criteria even more
        # strongly than the geometric mean."
        assert harmonic_mean(imbalanced) < geometric_mean(imbalanced)
