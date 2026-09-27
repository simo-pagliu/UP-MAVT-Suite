#!/usr/bin/env python3
"""
Convergence study: how many Monte Carlo iterations does UP-MAVT need before its
output stabilizes?

For all five bundled example case studies, and for both SMC (strict) and NSMC
(non_strict) modes, this sweeps the MC iteration count over a log-spaced grid
that includes 1,000 and 10,000, repeating each configuration several times to
capture run-to-run variance. For every run it records:

- per-alternative mean/std of the value distribution (-> STD/MEAN% ratio),
- the rank-1 probability of every alternative (-> "does the winner stabilize?"),
- wall-clock runtime (reused by the scalability benchmark's MC-iterations axis).

Usage
-----
    cd verification/convergence
    python run_convergence_study.py [--quick]

--quick runs a much smaller grid/repeat count, useful to sanity-check the script
itself before committing to the full (~30 minute) run.

The BWT weight solutions (the expensive, one-time-per-case step; see the timing
note in verification/README.md) are cached to results/_weight_cache/ so re-running
this script after a crash does not repeat that search.
"""

import argparse
import csv
import json
import os
import sys
import time

import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "verification", "common"))
sys.path.insert(0, os.path.join(REPO_ROOT, "worker"))

from load_example import EXAMPLES, load_example, compute_weight_solutions  # noqa: E402
from scripts.upmavt import run_upmavt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")
CACHE_DIR = os.path.join(RESULTS_DIR, "_weight_cache")

FULL_ITERATION_GRID = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
FULL_REPEATS = 5
QUICK_ITERATION_GRID = [50, 500, 1000]
QUICK_REPEATS = 2
MODES = ["strict", "non_strict"]
AGGREGATION_METHOD = "weighted_sum"


def get_weight_solutions_cached(case):
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f"{case.key}_nonlinear.json")
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    t0 = time.perf_counter()
    weight_solutions_list = compute_weight_solutions(case, use_non_linear_model=True)
    elapsed = time.perf_counter() - t0
    print(f"  [{case.key}] compute_weights took {elapsed:.1f}s "
          f"({[len(ws) for ws in weight_solutions_list]} solutions per session)")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(weight_solutions_list, f)
    return weight_solutions_list


def rank1_probabilities(rows, alt_names):
    """rows: list of score-vectors (one per MC iteration, in alt_names order).
    Returns {alt_name: fraction of iterations where that alternative scored highest}.
    """
    arr = np.array(rows)
    winners = np.argmax(arr, axis=1)
    counts = np.bincount(winners, minlength=len(alt_names))
    total = len(rows)
    return {alt: counts[i] / total for i, alt in enumerate(alt_names)}


def run_one(case, weight_solutions_list, mc_mode, mc_iterations):
    vf_lists = [s.vf for s in case.sessions]
    confidence_lists = [s.confidence for s in case.sessions]
    params = {"mc_iterations": mc_iterations, "mc_mode": mc_mode, "aggregation_method": AGGREGATION_METHOD}
    t0 = time.perf_counter()
    result = run_upmavt(vf_lists, confidence_lists, weight_solutions_list, case.alternatives,
                         case.criteria_names, params, print_fn=lambda *a, **k: None)
    elapsed = time.perf_counter() - t0

    alt_names = result["alternative_names"]
    per_elicitation = {}
    if mc_mode == "strict":
        for elicit_idx_str, rows in result["results_by_elicitation"].items():
            per_elicitation[elicit_idx_str] = rows
    else:
        per_elicitation["pooled"] = result["aggregated_results"]

    return per_elicitation, alt_names, elapsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="small grid/repeats, for sanity-checking the script")
    parser.add_argument("--cases", nargs="*", default=list(EXAMPLES.keys()), help="subset of case keys to run")
    args = parser.parse_args()

    iteration_grid = QUICK_ITERATION_GRID if args.quick else FULL_ITERATION_GRID
    repeats = QUICK_REPEATS if args.quick else FULL_REPEATS

    os.makedirs(RESULTS_DIR, exist_ok=True)
    dist_path = os.path.join(RESULTS_DIR, "convergence_distributions.csv")
    rank_path = os.path.join(RESULTS_DIR, "convergence_rank1_probability.csv")
    runtime_path = os.path.join(RESULTS_DIR, "convergence_runtime.csv")

    dist_rows = []
    rank_rows = []
    runtime_rows = []

    for case_key in args.cases:
        print(f"=== case {case_key} ===")
        case = load_example(case_key)
        weight_solutions_list = get_weight_solutions_cached(case)

        for mc_mode in MODES:
            for mc_iterations in iteration_grid:
                for repeat_id in range(repeats):
                    per_elicitation, alt_names, elapsed = run_one(
                        case, weight_solutions_list, mc_mode, mc_iterations
                    )
                    runtime_rows.append({
                        "case_key": case_key, "case_name": case.name, "mc_mode": mc_mode,
                        "mc_iterations": mc_iterations, "repeat_id": repeat_id,
                        "wallclock_seconds": round(elapsed, 4),
                    })
                    for elicit_id, rows in per_elicitation.items():
                        arr = np.array(rows)
                        rank1 = rank1_probabilities(rows, alt_names)
                        for j, alt in enumerate(alt_names):
                            col = arr[:, j]
                            mean = float(col.mean())
                            std = float(col.std())
                            dist_rows.append({
                                "case_key": case_key, "case_name": case.name, "mc_mode": mc_mode,
                                "mc_iterations": mc_iterations, "repeat_id": repeat_id,
                                "elicitation_id": elicit_id, "alternative": alt,
                                "mean": round(mean, 6), "std": round(std, 6),
                                "std_over_mean_pct": round(100.0 * std / mean, 4) if mean > 1e-9 else "",
                            })
                            rank_rows.append({
                                "case_key": case_key, "case_name": case.name, "mc_mode": mc_mode,
                                "mc_iterations": mc_iterations, "repeat_id": repeat_id,
                                "elicitation_id": elicit_id, "alternative": alt,
                                "rank1_probability": round(rank1[alt], 4),
                            })
                print(f"  [{case_key}] mode={mc_mode} n={mc_iterations}: {repeats} repeats done "
                      f"(last run {elapsed:.2f}s)")

    def write_csv(path, rows, fieldnames):
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"wrote {path} ({len(rows)} rows)")

    write_csv(dist_path, dist_rows,
              ["case_key", "case_name", "mc_mode", "mc_iterations", "repeat_id", "elicitation_id",
               "alternative", "mean", "std", "std_over_mean_pct"])
    write_csv(rank_path, rank_rows,
              ["case_key", "case_name", "mc_mode", "mc_iterations", "repeat_id", "elicitation_id",
               "alternative", "rank1_probability"])
    write_csv(runtime_path, runtime_rows,
              ["case_key", "case_name", "mc_mode", "mc_iterations", "repeat_id", "wallclock_seconds"])


if __name__ == "__main__":
    main()
