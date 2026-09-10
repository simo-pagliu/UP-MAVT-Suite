"""Tests for scripts.upmavt.sample_from_distribution: the DSL that turns an
alternative's raw CSV cell (e.g. "N(106, 3)", "50±5%", "{1, 2, 3}") into a
number for one Monte Carlo draw. Every distribution string format documented
in USER_MANUAL/README.md's "Input Definition" section is covered here.
"""
import numpy as np
import pytest

from scripts.upmavt import sample_from_distribution


class TestDeterministicValues:
    def test_plain_number(self):
        assert sample_from_distribution("106") == 106.0

    def test_plain_negative_number(self):
        assert sample_from_distribution("-3.5") == -3.5

    def test_whitespace_is_stripped(self):
        assert sample_from_distribution("  42  ") == 42.0


class TestNormalDistribution:
    def test_mean_and_spread(self):
        np.random.seed(0)
        samples = [sample_from_distribution("N(100, 10)") for _ in range(20000)]
        assert 98 < np.mean(samples) < 102
        assert 9 < np.std(samples) < 11

    def test_zero_sigma_is_deterministic(self):
        np.random.seed(0)
        samples = [sample_from_distribution("N(50, 0)") for _ in range(50)]
        assert all(s == 50.0 for s in samples)


class TestUniformDistribution:
    def test_within_bounds(self):
        np.random.seed(0)
        samples = [sample_from_distribution("U(10, 20)") for _ in range(5000)]
        assert min(samples) >= 10
        assert max(samples) <= 20
        assert 14 < np.mean(samples) < 16


class TestTriangularDistribution:
    def test_within_bounds_and_mode(self):
        np.random.seed(0)
        samples = [sample_from_distribution("TRI(0, 5, 10)") for _ in range(5000)]
        assert min(samples) >= 0
        assert max(samples) <= 10
        # Mean of a symmetric triangular(0,5,10) is exactly the mode, 5.
        assert 4.7 < np.mean(samples) < 5.3


class TestErrorMargin:
    def test_absolute_margin(self):
        np.random.seed(0)
        samples = [sample_from_distribution("50±5") for _ in range(5000)]
        assert min(samples) >= 45
        assert max(samples) <= 55

    def test_percentage_margin(self):
        np.random.seed(0)
        samples = [sample_from_distribution("100±10%") for _ in range(5000)]
        assert min(samples) >= 90
        assert max(samples) <= 110

    def test_zero_margin_is_deterministic(self):
        assert sample_from_distribution("50±0") == 50.0


class TestHistogramDistribution:
    def test_samples_fall_in_declared_ranges(self):
        np.random.seed(0)
        dist = "(0-10: 50%, 10-20: 50%)"
        samples = [sample_from_distribution(dist) for _ in range(2000)]
        assert all(0 <= s <= 20 for s in samples)

    def test_probability_weighting_is_respected(self):
        np.random.seed(0)
        # Second range is 9x as likely; with 3000 draws essentially none should
        # land in the first range's much-less-likely bucket by chance alone.
        dist = "(0-1: 10%, 1-2: 90%)"
        samples = [sample_from_distribution(dist) for _ in range(3000)]
        in_first = sum(1 for s in samples if s < 1)
        assert in_first / len(samples) < 0.2


class TestTrapezoidalDistribution:
    def test_within_bounds(self):
        np.random.seed(0)
        samples = [sample_from_distribution("TRAP(0, 3, 7, 10)") for _ in range(3000)]
        assert min(samples) >= 0
        assert max(samples) <= 10

    def test_three_arg_form_falls_back_to_triangular(self):
        np.random.seed(0)
        samples = [sample_from_distribution("TRAP(0, 5, 10)") for _ in range(2000)]
        assert min(samples) >= 0
        assert max(samples) <= 10


class TestDiscreteDistribution:
    def test_only_declared_values_are_drawn(self):
        np.random.seed(0)
        samples = {sample_from_distribution("{1, 2, 3}") for _ in range(500)}
        assert samples.issubset({1.0, 2.0, 3.0})

    def test_single_value_set(self):
        assert sample_from_distribution("{7}") == 7.0


class TestCustom1Distribution:
    def test_result_is_one_of_the_three_qualitative_buckets(self):
        np.random.seed(0)
        dist = "CUSTOM_1({0.5}, 0.2, 0.8)"
        samples = {sample_from_distribution(dist) for _ in range(200)}
        assert samples.issubset({0.0, 1.0, 2.0})


class TestInvalidDistribution:
    def test_unparseable_string_raises(self):
        with pytest.raises(ValueError):
            sample_from_distribution("not-a-distribution")
