# Supplementary material: scalability of the UP-MAVT solver

This document reports runtime and memory scaling for UP-MAVT Suite's two-stage
computational pipeline: a Best-Worst Tradeoff (BWT) weight solver
(`compute_weights`) followed by a Monte Carlo simulation (`run_upmavt`), run
in both of its two modes, Strict (SMC) and Non-Strict (NSMC) Monte Carlo. It
accompanies the main manuscript's scalability summary.

**Summary.** Memory usage is low across every configuration tested, from
tens of kilobytes at the smallest problem sizes to a few megabytes at the
largest. Runtime is the meaningful cost driver, and it is concentrated
almost entirely in the weight-elicitation solver at high criteria counts;
the Monte Carlo simulation itself remains cheap even at the largest problem
sizes tested.

## 1. Method

We generated synthetic case studies parametrized by the number of
alternatives, criteria, and decision-makers, with linear value functions and
internally self-consistent Best-Worst Tradeoff judgments (a target weight
vector is drawn first, then each comparison's declared value is computed to
match it exactly, guaranteeing the weight solver's feasible region is
non-empty at every problem size). Four axes were swept independently, each
holding the other three parameters at a fixed baseline (6 alternatives, 6
criteria, 2 decision-makers, 2,000 Monte Carlo iterations):

| Axis | Values swept |
|---|---|
| Alternatives | 3, 6, 10, 15, 25, 40 |
| Criteria | 3, 5, 7, 10, 14 |
| Decision-makers | 1, 2, 3, 5, 8 |
| MC iterations | 100, 500, 1,000, 2,000, 5,000, 10,000 |

Each configuration was run 6 times under both SMC and NSMC. Runtime was
measured separately for the weight-solving stage and the Monte Carlo stage
with `time.perf_counter()`, since the two scale very differently (§3).
Peak memory was measured as the increase in process RSS over a pre-call
baseline, sampled from a background thread every 10ms; the plotted value is
the median across the six repeats.

The weight solver uses a Differential-Evolution global optimizer whose cost
grows steeply with the number of criteria; to keep the sweep's total runtime
predictable, all configurations here use a reduced search-effort budget
(`de_maxiter=60`, `de_popsize=8`, `max_restarts=15` vs. the application's
defaults of 1000/15/300). This changes the absolute weight-solving runtimes
reported below but not the scaling trend, which is what this benchmark
measures. A cross-check against the application's real bundled example case
studies, run at full solver effort, is given in §4.

**A limitation of the memory measurement at small scale.** Process-level RSS
sampling is limited by measurement resolution once the true memory footprint
drops to tens of kilobytes: repeating one low-criteria configuration six
times found runtime stable to within a few percent every time, while peak
memory ranged from 0.055 to 2.96 MB with no trend — background allocations
(garbage collection, OS page-allocator behavior) are comparable in size to
the signal itself at that scale. The median (used throughout, see above) is
robust to this, but for the two axes whose baseline keeps true memory in
that sub-0.5 MB range for their entire sweep (criteria, decision-makers),
the memory panel's *order of magnitude* is meaningful while its exact shape
should not be over-interpreted. The alternatives axis, where true memory
grows into the low megabytes, does not have this limitation.

## 2. Results by axis

**Criteria (Figure `plots/scalability_criteria.png`).** Weight-solving time
grows steeply and non-linearly with the number of criteria: 0.9s at 3
criteria to 11.5s at 14 criteria (reduced-effort settings; see §1). The Monte
Carlo stage, by contrast, grows only mildly (0.38s to 1.55s at 2,000
iterations), since each additional criterion adds only one more term to a
per-iteration weighted sum. **Criteria count is the dominant cost driver for
the weight-solving stage.** Memory stays under 0.2 MB throughout this axis's
sweep — see the measurement-limitation note in §1 before reading its exact
shape.

**Decision-makers (Figure `plots/scalability_decision_makers.png`).**
Weight-solving cost grows linearly with the number of decision-makers under
both modes (it is computed once per elicitation session regardless of mode).
The Monte Carlo stage's *runtime* shows a clear, mode-dependent difference:
under SMC, runtime grows **linearly** with the number of decision-makers,
because SMC retains one full result series per decision-maker; under NSMC,
runtime is **flat** regardless of decision-maker count, because NSMC pools
all decision-makers into a single result series, drawing one
decision-maker's weights per iteration independent of how many exist. This
is a direct, measurable consequence of the two modes' definitions. Memory
follows the same SMC-linear/NSMC-flat shape (0.004→0.10 MB vs. 0.004→0.04 MB
from 1 to 8 decision-makers), corroborating the runtime finding, but stays
in the sub-0.5 MB range where the §1 measurement-limitation note applies.

**Alternatives (Figure `plots/scalability_alternatives.png`).**
Weight-solving cost is essentially independent of the number of
alternatives (it depends only on the number of criteria and BWT
comparisons). Monte Carlo runtime grows mildly with alternative count, since
each iteration evaluates one score per alternative. This axis's memory
signal is the clearest, highest-confidence measurement in this benchmark:
Monte Carlo peak memory grows from 0.14 MB (3 alternatives) to 3.45 MB (40
alternatives), well above the measurement limitation discussed in §1 —
and still a modest absolute figure.

**MC iterations (Figure `plots/scalability_mc_iterations.png`).** Monte
Carlo runtime grows linearly with iteration count, as expected for repeated
independent draws (0.035s→3.71s for SMC, 0.021s→2.24s for NSMC, 100→10,000
iterations). Weight-solving cost is flat with respect to iteration count,
since the two stages are independent.

## 3. Summary

| Parameter | Dominant cost | Scaling |
|---|---|---|
| Criteria | Weight-solving (BWT search) | Steep, super-linear |
| Decision-makers | Monte Carlo, SMC mode only | Linear |
| Decision-makers | Monte Carlo, NSMC mode | Flat |
| Alternatives | Monte Carlo (mildly) | Mild, roughly linear |
| MC iterations | Monte Carlo | Linear |

Across all configurations tested, peak memory increase stayed below 4 MB —
negligible relative to typical available system memory, and not a practical
constraint at any problem size exercised here. Runtime is the resource that
matters: for practitioners, studies with many criteria should budget the
most time for the one-time weight-solving step (Step 1 of the "Run UP-MAVT"
pipeline; see `USER_MANUAL/README.md`).

## 4. Cross-check against real data

The convergence study, a companion analysis in this repository's
`verification/` folder (see `verification/README.md` §2), independently
measured wall-clock runtime for all five of the application's bundled
example case studies, at full (non-reduced) solver effort, across the same
MC-iteration grid used here. The largest of these — a 6-alternative,
15-criterion, 3-decision-maker hierarchical case study — took 36.4s for
10,000 SMC iterations and 12.6s for 10,000 NSMC iterations (SMC/NSMC
ratio ≈2.9×, consistent with its 3 decision-makers), and its
weight-solving step (full effort) took 639s — three orders of magnitude
above the few-second costs seen for the smaller bundled examples, the
real-world instance of the criteria-count scaling trend in §2. These
figures corroborate the scaling trends measured on synthetic data above at
a realistic problem size. Full data: `verification/convergence/results/
convergence_runtime.csv`.

## 5. Reproducing this

```bash
cd verification/scalability
python run_scalability_benchmark.py
python make_plots.py
```

Raw data: `results/scalability_benchmark.csv`. Plots: `plots/`.
