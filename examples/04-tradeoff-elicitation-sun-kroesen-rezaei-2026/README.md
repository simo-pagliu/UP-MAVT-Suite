# 04 — Tradeoff-Elicitation Replication (Sun, Kroesen & Rezaei, 2026)

## 1. Source

> Sun, G., Kroesen, M., & Rezaei, J. (2026). Anchoring Bias in the Tradeoff Procedure Within
> Multi-Attribute Value Theory. *Journal of Behavioral Decision Making*, 39(2), e70069.
> https://doi.org/10.1002/bdm.70069

This paper studies anchoring bias across three variants of the MAVT tradeoff-elicitation
procedure. UP-MAVT implements only one of them, the Best-Worst Tradeoff method (BWT), introduced
in Liang, Brunelli & Rezaei (2022), https://doi.org/10.1016/j.ins.2022.07.097 — the same paper
behind [case study 01](../01-port-selection-liang-et-al/) — so this replication uses exclusively
the paper's BWT judgments and BWT result. It does not attempt to reproduce the paper's other two
elicitation variants, which are not methods UP-MAVT supports.

The paper reports a complete worked numeric example for one study participant ("Participant 64",
Table 3.6–3.7 of the paper / Chapter 3 of the lead author's PhD dissertation). That worked
example publishes only the participant's indifference judgments and the resulting weights; it
does not apply those weights to any alternative set or report a ranking. The paper does perform
alternative ranking elsewhere (Section 3.6), but only as an aggregate statistic — Kendall's τb
agreement, computed across all 336 participants and 100 replications of randomly generated,
unpublished alternatives — not as a concrete result for Participant 64 or any reproducible
alternative set.

Accordingly, this case study is in two parts with different evidentiary status. Section 6 is a
genuine replication: it reproduces Participant 64's published BWT weights (Table 3.7) from the
same judgments, and checks the result against that published number. Section 7 is a
demonstration, not a replication: it carries those same weights through UP-MAVT's MAVT
aggregation to rank two illustrative apartments defined for this case study, since the paper
provides no worked ranking to check that step against.

## 2. Decision problem

An illustrative apartment-choice problem with three attributes (Table 3.1 of the paper):

| Attribute | Unit | Range | Preference direction |
|---|---|---|---|
| Rent | EUR/month | [600, 1500] | lower is better |
| Commute Distance | km | [5, 15] | lower is better |
| Distance to Shopping Center | m | [100, 500] | lower is better |

Participant 64 ranked Rent as the most important attribute, Commute Distance second, and
Distance to Shopping Center least important.

## 3. Participant 64's BWT elicitation

Table 3.6 of the paper reports Participant 64's three indifference judgments, which together
constitute a complete Best-Worst Tradeoff elicitation: two comparisons anchored on Rent (the
best attribute) and one anchored on Distance to Shopping Center (the worst attribute).

| Judgment | Comparison | Participant's answer |
|---|---|---|
| 1 | Rent at its best vs. Commute Distance improving from worst to *x* | *x* = 1000 |
| 2 | Rent at its best vs. Shopping Distance improving from worst to *x* | *x* = 1200 |
| 3 | Commute Distance improving from worst to *x* vs. Shopping Distance at its best | *x* = 10 |

## 4. Mapping onto UP-MAVT's BWT schema

UP-MAVT's solver (`worker/scripts/weight_space_definition.py::compute_violation`) encodes a
tradeoff judgment as `(reference_criterion, adjusted_criterion, data_value)`, with the
zero-violation condition `w_reference = VF_adjusted(data_value) · w_adjusted`. The three
judgments above translate to:

```csv
REFERENCE_CRITERION;ADJUSTED_CRITERION;DATA_VALUE;TYPE;GROUP
CommuteDistance;Rent;1000;best;single-group
ShoppingDistance;Rent;1200;best;single-group
ShoppingDistance;CommuteDistance;10;worst;single-group
```

(see [`data/participant_64/bwt_comparisons.csv`](data/participant_64/bwt_comparisons.csv)).

## 5. Reconstruction of the value functions

The paper elicits each participant's attribute value functions separately (via mid-value
splitting) but does not publish Participant 64's individual value-function points, only the
resulting weights. Table 3.7 of the paper additionally reports two partial weight solutions
that the authors compute from subsets of these same three judgments, for their own internal
comparison of elicitation protocols — a methodological device of the paper's, not a computation
UP-MAVT performs. This case study uses two of the resulting ratios purely as a numerical means
of reconstructing the two value-function points that UP-MAVT's solver requires and that the
paper does not publish directly:

