# 03 — Nuclear Reactor Selection (Large Hierarchical Case Study)

## 1. Source

This is a self-produced case study, developed alongside the UP-MAVT methodology; it is not a
replication of a published paper. The decision problem is a choice among six small/advanced
nuclear reactor designs — APR1400, EPR1750, AP1000, BWRX300, RollsRoyceSMR, and NuScaleVOYGR6 —
for deployment in a European context, evaluated on 14 criteria organized into 4 groups:

| Group | Example criteria |
|---|---|
| Economic | Capital Investment Budgeted, Operative + Fuel Costs, Construction Complexity, Design Complexity |
| Technical | Net Power Output, Thermal Efficiency, Discharge Burnup, Load Following Capabilities |
| Feasibility | Design Maturity, Licensing Status, Supplier Availability |
| Social | Perceived Safety, GHGe Benefit, Electricity Market Benefit, Nuclear Waste |

The case study defines three decision-maker sessions (`6WS0L4HS`, `IYUIIDIC`, `WICEMMMC`).

## 2. Purpose

This is the largest and most feature-complete of the three in-app examples, and the only one
that exercises hierarchical/grouped criteria end to end. With 14 criteria, pairwise weight
comparisons are made only within each group and then between each group's best and worst
criterion ("intra-B"/"intra-W" comparisons; see the Glossary in [`USER_MANUAL/`](../../USER_MANUAL/)), rather than
requiring the unmanageable 14×13/2 direct comparisons a flat structure would need. It also
combines qualitative and quantitative criteria (several of the Economic and Feasibility
criteria are elicited as rankings rather than as raw data) with genuine input uncertainty
across three decision-makers, making it a suitable stress test for the full "Run UP-MAVT"
pipeline on a realistically sized problem.

## Contents

```text
case_study.zip
├── metadata.json                              # "Evaluating Nuclear Reactors for deployment in europe"
├── input/input.json                           # 6 reactors x 14 criteria (4 groups)
├── sessions/{6WS0L4HS,IYUIIDIC,WICEMMMC}.json  # three decision-makers
└── csv/{6WS0L4HS,IYUIIDIC,WICEMMMC}/           # each session's data, exported as CSV
```

This case study is available for import from the application's login page ("Upload a case study
(.zip file)"), and is served directly by the backend at `GET /api/example-case-study/3`. Given
its size, computing weights and running the Monte Carlo pipeline takes noticeably longer than on
the two port-selection examples.
