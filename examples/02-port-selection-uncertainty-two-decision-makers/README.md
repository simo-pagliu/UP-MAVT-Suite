# 02 — Port Selection with Uncertainty and Two Decision-Makers

## 1. Source

This case study is a variation of
[`01-port-selection-liang-et-al`](../01-port-selection-liang-et-al/), built from the same seven
ports and six criteria (data from Liang, Brunelli & Rezaei, 2022,
https://doi.org/10.1016/j.ins.2022.07.097). It is not intended as a literature replication; it
is a self-produced demonstration of features the base reference case study does not exercise.

## 2. What it demonstrates

- **Input data uncertainty on every quantitative criterion.** Values are given as probability
  distributions instead of point estimates: Gaussian (`N(106, 3)`), uniform (`U(9, 13)`),
  trapezoidal (`TRAP(3.8, 4.1, 4.3, 4.6)`), and histogram
  (`(3.6-3.75: 30%, 3.75-3.9: 45%, ...)`). See `USER_MANUAL/img/input-distribution-modal.png`
  for the corresponding editor in the user interface.
- **A qualitative criterion.** "Satisfaction with terminal operations" is elicited from each
  decision-maker as a drag-and-drop ranking of the seven ports instead of entered as raw data
  (see Part 3, Step 2 of [`USER_MANUAL/`](../../USER_MANUAL/)).
- **Two decision-makers** (sessions `MIZ5AY6R` and `LT1VZJSZ`) instead of one, so that the
  aggregation, uncertainty, and consensus analysis steps of the "Run UP-MAVT" pipeline — which
  have nothing to combine or compare with a single decision-maker — are exercised.

## 3. Purpose

A ready-to-import case study for exercising the parts of the software not covered by the
deterministic, single-decision-maker path: distribution editing, qualitative ranking,
multi-decision-maker aggregation (WAM/GEO/HAR), uncertainty analysis, and consensus analysis.

## Contents

```text
case_study.zip
├── metadata.json                    # "Validation Study - With Uncertainty"
├── input/input.json                 # 7 ports x 6 criteria, each cell a distribution string
├── sessions/MIZ5AY6R.json           # decision-maker 1
├── sessions/LT1VZJSZ.json           # decision-maker 2
└── csv/{MIZ5AY6R,LT1VZJSZ}/         # each session's data, exported as CSV
```

This case study is available for import from the application's login page ("Upload a case study
(.zip file)"), and is served directly by the backend at `GET /api/example-case-study/2`.
