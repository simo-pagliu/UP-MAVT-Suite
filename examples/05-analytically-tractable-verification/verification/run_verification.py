#!/usr/bin/env python3
"""
Verification script for the analytically tractable example (case study 05).

Runs the *actual* UP-MAVT solver (worker/scripts/weight_space_definition.py
and worker/scripts/upmavt.py, unmodified) on the two-criterion "Cost vs.
Quality" supplier-selection problem described in this folder's README.md,
with genuine uncertainty on both the input data (Cost, given as "X +/- x",
a uniform margin) and the value function (Quality, evaluated with a
confidence level below the maximum, which applies a uniform error band
around the value-function output). Checks the tool's Monte Carlo output
against the closed-form mean and exact bounds derived in the README.

Usage (from anywhere):
    python run_verification.py

Requires: numpy, scipy (same as the rest of UP-MAVT-Suite's worker).
"""
import os
import sys
import json

import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "worker"))

from scripts.weight_space_definition import compute_weights  # noqa: E402
from scripts.upmavt import run_upmavt  # noqa: E402


def make_linear_vf(points):
    """Build a simple piecewise-linear callable from a list of (x, y) points."""
    pts = sorted(points, key=lambda p: p[0])
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]

    def vf(x):
        x = float(x)
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= x <= xs[i + 1]:
                t = (x - xs[i]) / (xs[i + 1] - xs[i])
                return ys[i] + t * (ys[i + 1] - ys[i])
        return ys[-1]

    return vf


CRITERIA_NAMES = ["Cost", "Quality"]

VALUE_FUNCTIONS = {
    "Cost": make_linear_vf([(100, 1.0), (200, 0.0)]),      # decreasing: cheaper is better
    "Quality": make_linear_vf([(0, 0.0), (10, 1.0)]),       # increasing: higher score is better
}

# Confidence: Cost = 4 (no value-function-level error; all of Cost's uncertainty
# enters through the input data below). Quality = 2 (5% uniform error band
# around the value-function output; Quality's raw input is deterministic).
CONFIDENCE = {"Cost": 4, "Quality": 2}
QUALITY_ERROR_PCT = 0.05  # from worker/scripts/upmavt.py::evaluate_alternative's confidence_errors table

# A single BWT judgment: "Cost at its best is worth as much as Quality improving
# from its worst (0) to 6" -> VF_Quality(6) = 0.6. Unaffected by the alternatives'
# uncertainty below, since it is defined at the criterion level.
COMPARISONS = [
    {
        "REFERENCE_CRITERION": "Cost",
        "ADJUSTED_CRITERION": "Quality",
        "DATA_VALUE": 6,
        "TYPE": "best",
        "GROUP": "single-group",
    },
]

# Cost: uncertain input data, "value +/- margin" (uniform, absolute). Quality:
# deterministic input; its uncertainty comes from CONFIDENCE above instead.
ALTERNATIVES = {
    "Supplier A": {"Cost": "105±5", "Quality": "2"},
    "Supplier B": {"Cost": "150±5", "Quality": "6"},
    "Supplier C": {"Cost": "195±5", "Quality": "9"},
    "Supplier D": {"Cost": "125±5", "Quality": "8"},
}

EXPECTED_WEIGHTS = {"Cost": 0.375, "Quality": 0.625}

# Closed-form mean and exact bounds for each alternative's weighted-sum score,
# derived in README.md ("Analytical propagation of uncertainty"). Cost's
# uniform margin (+/-5 EUR) maps, through the linear value function, to a
# uniform term of width 2*5/100 = 0.1 for every alternative. Quality's
# confidence band maps to a uniform term of width 2 * VF_Quality * 0.05,
# proportional to its deterministic base value.
EXPECTED = {
    "Supplier A": {"mean": 0.48125, "min": 0.45625, "max": 0.50625},
    "Supplier B": {"mean": 0.56250, "min": 0.52500, "max": 0.60000},
    "Supplier C": {"mean": 0.58125, "min": 0.534375, "max": 0.628125},
    "Supplier D": {"mean": 0.78125, "min": 0.73750, "max": 0.82500},
}


def main():
    print("=" * 70)
    print("STEP 1 -- Compute weights from the single BWT judgment")
    print("=" * 70)
    solutions = compute_weights(
        VALUE_FUNCTIONS, COMPARISONS, criteria_names=CRITERIA_NAMES,
        print_fn=lambda m: None, use_non_linear_model=True,
        parameter_overrides={"max_results": 5, "max_restarts": 50},
    )
    computed_weights = solutions[0]
    print("Computed:", json.dumps(computed_weights, indent=2))
    print("Expected (closed form):", json.dumps(EXPECTED_WEIGHTS, indent=2))
    for crit, expected in EXPECTED_WEIGHTS.items():
        assert abs(computed_weights[crit] - expected) < 1e-6, (
            f"Weight mismatch for {crit}: expected {expected}, got {computed_weights[crit]}"
        )
    print("PASS: computed weights match the closed-form solution.\n")

    print("=" * 70)
    print("STEP 2 -- Propagate uncertainty through weighted-sum MAVT aggregation")
    print("=" * 70)
    params = {
        "mc_iterations": 50000,
        "aggregation_method": "weighted_sum",
        "mc_mode": "non_strict",
        "use_random_weights": False,
        "opinion_weights": None,
    }
    results = run_upmavt(
        [VALUE_FUNCTIONS], [CONFIDENCE], [solutions],
        ALTERNATIVES, CRITERIA_NAMES, params, print_fn=lambda m: None,
    )
    alt_names = results["alternative_names"]
    rows = np.array(results["aggregated_results"])

    print(f"{'Alternative':12s} {'MC mean':>10s} {'Expected':>10s} {'MC min':>10s} {'Bound min':>10s} "
          f"{'MC max':>10s} {'Bound max':>10s}")
    all_ok = True
    for i, alt in enumerate(alt_names):
        col = rows[:, i]
        exp = EXPECTED[alt]
        mean_ok = abs(col.mean() - exp["mean"]) < 0.005   # standard error at 50k iterations is ~1e-4
        # Every sample is drawn from within [min, max] by construction (numpy's
        # uniform sampling never exceeds its bounds), so these must hold exactly,
        # up to floating-point tolerance.
        bounds_ok = (col.min() >= exp["min"] - 1e-9) and (col.max() <= exp["max"] + 1e-9)
        ok = mean_ok and bounds_ok
        all_ok = all_ok and ok
        print(f"{alt:12s} {col.mean():10.6f} {exp['mean']:10.6f} {col.min():10.6f} {exp['min']:10.6f} "
              f"{col.max():10.6f} {exp['max']:10.6f} {'OK' if ok else 'MISMATCH'}")

    if all_ok:
        print("\nPASS: every alternative's Monte Carlo mean matches the closed-form mean within "
              "tolerance, and every sample falls within the closed-form bounds.")
    else:
        raise SystemExit("FAIL: at least one alternative's simulated output did not match.")

    print("\nNote: the weight computation in Step 1 is seeded and reproducible; the Monte Carlo")
    print("simulation in Step 2 is not seeded, so re-running this script will draw a different")
    print("50,000 samples each time -- the mean and bounds checks above are expected to keep")
    print("passing regardless, since they hold for any sufficiently large sample.")


if __name__ == "__main__":
    main()
