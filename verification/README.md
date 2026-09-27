# Verification: convergence, scalability, and test coverage

This folder documents three verification studies for UP-MAVT Suite: how the Monte Carlo simulation converges with iteration count, how the computational pipeline scales with problem size, and what automated test coverage the codebase currently has.

Everything here drives the production solver code (`worker/scripts/upmavt.py` and `worker/scripts/weight_space_definition.py`, unmodified) directly in Python — no web app, no database, no Docker — the same pattern already used by `examples/04-tradeoff-elicitation-sun-kroesen-rezaei-2026/verification/` and `examples/05-analytically-tractable-verification/verification/`.

---

## 1. Data source and a loader-fidelity check

`common/load_example.py` loads all five bundled example case studies into the exact shapes `compute_weights`/`run_upmavt` expect:

- Examples 01–03 ship as `case_study.zip` (the app's own export format). The loader reads `input/input.json` and `sessions/*.json` directly out of the zip — these already carry value-function points and BWT comparisons in essentially the field names the solver uses.
- Examples 04–05 ship a `data/` folder, but the loader does **not** parse it: `value_functions.csv`/`bwt_comparisons.csv` there are semicolon-delimited and `input.csv` has an unquoted comma inside two alternative names ("Apartment A (cheap, far)"), so neither `csv.reader` nor `frontend/public/load_LOCAL.py`'s comma-only parsers can read them as shipped. Since 04 and 05 each already ship a `verification/run_*.py` script with this exact data hand-encoded as plain Python constants, already checked against the paper/closed-form results, the loader imports those constants directly instead.
- One subtlety reproduced deliberately, not "fixed": the application's own code builds the shared `alternatives` dict used by `run_upmavt` from only the **first** session's qualitative-indicator rankings, even with multiple decision-makers. The loader does the same, for fidelity to what the app actually computes.

**Fidelity check:** loading example 01 and running `compute_weights` with the **linear** model reproduces the weights published in `examples/01-port-selection-liang-et-al/README.md` exactly (Terminal handling charges 0.402, Port reputation 0.175, Satisfaction 0.136, Number of container terminals 0.155, ISPS 0.095, Customs service 0.036), and the resulting ranking puts Gdansk first, matching the README's stated result. This is the same check `worker/tests/regression/` runs automatically (§4).

---

## 2. Convergence study (`convergence/`)

### Method

For all five example case studies, and for both **SMC** (`strict`) and **NSMC** (`non_strict`), `run_convergence_study.py` sweeps `mc_iterations` over `[50, 100, 200, 500, 1,000, 2,000, 5,000, 10,000]`, repeating each configuration **5 times** (fresh random draws each time) to capture run-to-run variance. The BWT weight solutions (computed once per case with the **non-linear** model, the app's default) are cached in `results/_weight_cache/` since they don't depend on `mc_iterations` and, for the largest case, are themselves expensive to compute (see §3). For every run it records, per alternative: mean, std, and STD/MEAN%.

The plots and discussion below focus on cases **02** and **03**: the other three (01, 04, 05) each have one alternative that dominates essentially every Monte Carlo draw, leaving no run-to-run ranking uncertainty to show convergence *of*.

### What "convergence" means here

The raw STD (and STD/MEAN%) does not shrink as iterations increase. It is a property of the input uncertainty model — the confidence bands and input distributions declared for a case study — not of the sample size: running more iterations doesn't narrow a distribution that was defined to be wide, it estimates that distribution's width more precisely. That precision is what the **Monte Carlo error** measures. This is not a derived proxy metric: `worker/scripts/upmavt.py::run_monte_carlo` computes and reports it directly, every 100 iterations, during a real run, as a `MC_std` diagnostic:

```
mc_std = sqrt( (1/(n·(n-1))) · (Σx² - (1/n)·(Σx)²) )   =   sample_std(ddof=1) / sqrt(n)
```

This is the standard error of the Monte Carlo-estimated mean, not the standard deviation of the value distribution itself — the two are easy to conflate but answer different questions ("how wide is the input uncertainty" vs. "how precisely has its mean been estimated with N samples"). Only the second quantity is expected to shrink with more iterations, and by construction, close to `1/sqrt(N)`. It is derived directly from the already-collected `std` column: `mc_error = std / sqrt(n - 1)`, algebraically identical to the application's own formula.

| Case | Mode | MC error at n=50 | at n=1,000 | at n=10,000 | as % of the mean, at n=10,000 |
|---|---|---|---|---|---|
| 02 · port selection + uncertainty | SMC | 0.00472 | 0.00104 | 0.00033 | 0.060% |
| 02 · port selection + uncertainty | NSMC | 0.00652 | 0.00144 | 0.00046 | 0.083% |
| 03 · nuclear reactor (large) | SMC | 0.00711 | 0.00156 | 0.00050 | 0.101% |
| 03 · nuclear reactor (large) | NSMC | 0.01393 | 0.00308 | 0.00097 | 0.195% |

Plots (one per case, SMC and NSMC as separate lines, log-log, with a 1/√N reference line and the 1,000/10,000 cutoffs marked): `plots/convergence_mc_error_02.png`, `plots/convergence_mc_error_03.png`. Every case/mode combination tracks the 1/√N reference closely, the expected signature of unbiased Monte Carlo sampling.

A secondary observation: example 01's published result (Gdansk ranked first) uses the **linear** weight model; this convergence study uses the **non-linear** model, the application's default, under which the weight-space sampling instead makes Rotterdam the more probable winner. Both are correct outputs of the solver, answering slightly different questions — one fixed weight vector versus a sampled feasible region — and this is a reminder that the modeling choice, not just Monte Carlo iteration count, affects which alternative comes out on top.

### 1,000 / 10,000 iteration cutoffs

By 1,000 iterations, the Monte Carlo error is already down to roughly 0.19–0.62% of the mean value; by 10,000 it is down to 0.06–0.20%. **1,000 iterations is a reasonable minimum for exploratory use; 10,000 — the pipeline's own "Final Results" step default (see `USER_MANUAL/README.md`'s Step 5) — is where the estimate is precise enough to report.**

### Reproducing this

```bash
cd verification/convergence
python run_convergence_study.py          # ~30 min; --quick for a fast sanity check first
python make_plots.py
```

---

## 3. Scalability benchmark (`scalability/`)

**Summary: memory usage is low across every configuration tested, from tens of kilobytes up to a few megabytes at the largest problem sizes. Runtime is the meaningful cost driver, concentrated in the weight-elicitation solver at high criteria counts.**

### Method

`generate_synthetic_case.py` builds a parametrized synthetic case study for any (alternatives, criteria, decision-makers) size, with linear value functions and internally self-consistent Best-Worst Tradeoff comparisons: a target weight vector is drawn first, then every comparison's declared value is computed to match it exactly, guaranteeing the weight solver's feasible region is non-empty at every problem size. This keeps `compute_weights` well-behaved at every problem size, so the sweep measures scaling trends rather than the solver's handling of inconsistent judgments (which the convergence study's real elicited data already exercises).

