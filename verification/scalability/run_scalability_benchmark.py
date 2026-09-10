#!/usr/bin/env python3
"""
Scalability benchmark: how do runtime and memory scale with problem size?

Sweeps four axes independently -- number of alternatives, number of criteria,
number of decision-makers, and MC iteration count -- each time holding the
other three at a fixed baseline size, using the synthetic case generator in
generate_synthetic_case.py so every axis is measured on a controlled,
apples-to-apples problem (the real bundled examples differ on multiple axes
at once, which is why the convergence study's runtimes -- see
verification/convergence/results/convergence_runtime.csv -- are cited in the
README as a real-world cross-check rather than used directly here).

Runtime is measured with time.perf_counter() around two separately-timed
phases (compute_weights, the one-time BWT solve, and run_upmavt, the MC loop
-- see verification/README.md for why these scale very differently). Memory
is measured by sampling the process's RSS (via `psutil`) from a background
thread every 10ms while the call runs, and reporting the peak increase over
the pre-call baseline. An earlier version of this script used the stdlib
`tracemalloc` instead; it was dropped after measurement showed it both
under-reports memory here (compute_weights is numpy/scipy-heavy, and
tracemalloc's default Python-allocator hook is largely blind to numpy's
C-level buffers) and adds a large timing overhead (found empirically to be
roughly 6x) that would have contaminated the runtime numbers above -- see
verification/README.md's memory-measurement note.

At small problem sizes, the RSS-sampling approach itself is noisy: a
configuration's true incremental memory need can be small enough that
unrelated background allocations (garbage collection, OS page-allocator
behavior, the sampling thread's own scheduling) dominate the measurement.
Confirmed empirically by rerunning one low-criteria configuration six times:
runtime was stable (~0.37s every time) while peak memory ranged from 0.055
to 2.961 MB with no trend -- pure noise, not a real signal. `make_plots.py`
therefore plots the MEDIAN across repeats for memory (robust to this kind of
occasional spike) while continuing to use the mean for runtime (which does
not show this problem).

Because compute_weights' Differential-Evolution search cost grows steeply
with the number of criteria -- and, we found empirically, can occasionally
take far longer than average on a PERFECTLY self-consistent synthetic case
(the generator's z*=0 feasible region is a single sharp point in weight
space, which is a harder target for DE than the wider, naturally-fuzzy
feasible band real elicited data produces) -- ALL axes use REDUCED solver
effort (`REDUCED_SOLVER_PARAMS` below) so the sweep finishes in a reasonable,
predictable time. This changes the absolute runtime but not the scaling
trend the benchmark is after; see verification/README.md's timing note for
the measurements that led to this choice.

Usage
-----
    cd verification/scalability
    python run_scalability_benchmark.py [--quick]
"""

import argparse
import csv
import os
import sys
import threading
import time

import psutil

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "worker"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scripts.weight_space_definition import compute_weights  # noqa: E402
from scripts.upmavt import run_upmavt  # noqa: E402
from generate_synthetic_case import generate_case  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")

BASELINE = {"num_alternatives": 6, "num_criteria": 6, "num_dms": 2, "mc_iterations": 2000}
REDUCED_SOLVER_PARAMS = {"de_maxiter": 60, "de_popsize": 8, "max_restarts": 15}
MODES = ["strict", "non_strict"]

FULL_AXES = {
    "alternatives": [3, 6, 10, 15, 25, 40],
    "criteria": [3, 5, 7, 10, 14],
    "decision_makers": [1, 2, 3, 5, 8],
    "mc_iterations": [100, 500, 1000, 2000, 5000, 10000],
}
QUICK_AXES = {
    "alternatives": [3, 10],
    "criteria": [3, 6],
    "decision_makers": [1, 3],
    "mc_iterations": [100, 1000],
}
FULL_REPEATS = 6
QUICK_REPEATS = 1


_PROCESS = psutil.Process()


