#!/usr/bin/env python3
"""
Replication script for case study 04: Sun, Kroesen & Rezaei (2026),
"Anchoring Bias in the Tradeoff Procedure Within Multi-Attribute Value
Theory", Journal of Behavioral Decision Making, 39(2), e70069,
doi:10.1002/bdm.70069.

This runs UP-MAVT's actual weight solver (worker/scripts/weight_space_
definition.py, unmodified) on Participant 64's published Best-Worst
Tradeoff (BWT) judgments (Table 3.6 of the paper / Chapter 3 of Sun's
PhD dissertation) and compares the computed weights against the paper's
own published BWT result for that participant (Table 3.7). It then
carries those weights through UP-MAVT's MAVT aggregation
(worker/scripts/upmavt.py) to produce a final ranking over two
illustrative apartments -- the paper itself does not publish a ranked
alternative set for Participant 64, so this second half is a
demonstration of the full decision pipeline, not a replication.

See README.md in this folder for the full derivation and discussion.

Usage (from anywhere):
    python run_replication.py
"""
import os
import sys
import json

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "worker"))

from scripts.weight_space_definition import compute_weights  # noqa: E402
from scripts.upmavt import run_upmavt  # noqa: E402


def make_linear_vf(points):
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


CRITERIA_NAMES = ["Rent", "CommuteDistance", "ShoppingDistance"]

# Points reverse-engineered from values reported in Table 3.7 of the paper
# -- see README.md, section "Reconstruction of the value functions".
V_RENT_1000 = 0.250 / 0.600      # 0.416667
V_RENT_1200 = 0.150 / 0.600      # 0.25
V_COMMUTE_10 = 0.143 / 0.286     # 0.5

VALUE_FUNCTIONS = {
    "Rent": make_linear_vf([(600, 1.0), (1000, V_RENT_1000), (1200, V_RENT_1200), (1500, 0.0)]),
    "CommuteDistance": make_linear_vf([(5, 1.0), (10, V_COMMUTE_10), (15, 0.0)]),
    "ShoppingDistance": make_linear_vf([(100, 1.0), (500, 0.0)]),  # never evaluated at an interior point
}

# Participant 64's complete Best-Worst Tradeoff elicitation (Table 3.2 / 3.6 of the
# paper), translated into UP-MAVT's REFERENCE/ADJUSTED comparison schema -- see
# README.md, section "Mapping onto UP-MAVT's BWT schema".
COMPARISONS = [
    {"REFERENCE_CRITERION": "CommuteDistance", "ADJUSTED_CRITERION": "Rent", "DATA_VALUE": 1000, "TYPE": "best", "GROUP": "single-group"},
    {"REFERENCE_CRITERION": "ShoppingDistance", "ADJUSTED_CRITERION": "Rent", "DATA_VALUE": 1200, "TYPE": "best", "GROUP": "single-group"},
    {"REFERENCE_CRITERION": "ShoppingDistance", "ADJUSTED_CRITERION": "CommuteDistance", "DATA_VALUE": 10, "TYPE": "worst", "GROUP": "single-group"},
]

# Paper's published BWT weights for Participant 64 (Table 3.7).
PUBLISHED_BWT_WEIGHTS = {"Rent": 0.593, "CommuteDistance": 0.264, "ShoppingDistance": 0.143}

# Two illustrative apartments, not present in the paper, used to demonstrate the
# full decision pipeline (weights -> value functions -> final ranking).
ALTERNATIVES = {
    "Apartment A (cheap, far)": {"Rent": "650", "CommuteDistance": "14", "ShoppingDistance": "480"},
    "Apartment B (expensive, close)": {"Rent": "1450", "CommuteDistance": "6", "ShoppingDistance": "120"},
}


def main():
    print(f"Reconstructed value-function points: "
          f"V_Rent(1000)={V_RENT_1000:.6f}  V_Rent(1200)={V_RENT_1200:.6f}  "
          f"V_Commute(10)={V_COMMUTE_10:.6f}\n")

    print("=" * 70)
    print("STEP 1 -- Compute weights from Participant 64's 3 BWT judgments")
    print("=" * 70)
    solutions = compute_weights(
        VALUE_FUNCTIONS, COMPARISONS, criteria_names=CRITERIA_NAMES,
        print_fn=lambda m: None, use_non_linear_model=True,
        parameter_overrides={"max_results": 5, "max_restarts": 80},
    )
    computed = solutions[0]

    print(f"{'criterion':18s} {'computed':>10s} {'published':>10s} {'|diff|':>8s}")
    max_abs_diff = 0.0
    for crit in CRITERIA_NAMES:
        diff = abs(computed[crit] - PUBLISHED_BWT_WEIGHTS[crit])
        max_abs_diff = max(max_abs_diff, diff)
        print(f"{crit:18s} {computed[crit]:10.3f} {PUBLISHED_BWT_WEIGHTS[crit]:10.3f} {diff:8.3f}")
    print(f"\nMaximum absolute weight difference: {max_abs_diff:.3f}")
    assert max_abs_diff < 0.01, "Unexpectedly large deviation from the published BWT weights."
    print("PASS: UP-MAVT reproduces the published Participant 64 BWT weights within 0.01.\n")

    print("=" * 70)
    print("STEP 2 -- Apply the computed weights to two illustrative apartments")
    print("=" * 70)
    params = {
        "mc_iterations": 200,
        "aggregation_method": "weighted_sum",
        "mc_mode": "non_strict",
        "use_random_weights": False,
        "opinion_weights": None,
    }
    results = run_upmavt(
        [VALUE_FUNCTIONS], [dict.fromkeys(CRITERIA_NAMES, 4)], [solutions],
        ALTERNATIVES, CRITERIA_NAMES, params, print_fn=lambda m: None,
    )
    alt_names = results["alternative_names"]
    scores = {alt: results["aggregated_results"][0][i] for i, alt in enumerate(alt_names)}

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    print(f"{'Alternative':32s} {'Score':>10s}")
    for alt, score in ranked:
        print(f"{alt:32s} {score:10.6f}")
    print(f"\nFinal ranking: {' > '.join(alt for alt, _ in ranked)}")


if __name__ == "__main__":
    main()