`run_scalability_benchmark.py` sweeps four axes independently, each holding the others at a baseline (6 alternatives, 6 criteria, 2 decision-makers, 2,000 Monte Carlo iterations), 6 repeats each, both SMC and NSMC:

| Axis | Values swept |
|---|---|
| Alternatives | 3, 6, 10, 15, 25, 40 |
| Criteria | 3, 5, 7, 10, 14 |
| Decision-makers | 1, 2, 3, 5, 8 |
| MC iterations | 100, 500, 1,000, 2,000, 5,000, 10,000 |

Runtime is measured separately for `compute_weights` (the one-time BWT solve) and `run_upmavt` (the Monte Carlo loop) with `time.perf_counter()`, since the two scale differently. Memory is the peak process RSS increase over a pre-call baseline, sampled from a background thread every 10ms via `psutil`; the plotted value is the median across the six repeats.

The weight solver uses a Differential-Evolution global optimizer whose cost grows steeply with the number of criteria. To keep the sweep's total runtime predictable, all configurations use a reduced search-effort budget (`de_maxiter=60`, `de_popsize=8`, `max_restarts=15`, versus the application's defaults of 1000/15/300). This changes the absolute `compute_weights` runtimes reported below but not the scaling trend the benchmark measures. A cross-check against the application's real bundled example case studies, run at full solver effort, is given at the end of this section.

**On memory measurement.** Peak memory is measured by sampling process RSS from a background thread rather than with the standard-library `tracemalloc`, because `compute_weights`/`run_upmavt` are numpy/scipy-heavy and `tracemalloc`'s Python-allocator hook does not see numpy's C-level buffers, undercounting memory substantially while adding a large timing overhead. At small problem sizes, even RSS sampling is limited by measurement resolution: repeating one low-criteria configuration six times found runtime stable to within a few percent every time, while peak memory ranged from 0.055 to 2.96 MB with no trend — when the true memory footprint is only tens of kilobytes, background allocations (garbage collection, OS page-allocator behavior) are comparable in size to the signal itself. The median across repeats (used throughout) is robust to this, but for the two axes whose baseline keeps true memory in that sub-0.5 MB range for their entire sweep (criteria, decision-makers), the memory panel's order of magnitude is meaningful while its exact shape should not be over-interpreted. The alternatives axis, where true memory grows into the low megabytes, does not have this limitation.