def _timed_memory(fn, sample_interval_s=0.01):
    """Run fn(), timing it with a plain (unperturbed) perf_counter, while a
    background thread samples this process's RSS to find the peak increase
    over the pre-call baseline. See the module docstring for why this
    replaced an earlier tracemalloc-based approach.
    """
    baseline_rss = _PROCESS.memory_info().rss
    peak_rss = [baseline_rss]
    stop_flag = threading.Event()

    def sampler():
        while not stop_flag.is_set():
            peak_rss[0] = max(peak_rss[0], _PROCESS.memory_info().rss)
            stop_flag.wait(sample_interval_s)

    thread = threading.Thread(target=sampler, daemon=True)
    thread.start()
    t0 = time.perf_counter()
    result = fn()
    elapsed = time.perf_counter() - t0
    stop_flag.set()
    thread.join()
    peak_rss[0] = max(peak_rss[0], _PROCESS.memory_info().rss)

    peak_increase_mb = max(0.0, (peak_rss[0] - baseline_rss) / (1024 * 1024))
    return result, elapsed, peak_increase_mb


def run_configuration(num_alternatives, num_criteria, num_dms, mc_iterations, mc_mode, seed,
                       solver_params=None):
    case = generate_case(num_alternatives, num_criteria, num_dms, seed=seed)

    def do_compute_weights():
        return [
            compute_weights(s.vf, s.comparisons, criteria_names=case.criteria_names,
                             use_non_linear_model=True, print_fn=lambda *a, **k: None,
                             parameter_overrides=solver_params)
            for s in case.sessions
        ]

    weight_solutions_list, cw_seconds, cw_peak_mb = _timed_memory(do_compute_weights)

    def do_run_upmavt():
        params = {"mc_iterations": mc_iterations, "mc_mode": mc_mode, "aggregation_method": "weighted_sum"}
        return run_upmavt([s.vf for s in case.sessions], [s.confidence for s in case.sessions],
                           weight_solutions_list, case.alternatives, case.criteria_names, params,
                           print_fn=lambda *a, **k: None)

    _, mc_seconds, mc_peak_mb = _timed_memory(do_run_upmavt)

    return {
        "compute_weights_seconds": round(cw_seconds, 4),
        "compute_weights_peak_mb": round(cw_peak_mb, 3),
        "run_upmavt_seconds": round(mc_seconds, 4),
        "run_upmavt_peak_mb": round(mc_peak_mb, 3),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()

    axes = QUICK_AXES if args.quick else FULL_AXES
    repeats = QUICK_REPEATS if args.quick else FULL_REPEATS

    os.makedirs(RESULTS_DIR, exist_ok=True)
    rows = []

    axis_param_key = {
        "alternatives": "num_alternatives", "criteria": "num_criteria",
        "decision_makers": "num_dms", "mc_iterations": "mc_iterations",
    }

    for axis_name, values in axes.items():
        print(f"=== axis: {axis_name} ===")
        param_key = axis_param_key[axis_name]
        solver_params = REDUCED_SOLVER_PARAMS

        for value in values:
            config = dict(BASELINE)
            config[param_key] = value
            for mc_mode in MODES:
                for repeat_id in range(repeats):
                    seed = hash((axis_name, value, mc_mode, repeat_id)) % (2 ** 31)
                    stats = run_configuration(
                        config["num_alternatives"], config["num_criteria"], config["num_dms"],
                        config["mc_iterations"], mc_mode, seed, solver_params=solver_params,
                    )
                    rows.append({
                        "axis": axis_name, "swept_value": value, "mc_mode": mc_mode,
                        "repeat_id": repeat_id,
                        "num_alternatives": config["num_alternatives"],
                        "num_criteria": config["num_criteria"],
                        "num_dms": config["num_dms"],
                        "mc_iterations": config["mc_iterations"],
                        **stats,
                    })
            print(f"  {axis_name}={value}: done "
                  f"(cw={rows[-1]['compute_weights_seconds']}s, mc={rows[-1]['run_upmavt_seconds']}s)")

    out_path = os.path.join(RESULTS_DIR, "scalability_benchmark.csv")
    fieldnames = ["axis", "swept_value", "mc_mode", "repeat_id", "num_alternatives", "num_criteria",
                  "num_dms", "mc_iterations", "compute_weights_seconds",
                  "compute_weights_peak_mb", "run_upmavt_seconds", "run_upmavt_peak_mb"]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {out_path} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