```
V_Rent(1000)  = 0.250 / 0.600 = 0.416667
V_Rent(1200)  = 0.150 / 0.600 = 0.25
V_Commute(10) = 0.143 / 0.286 = 0.5
```

Both endpoints of each value function are fixed by the attribute range (`v(worst) = 0`,
`v(best) = 1`); the interior point is fixed by the ratio above. Piecewise-linear interpolation
between them is the same minimal-information construction UP-MAVT's own mid-splitting
elicitation produces. Distance to Shopping Center's value function is never evaluated at an
interior point in this data (it is always the reference attribute, never the attribute being
adjusted), so only its two endpoints are defined; see
`data/participant_64/value_functions.csv`.

## 6. Weight computation: computed vs. published

Running [`verification/run_replication.py`](verification/run_replication.py) — which calls
`worker/scripts/weight_space_definition.py::compute_weights` unmodified, on all three judgments
together — reproduces the paper's published BWT weights for Participant 64 (Table 3.7) within
numerical tolerance:

| Criterion | UP-MAVT computed | Paper (Table 3.7, BWT) | Difference |
|---|---:|---:|---:|
| Rent | 0.594 | 0.593 | 0.001 |
| Commute Distance | 0.264 | 0.264 | 0.000 |
| Shopping Distance | 0.142 | 0.143 | 0.001 |

Participant 64's three judgments are not perfectly consistent (the same reason the paper itself
requires the minimax formulation of its Eq. 3.11 rather than a closed-form solution), so
UP-MAVT's differential-evolution and SLSQP solver and the paper's own minimax procedure are
solving the same optimization problem rather than performing an identical deterministic
calculation. Agreement to within 0.001 confirms that the two implementations converge to the
same solution.

## 7. Solution: applying the weights to a decision

As established in Section 1, the paper provides no worked ranking to check this step against;
this section is a demonstration of the full decision pipeline, not a replication. Participant
64's computed weights and reconstructed value functions are applied to two illustrative
apartments, run through UP-MAVT's MAVT aggregation (`worker/scripts/upmavt.py::run_upmavt`,
weighted-sum, deterministic input):

| Attribute | Apartment A (cheap, far) | Apartment B (expensive, close) |
|---|---:|---:|
| Rent | 650 | 1450 |
| Commute Distance | 14 | 6 |
| Shopping Distance | 480 | 120 |

| Alternative | Score |
|---|---:|
| Apartment A (cheap, far) | 0.584187 |
| Apartment B (expensive, close) | 0.397250 |

**Final ranking: Apartment A (cheap, far) > Apartment B (expensive, close).**

Under Participant 64's elicited preferences, Rent carries by far the largest weight (0.594), so
Apartment A's large advantage on Rent (value 0.927 vs. 0.042) outweighs Apartment B's advantages
on Commute Distance and Shopping Distance combined, despite Apartment B being the better
alternative on two of the three criteria.

## 8. Reproducing this example

```bash
cd examples/04-tradeoff-elicitation-sun-kroesen-rezaei-2026/verification
python run_replication.py
```

Requires `numpy` and `scipy` (as listed in `worker/requirements.txt`). The script requires no
database, backend, or web UI: it imports `worker/scripts/weight_space_definition.py` and
`worker/scripts/upmavt.py` directly and prints the results in Sections 6 and 7.

## Contents

```text
data/
├── input.csv                          # the 3 attributes and two illustrative apartments
└── participant_64/
    ├── value_functions.csv            # reconstructed value-function points (Section 5)
    └── bwt_comparisons.csv            # Participant 64's 3 BWT judgments (Section 3-4)
verification/
└── run_replication.py                 # runs the solver, prints the results in Sections 6-7
```
