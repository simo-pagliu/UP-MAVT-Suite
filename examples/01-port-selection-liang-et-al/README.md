# 01 — Port Selection (Reference Case Study)

## 1. Source

The alternatives, criteria, and criteria data in this case study are taken from:

> Liang, F., Brunelli, M., & Rezaei, J. (2022). Best-worst Tradeoff method.
> *Information Sciences*, 610, 957–976. https://doi.org/10.1016/j.ins.2022.07.097

This paper introduces the Best-Worst Tradeoff method (BWT), the weight-elicitation method
UP-MAVT implements (see `worker/scripts/weight_space_definition.py`), and illustrates it with a
port-selection example: a shipping company choosing among seven candidate container ports
(Piraeus, Koper, Genoa, Antwerp, Rotterdam, Hamburg, Gdansk) on six quantitative criteria.

| Criterion | Unit | Preference direction |
|---|---|---|
| Terminal handling charges | EUR/TEU | lower is better |
| ISPS (security charge) | EUR/unit | lower is better |
| Customs service | score | higher is better |
| Port reputation | score | higher is better |
| Satisfaction with terminal operations | score | higher is better |
| Number of container terminals | count | higher is better |

This case study reproduces that data exactly (`input/input.json`) and defines one elicitation
session (`sessions/val1.json`) whose linear value functions and nine best-worst tradeoff
comparisons were set up to match the source paper's own worked example, so that UP-MAVT's
computed weights and final ranking can be checked against it.

## 2. Purpose

This is UP-MAVT Suite's primary validation case study. Because the software implements the BWT
method from the paper above, importing this case study and running it through the "Run UP-MAVT"
pipeline (see [`USER_MANUAL/`](../../USER_MANUAL/)) is a direct check that the software's weight solver and MAVT
aggregation reproduce the source method correctly, on the exact data the method's own authors
used to illustrate it.

## 3. Results

Running the `val1` session through the full five-step pipeline (linear weight model,
weighted-sum aggregation) produces the computed weights listed below and, in the final Results
Heatmap, Gdansk as the top-ranked port, closely followed by Piraeus and Koper. See
`USER_MANUAL/img/run-upmavt-step1-weights.png` and `USER_MANUAL/img/run-upmavt-step5-results.png`,
both captured from an actual run of this case study.

Computed weights (linear model, from `metadata.json`'s `computed_weights.weight_solutions`):

| Criterion | Weight |
|---|---|
| Terminal handling charges | 0.402 |
| Port reputation | 0.175 |
| Satisfaction with terminal operations | 0.136 |
| Number of container terminals | 0.155 |
| ISPS | 0.095 |
| Customs service | 0.036 |

## Contents

```text
case_study.zip
├── metadata.json           # study title/description, feature flags, computed weights
├── input/input.json        # 7 ports x 6 criteria decision matrix
├── sessions/val1.json      # one elicitation session: value functions + BWT comparisons
└── csv/val1/               # the same session data, exported as CSV
```

This case study is available for import from the application's login page ("Upload a case study
(.zip file)"), and is served directly by the backend at `GET /api/example-case-study/1`.
