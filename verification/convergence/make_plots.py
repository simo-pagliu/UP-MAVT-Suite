#!/usr/bin/env python3
"""
Turns convergence_distributions.csv into the convergence plots documented in
verification/README.md, for the two case studies with genuine ranking
uncertainty (02, 03 -- see the README for why 01/04/05 are excluded: each has
one alternative that wins essentially every Monte Carlo draw, so there is no
run-to-run variation left to show).

The metric plotted is the actual MONTE CARLO ERROR -- the standard error of
the MC-estimated mean -- not the raw standard deviation of the value
distribution (which is a property of the input uncertainty model and does
not shrink with more iterations; see the README for that distinction). This
is exactly the `MC_std` diagnostic worker/scripts/upmavt.py::run_monte_carlo
itself computes and prints every 100 iterations during a real run:

    mc_std = sqrt( (1/(n*(n-1))) * (sum(x^2) - (1/n)*sum(x)^2) )
           = sample_std(ddof=1) / sqrt(n)

Algebraically, using the population std (ddof=0) that
convergence_distributions.csv's `std` column already records:

    mc_error = std / sqrt(n - 1)

(verified to match the app's own formula to full floating-point precision --
see the commit that introduced this script). Because this is a per-run
statistic, not something that needs repeated runs to observe, no rerun of
run_convergence_study.py was needed to add this: it's derived directly from
the existing collected data.

One plot per case study (02, 03), with SMC and NSMC as separate lines: mean
MC error across the 5 repeats (line) plus its min-max band, on log-log axes
against a 1/sqrt(N) reference line -- since mc_error is by construction
proportional to 1/sqrt(N) when the underlying std is roughly constant (which
it is, see the README), this should plot as a near-straight line parallel to
the reference.
"""

import csv
import math
import os
import statistics
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")
PLOTS_DIR = os.path.join(HERE, "plots")

CUTOFFS = [1000, 10000]
CASES = ["02", "03"]
CASE_LABELS = {
    "02": "02 · port selection + uncertainty",
    "03": "03 · nuclear reactor (large, hierarchical)",
}
MODES = ["strict", "non_strict"]
MODE_STYLE = {"strict": {"color": "tab:blue", "label": "SMC (strict)"},
              "non_strict": {"color": "tab:orange", "label": "NSMC (non_strict)"}}


def _read_csv(name):
    with open(os.path.join(RESULTS_DIR, name), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _mc_error_by_case(rows):
    """case_key -> mc_mode -> mc_iterations -> [one mc_error value per repeat],
    where each repeat's value is mc_error = std / sqrt(n - 1) per (alternative,
    elicitation_id) row, averaged over alternative and elicitation_id.
    """
    per_repeat = defaultdict(list)  # (case, mode, iters, repeat) -> [mc_error values]
    for r in rows:
        if r["case_key"] not in CASES or r["std"] == "":
            continue
        n = int(r["mc_iterations"])
        if n < 2:
            continue
        mc_error = float(r["std"]) / math.sqrt(n - 1)
        key = (r["case_key"], r["mc_mode"], n, r["repeat_id"])
        per_repeat[key].append(mc_error)

    out = defaultdict(lambda: defaultdict(list))  # (case, mode) -> iters -> [per-repeat avg]
    for (case, mode, iters, _repeat), values in per_repeat.items():
        out[(case, mode)][iters].append(sum(values) / len(values))

    # Reshape to case -> mode -> iters -> [per-repeat avg]
    reshaped = defaultdict(dict)
    for (case, mode), by_iters in out.items():
        reshaped[case][mode] = by_iters
    return reshaped


def _mark_cutoffs(ax):
    for cutoff in CUTOFFS:
        ax.axvline(cutoff, color="gray", linestyle="--", linewidth=1)
        ax.text(cutoff, ax.get_ylim()[1], f" {cutoff:,}", rotation=90, va="top", ha="left",
                fontsize=8, color="gray")


def _plot_mc_error(data, case_key, out_path, title):
    fig, ax = plt.subplots(figsize=(8, 5.5))

    all_xs = set()
    for mode in MODES:
        by_iters = data.get(case_key, {}).get(mode, {})
        if not by_iters:
            continue
        xs = sorted(by_iters)
        all_xs.update(xs)
        means = [statistics.mean(by_iters[n]) for n in xs]
        lows = [min(by_iters[n]) for n in xs]
        highs = [max(by_iters[n]) for n in xs]
        style = MODE_STYLE[mode]
        ax.plot(xs, means, marker="o", color=style["color"], label=style["label"])
        ax.fill_between(xs, lows, highs, alpha=0.15, color=style["color"])

    # 1/sqrt(N) reference line, anchored to SMC's value at the smallest
    # iteration count.
    if all_xs:
        xs_sorted = sorted(all_xs)
        anchor_by_iters = data.get(case_key, {}).get(MODES[0], {})
        if anchor_by_iters:
            x0 = xs_sorted[0]
            y0 = statistics.mean(anchor_by_iters[x0])
            ref_ys = [y0 * math.sqrt(x0 / n) for n in xs_sorted]
            ax.plot(xs_sorted, ref_ys, linestyle=":", color="gray", label="1/√N reference")

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("MC iterations")
    ax.set_ylabel("Monte Carlo error (std/√(N-1), averaged over alternatives)")
    ax.set_title(title)
    _mark_cutoffs(ax)
    ax.legend(fontsize=8, loc="best")
    ax.grid(True, which="both", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"wrote {out_path}")


def main():
    os.makedirs(PLOTS_DIR, exist_ok=True)
    dist_rows = _read_csv("convergence_distributions.csv")
    mc_error_data = _mc_error_by_case(dist_rows)

    for case_key in CASES:
        label = CASE_LABELS[case_key]
        out_path = os.path.join(PLOTS_DIR, f"convergence_mc_error_{case_key}.png")
        _plot_mc_error(mc_error_data, case_key, out_path, f"Monte Carlo error vs. iterations -- {label}")


if __name__ == "__main__":
    main()
