#!/usr/bin/env python3
"""Turns scalability_benchmark.csv into the runtime/memory-vs-problem-size
plots documented in verification/README.md. One figure per axis (alternatives,
criteria, decision_makers, mc_iterations), each with two panels: runtime
(compute_weights and run_upmavt shown separately, since they scale very
differently -- see the README's timing note) and peak memory increase.
"""

import csv
import os
import statistics
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")
PLOTS_DIR = os.path.join(HERE, "plots")

AXIS_LABELS = {
    "alternatives": "number of alternatives (baseline: 6 criteria, 2 DMs, 2000 iters)",
    "criteria": "number of criteria (baseline: 6 alternatives, 2 DMs, 2000 iters)",
    "decision_makers": "number of decision-makers (baseline: 6 alternatives, 6 criteria, 2000 iters)",
    "mc_iterations": "MC iterations (baseline: 6 alternatives, 6 criteria, 2 DMs)",
}
MODE_STYLE = {"strict": {"color": "tab:blue", "label": "SMC (strict)"},
              "non_strict": {"color": "tab:orange", "label": "NSMC (non_strict)"}}


def _read_rows():
    with open(os.path.join(RESULTS_DIR, "scalability_benchmark.csv"), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _grouped(rows, axis, metric):
    # mode -> swept_value -> [values across repeats]
    out = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r["axis"] != axis:
            continue
        out[r["mc_mode"]][int(r["swept_value"])].append(float(r[metric]))
    return out


def plot_axis(rows, axis):
    fig, (ax_time, ax_mem) = plt.subplots(1, 2, figsize=(12, 5))

    cw_time = _grouped(rows, axis, "compute_weights_seconds")
    mc_time = _grouped(rows, axis, "run_upmavt_seconds")
    cw_mem = _grouped(rows, axis, "compute_weights_peak_mb")
    mc_mem = _grouped(rows, axis, "run_upmavt_peak_mb")

    for mode, style in MODE_STYLE.items():
        xs = sorted(cw_time.get(mode, {}))
        if not xs:
            continue
        ax_time.plot(xs, [statistics.mean(mc_time[mode][x]) for x in xs], marker="o",
                     color=style["color"], label=f"run_upmavt -- {style['label']}")
        ax_time.plot(xs, [statistics.mean(cw_time[mode][x]) for x in xs], marker="s", linestyle="--",
                     color=style["color"], alpha=0.6, label=f"compute_weights -- {style['label']}")

        # Median, not mean: at small problem sizes memory is dominated by
        # occasional unrelated background allocations rather than a real
        # signal (see run_scalability_benchmark.py's module docstring for the
        # repeated-run measurement that established this); the median is
        # robust to those spikes without discarding any data.
        ax_mem.plot(xs, [statistics.median(mc_mem[mode][x]) for x in xs], marker="o",
                    color=style["color"], label=f"run_upmavt -- {style['label']}")
        ax_mem.plot(xs, [statistics.median(cw_mem[mode][x]) for x in xs], marker="s", linestyle="--",
                    color=style["color"], alpha=0.6, label=f"compute_weights -- {style['label']}")

    ax_time.set_xlabel(AXIS_LABELS[axis])
    ax_time.set_ylabel("runtime (s)")
    ax_time.set_title("Runtime")
    ax_time.legend(fontsize=7)
    ax_time.grid(True, alpha=0.3)

    ax_mem.set_xlabel(AXIS_LABELS[axis])
    ax_mem.set_ylabel("peak memory increase (MB, median of repeats)")
    ax_mem.set_title("Memory")
    ax_mem.legend(fontsize=7)
    ax_mem.grid(True, alpha=0.3)

    fig.suptitle(f"Scalability -- sweeping {axis}")
    fig.tight_layout()
    out_path = os.path.join(PLOTS_DIR, f"scalability_{axis}.png")
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"wrote {out_path}")


def main():
    os.makedirs(PLOTS_DIR, exist_ok=True)
    rows = _read_rows()
    for axis in AXIS_LABELS:
        plot_axis(rows, axis)


if __name__ == "__main__":
    main()
