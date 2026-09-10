# Example Case Studies

This folder collects every worked case study distributed with UP-MAVT Suite: three ready to
import through the application, and two that validate the software against published results
and hand-checkable mathematics.

| # | Folder | Description |
|---|--------|------------|
| 1 | [`01-port-selection-liang-et-al/`](01-port-selection-liang-et-al/) | Reference case study: 7 ports, 6 criteria, from Liang, Brunelli & Rezaei (2022) |
| 2 | [`02-port-selection-uncertainty-two-decision-makers/`](02-port-selection-uncertainty-two-decision-makers/) | The problem from #1, extended with input uncertainty, a qualitative criterion, and a second decision-maker |
| 3 | [`03-nuclear-reactor-hierarchical-uncertain/`](03-nuclear-reactor-hierarchical-uncertain/) | Large case study: 6 reactor designs, 14 criteria in 4 groups, 3 decision-makers |
| 4 | [`04-tradeoff-elicitation-sun-kroesen-rezaei-2026/`](04-tradeoff-elicitation-sun-kroesen-rezaei-2026/) | Replicates a published tradeoff-elicitation result from Sun, Kroesen & Rezaei (2026) |
| 5 | [`05-analytically-tractable-verification/`](05-analytically-tractable-verification/) | A small, self-produced problem with a closed-form expected result |

Case studies 1–3 are offered for download on the login page's "Example case studies" panel and
can be imported via "Upload a case study (.zip file)" (see
[`USER_MANUAL/`](../USER_MANUAL/)). Each folder contains the exact `.zip` served by the backend
(`GET /api/example-case-study/{1,2,3}`) and a `README.md` documenting where the data originates
and what the software produces from it.

Case studies 4–5 verify the computational engine
(`worker/scripts/weight_space_definition.py` and `worker/scripts/upmavt.py`) directly. Each
folder contains input data in the same CSV format used by the application's "Download Example
CSV" and local export bundle, together with a self-contained Python script that runs the solver
code shipped in this repository and reports its output against an independently derived expected
result — the same solver code used by the web application and the local "Download Data ZIP"
export bundle, with nothing reimplemented or approximated separately.