### Results

**Criteria axis** is where runtime cost concentrates: `compute_weights` grows from ~0.9s (3 criteria) to ~11.5s (14 criteria, reduced-effort settings) — steep, consistent with a global optimizer over a growing search space. `run_upmavt`'s Monte Carlo loop, by contrast, grows only mildly (0.38s → 1.55s at 2,000 iterations), since it is a much cheaper per-iteration evaluation. Memory stays under 0.2 MB throughout this axis. See `plots/scalability_criteria.png`.

**Decision-makers axis** shows a clean structural runtime difference between the two Monte Carlo modes, a direct consequence of their definitions (see `USER_MANUAL/README.md`'s Glossary): under SMC, `run_upmavt` runtime grows linearly with the number of decision-makers, since SMC retains one full result series per decision-maker; under NSMC, runtime stays flat regardless of decision-maker count, since NSMC pools everyone into one series and draws one decision-maker's weights per iteration. `compute_weights` runtime grows linearly with decision-makers under both modes, since it is computed once per session either way. Memory follows the same SMC-linear/NSMC-flat shape (0.004 → 0.10 MB vs. 0.004 → 0.04 MB from 1 to 8 decision-makers), corroborating the runtime finding at small absolute values. See `plots/scalability_decision_makers.png`.

**Alternatives axis** is cheap on `compute_weights` (essentially flat — it depends only on the number of criteria and comparisons, not alternatives) and grows mildly on `run_upmavt` runtime (more alternatives evaluated per iteration). Its memory panel is the clearest high-confidence memory measurement in this benchmark: `run_upmavt` peak memory grows from 0.14 MB (3 alternatives) to 3.45 MB (40 alternatives), a clear, monotonic trend. See `plots/scalability_alternatives.png`.

**MC-iterations axis**: `run_upmavt` scales linearly with iteration count, as expected for repeated independent draws (0.035s → 3.71s for SMC, 0.021s → 2.24s for NSMC, 100 → 10,000 iterations). `compute_weights` runtime is flat with respect to iteration count, since the two stages are independent. See `plots/scalability_mc_iterations.png`.

**Cross-check against real data:** `convergence/results/convergence_runtime.csv` has wall-clock times for all five bundled example case studies, run at full solver effort, across the same iteration grid. The large hierarchical case (`03`, 6 alternatives, 15 criteria, 3 sessions) takes 36.4s for 10,000 SMC iterations and 12.6s for 10,000 NSMC iterations, and its weight-solving step takes 639s at full effort — consistent with the criteria-count scaling trend above at a larger, real problem size.

### Reproducing this

```bash
cd verification/scalability
python run_scalability_benchmark.py       # ~10-15 min; --quick for a fast sanity check first
python make_plots.py
```

`scalability_supplementary.md` in this folder is a standalone, self-contained write-up of this benchmark suitable for inclusion as paper supplementary material.

---

## 4. Test coverage (`test_coverage/`)

### Worker (`worker/scripts/` — the solver)

`upmavt.py` and `weight_space_definition.py` — the modules implementing the Monte Carlo engine and Best-Worst Tradeoff solver — previously had no automated tests. A test suite was added under `worker/tests/`:

- **`worker/tests/unit/`** (52 tests): every distribution-string format in the input DSL (`sample_from_distribution`: deterministic, `N()`, `U()`, `TRI()`, `±`, histogram, `TRAP()`, `CUSTOM_1()`, discrete `{}`), all three aggregation methods (WAM/GEO/HAR) against hand-computed values, the confidence-error-margin and `[0.001, 1.0]` clipping behavior in `evaluate_alternative`, weight sampling (including the Dirichlet fallback), the structural SMC-vs-NSMC difference in `run_monte_carlo`, and `compute_weights`'s exact recovery of a known target weight vector under both the linear and non-linear models.
- **`worker/tests/regression/`** (3 tests): the published-value checks already written by examples 04 and 05's own `verification/run_*.py` scripts, promoted into pytest functions that import those scripts' data unmodified.

```
Name                                 Stmts   Miss  Cover
------------------------------------------------------------
scripts/upmavt.py                      291     36    88%
scripts/weight_space_definition.py     211     23    89%
scripts/load_DB.py                     197    197     0%
------------------------------------------------------------
TOTAL                                  699    256    63%
```

All 59 new tests pass. `load_DB.py` (MongoDB-specific data-loading code, not exercised since these tests bypass the database) is the remaining gap; the two modules implementing the actual computation are at 88–89%. Full output: `test_coverage/worker_pytest_output.txt` (regenerate with `cd worker && pytest --cov=scripts --cov-report=term-missing`).

### Backend (`backend/app/`)

The backend already has a test suite of 378 tests split into `tests/unit/` (257) and `tests/integration/` (121); `pytest-cov` was added to measure coverage.

```
pytest --cov=app --cov-report=term-missing   ->   71% overall (357 passed, 21 failed)
```

The 21 failures are pre-existing and unrelated to the modules verified here: they trace to a mismatch between the CSV delimiter the application's export function (`frontend/src/utils/csvExport.js`) produces and the delimiter its own tests, `export_service.py`'s CSV builders, and `frontend/public/load_LOCAL.py`'s parser all expect. Full output: `test_coverage/backend_pytest_output.txt`.

### Frontend (`frontend/src/`)

The frontend already has 126 tests across 7 files; `@vitest/coverage-v8` and a `npm run test:coverage` script were added to measure coverage.

In this environment, `vitest run --coverage`'s final report-generation step does not complete (reproduced across `npm`/`npx`, PowerShell/git-bash, and both the `threads` and `forks` pools: raw per-file coverage is collected into `coverage/.tmp/*.json`, but the merge-and-report step that turns it into a percentage does not run, with no error raised). `test_coverage/frontend_coverage_fallback.js` computes an approximate figure directly from that raw data instead (see its docstring for methodology and caveats — it is block coverage over Vite's transformed module code, not sourcemap-remapped line coverage):

