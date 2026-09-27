"""Tests for scripts.upmavt.evaluate_alternative: samples an alternative's raw
value, applies its value function, applies a confidence-derived error margin,
then clips to [0.001, 1.0] (see examples/05-analytically-tractable-verification/
README.md's discussion of why the floor at 0.001 rather than 0.0 matters for
geometric-/harmonic-mean aggregation).
"""
import numpy as np
import pytest

from scripts.upmavt import evaluate_alternative, weighted_sum


def make_vf_dict(**criterion_to_slope):
    """criterion -> a value function that returns the given constant, for tests
    that only care about the confidence-error and clipping behavior, not the
    value function's own shape."""
    return {crit: (lambda x, c=const: c) for crit, const in criterion_to_slope.items()}


class TestNoUncertainty:
    def test_full_confidence_is_deterministic(self):
        vf_lists = [make_vf_dict(Cost=0.5)]
        confidence_lists = [{"Cost": 4}]  # confidence 4 -> 0% error margin
        alt_data = {"Cost": "100"}
        scores = {evaluate_alternative("A", alt_data, ["Cost"], vf_lists, confidence_lists,
                                        0, 0, {"Cost": 1.0}, weighted_sum) for _ in range(50)}
        assert scores == {0.5}


class TestConfidenceErrorMargin:
    @pytest.mark.parametrize("confidence,expected_pct", [(0, 0.10), (1, 0.075), (2, 0.05), (3, 0.025)])
    def test_error_band_width_matches_confidence_table(self, confidence, expected_pct):
        # See USER_MANUAL/README.md's Glossary: "Confidence level ... used to
        # widen or narrow the uncertainty band". Base value 0.5 keeps the band
        # away from the [0.001, 1.0] clip so it can be measured directly.
        np.random.seed(0)
        vf_lists = [make_vf_dict(Cost=0.5)]
        confidence_lists = [{"Cost": confidence}]
        alt_data = {"Cost": "100"}
        scores = [evaluate_alternative("A", alt_data, ["Cost"], vf_lists, confidence_lists,
                                        0, 0, {"Cost": 1.0}, weighted_sum) for _ in range(4000)]
        margin = 0.5 * expected_pct
        assert min(scores) >= 0.5 - margin - 1e-9
        assert max(scores) <= 0.5 + margin + 1e-9
        # And the band should actually be used, not degenerate to a point.
        assert max(scores) - min(scores) > margin  # at least covers half the declared width


class TestClipFloor:
    def test_zero_value_function_output_is_floored_not_zero(self):
        # A weight function that always returns exactly 0 would, without the
        # floor, make geometric/harmonic aggregation divide by zero or collapse
        # the whole score to zero regardless of other criteria.
        vf_lists = [make_vf_dict(Cost=0.0)]
        confidence_lists = [{"Cost": 4}]
        alt_data = {"Cost": "100"}
        score = evaluate_alternative("A", alt_data, ["Cost"], vf_lists, confidence_lists,
                                      0, 0, {"Cost": 1.0}, weighted_sum)
        assert score == pytest.approx(0.001)

    def test_output_never_exceeds_one(self):
        # confidence=0 with a base value near 1.0 could push the sampled value
        # above 1.0 before clipping; verify it never does after.
        np.random.seed(0)
        vf_lists = [make_vf_dict(Cost=0.99)]
        confidence_lists = [{"Cost": 0}]
        alt_data = {"Cost": "100"}
        scores = [evaluate_alternative("A", alt_data, ["Cost"], vf_lists, confidence_lists,
                                        0, 0, {"Cost": 1.0}, weighted_sum) for _ in range(2000)]
        assert max(scores) <= 1.0


class TestMissingWeight:
    def test_missing_criterion_weight_raises_key_error(self):
        vf_lists = [make_vf_dict(Cost=0.5)]
        confidence_lists = [{"Cost": 4}]
        alt_data = {"Cost": "100"}
        with pytest.raises(KeyError):
            evaluate_alternative("A", alt_data, ["Cost"], vf_lists, confidence_lists,
                                  0, 0, {}, weighted_sum)
