"""Regression test: UP-MAVT's BWT solver must keep reproducing the published
weights for Participant 64 of Sun, Kroesen & Rezaei (2026), "Anchoring Bias in
the Tradeoff Procedure Within Multi-Attribute Value Theory" (see
examples/04-tradeoff-elicitation-sun-kroesen-rezaei-2026/README.md for the
full derivation). This wraps that example's own verification/run_replication.py
as a pytest test, reusing its data unmodified rather than duplicating it, so a
future change to the solver that breaks this published-value match fails CI
immediately instead of only being caught by someone manually re-running the
example script.
"""
import pytest

from scripts.weight_space_definition import compute_weights


@pytest.fixture
def replication_module(import_example_script):
    return import_example_script(
        "04-tradeoff-elicitation-sun-kroesen-rezaei-2026", "run_replication.py", "_regression_04",
    )


class TestParticipant64BwtReplication:
    def test_computed_weights_match_published_table(self, replication_module):
        mod = replication_module
        solutions = compute_weights(
            mod.VALUE_FUNCTIONS, mod.COMPARISONS, criteria_names=mod.CRITERIA_NAMES,
            use_non_linear_model=False, print_fn=lambda *a, **k: None,
        )
        computed = solutions[0]
        for crit, expected in mod.PUBLISHED_BWT_WEIGHTS.items():
            assert computed[crit] == pytest.approx(expected, abs=0.01), (
                f"{crit}: expected {expected} (Table 3.7), got {computed[crit]}"
            )