- 10 of 21 total source files are exercised by at least one test; those 10 average 86.8% block coverage.
- The other 11 files have no test touching them.
- Blended across all 21 files: roughly 41%.

Full output: `test_coverage/frontend_vitest_output.txt`; rerun the fallback with `node test_coverage/frontend_coverage_fallback.js frontend/coverage/.tmp` after `npm run test:coverage` in `frontend/`.

### Reproducing this

```bash
cd worker  && pip install -r requirements-test.txt && pytest --cov=scripts --cov-report=term-missing
cd backend && pip install -r requirements-test.txt && pytest --cov=app --cov-report=term-missing
cd frontend && npm install && npm run test:coverage
```

---

## Contents

```text
verification/
├── README.md                              # this file
├── requirements.txt                       # matplotlib, psutil, pytest-cov (analysis-only deps)
├── common/
│   └── load_example.py                    # shared loader for all 5 bundled examples (see §1)
├── convergence/
│   ├── run_convergence_study.py
│   ├── make_plots.py
│   ├── results/
│   │   ├── convergence_distributions.csv       # mean/std/STD-MEAN% per (case, mode, n, repeat, alt)
│   │   ├── convergence_rank1_probability.csv    # P(rank 1) per (case, mode, n, repeat, alt) -- raw data only, not plotted (see §2)
│   │   ├── convergence_runtime.csv              # wall-clock per (case, mode, n, repeat)
│   │   └── _weight_cache/                       # cached compute_weights() results (expensive, reused)
│   └── plots/
│       └── convergence_mc_error_{02,03}.png    # one plot per case, SMC/NSMC as lines -- see §2
├── scalability/
│   ├── generate_synthetic_case.py
│   ├── run_scalability_benchmark.py
│   ├── make_plots.py
│   ├── scalability_supplementary.md       # standalone paper-supplementary write-up
│   ├── results/scalability_benchmark.csv
│   └── plots/scalability_{alternatives,criteria,decision_makers,mc_iterations}.png
└── test_coverage/
    ├── worker_pytest_output.txt
    ├── backend_pytest_output.txt
    ├── frontend_vitest_output.txt
    └── frontend_coverage_fallback.js
```

`worker/tests/` (unit + regression suite) and the test-coverage tooling changes (`frontend/vite.config.js`'s `test.coverage` block, `frontend/package.json`'s `test:coverage` script, `backend/requirements-test.txt`'s `pytest-cov`) live in their respective component directories, not here, since they are part of each component's own test suite rather than one-off verification artifacts.
