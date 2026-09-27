# 05 — Analytically Tractable Verification Example

## Purpose

This case study is not drawn from the literature. It provides a decision problem small enough
that its complete solution — criteria weights, per-alternative value distributions, and the
final ranking — can be derived analytically, in closed form, and then checked against the output
of UP-MAVT's own computational engine (`worker/scripts/weight_space_definition.py` and
`worker/scripts/upmavt.py`, unmodified).

UP-MAVT's defining feature is uncertainty propagation (the "UP" in UP-MAVT): a Monte Carlo
simulation carries uncertainty from the raw input data and from each value function's declared
confidence level through to the final ranking (see [`USER_MANUAL/`](../../USER_MANUAL/)). This
case study therefore includes both sources of uncertainty the software supports:

- **Uncertain input data**, on the Cost criterion, expressed in the software's `X ± x` format
  (a uniform distribution with an absolute margin).
- **An uncertain value function**, on the Quality criterion, via a confidence level below the
  maximum, which applies a uniform error band around that criterion's value-function output.

Both are implemented in `worker/scripts/upmavt.py` as uniform distributions, which is what keeps
the propagated result analytically tractable: a uniform input passed through a linear value
function remains uniform, so every quantity below is derived from linear algebra, not from
approximating a general probability distribution.

## 1. Problem definition

A supplier-selection problem with four alternatives, evaluated on two criteria.

**Criteria**

| Criterion | Unit | Range | Preference direction |
|---|---|---|---|
| Cost | EUR | [100, 200] | lower is better |
| Quality | score | [0, 10] | higher is better |

**Alternatives**

| Alternative | Cost (EUR) | Quality (score) |
|---|---|---:|
| Supplier A | 105 ± 5 | 2 |
| Supplier B | 150 ± 5 | 6 |
| Supplier C | 195 ± 5 | 9 |
| Supplier D | 125 ± 5 | 8 |

Cost is uncertain for every alternative: its true value is equally likely anywhere in a ±5 EUR
window around the stated figure (`data/input.csv` encodes this as `105±5`, etc., parsed by
`worker/scripts/upmavt.py::sample_from_distribution` as `Uniform(value − margin, value + margin)`).
Quality is a fixed, known number for every alternative; its uncertainty is introduced separately,
through the value function (Section 2).

## 2. Value functions

Both criteria use a linear value function spanning the criterion's full range, defined by its
two endpoints:

| Criterion | v(worst) | v(best) | Confidence |
|---|---|---|:---:|
| Cost | v(200) = 0 | v(100) = 1 | 4 (no value-function error) |
| Quality | v(0) = 0 | v(10) = 1 | 2 (±5% uniform error band) |

i.e. `VF_Cost(x) = (200 − x) / 100` and `VF_Quality(x) = x / 10`.

Confidence is a 0–4 rating of how certain a value-function judgment is (see the Glossary in
[`USER_MANUAL/`](../../USER_MANUAL/)); confidence 2 corresponds to a ±5% uniform error band
around the evaluated value (`worker/scripts/upmavt.py::evaluate_alternative`'s
`confidence_errors` table). Cost's value function carries no such band (confidence 4); all of
Cost's uncertainty instead comes from the input data in Section 1. Quality's input value is
exact; all of its uncertainty comes from this confidence band.

## 3. Weight elicitation

A single Best-Worst Tradeoff (BWT) judgment defines the relative importance of the two
criteria:

> Cost at its best level is worth as much as Quality improving from its worst level (0) to 6.

In UP-MAVT's comparison schema (`data/session_1/bwt_comparisons.csv`):

```csv
REFERENCE_CRITERION;ADJUSTED_CRITERION;DATA_VALUE;TYPE;GROUP
Cost;Quality;6;best;single-group
```

This judgment is defined at the criterion level and is unaffected by the alternatives'
uncertainty above.

### Closed-form weights

UP-MAVT's zero-violation condition for a BWT judgment is
`w_reference = VF_adjusted(data_value) · w_adjusted`
(`worker/scripts/weight_space_definition.py::compute_violation`). With exactly two criteria and
one judgment, this equation plus the normalization constraint `w_Cost + w_Quality = 1` fully
determine both weights, with no optimization required:

```
VF_Quality(6) = 6 / 10 = 0.6
w_Cost = 0.6 · w_Quality
w_Cost + w_Quality = 1  ⟹  w_Quality = 1 / 1.6 = 0.625,  w_Cost = 0.6 / 1.6 = 0.375
```

## 4. Analytical propagation of uncertainty

A linear map of a uniform random variable is itself uniform: if `X ~ Uniform(a, b)` and `f` is
linear, then `f(X) ~ Uniform` over the interval spanned by `f(a)` and `f(b)`, with mean `f((a+b)/2)`.
Both of this example's uncertainty mechanisms produce exactly this situation for each criterion,
independently:

- **Cost**: `Cost ~ Uniform(cost₀ − 5, cost₀ + 5)`, and `VF_Cost` is linear with slope `−1/100`,
  so `VF_Cost(Cost) ~ Uniform(VF_Cost(cost₀) − 0.05, VF_Cost(cost₀) + 0.05)` — a width of `0.1`,
  identical for every alternative, since the slope is constant.
- **Quality**: Quality's input is a fixed value `q₀`, so `VF_Quality(q₀) = v₀` is a fixed number;
  the ±5% confidence band then gives `Uniform(v₀ · 0.95, v₀ · 1.05)` — a width of `0.1 · v₀`,
  proportional to Quality's value function output, and so different for each alternative.

| Alternative | VF_Cost range | VF_Quality range |
|---|---|---|
| Supplier A | [0.900, 1.000] | [0.190, 0.210] |
| Supplier B | [0.450, 0.550] | [0.570, 0.630] |
| Supplier C | [0.000, 0.100] | [0.855, 0.945] |
| Supplier D | [0.700, 0.800] | [0.760, 0.840] |

Since aggregation is weighted-sum and the two terms are independent, the alternative's overall
score `w_Cost · VF_Cost + w_Quality · VF_Quality` has an exact closed-form mean (linearity of
expectation) and exact closed-form bounds (each term is monotonic in its own uniform variable, so
the sum's minimum and maximum are attained at the corresponding endpoint combination):

```
mean(score) = w_Cost · mean(VF_Cost) + w_Quality · mean(VF_Quality)
min(score)  = w_Cost · min(VF_Cost)  + w_Quality · min(VF_Quality)
max(score)  = w_Cost · max(VF_Cost)  + w_Quality · max(VF_Quality)
```

| Alternative | Mean | Min | Max |
|---|---:|---:|---:|
| Supplier A | 0.48125 | 0.45625 | 0.50625 |
| Supplier B | 0.56250 | 0.52500 | 0.60000 |
| Supplier C | 0.58125 | 0.534375 | 0.628125 |
| Supplier D | 0.78125 | 0.73750 | 0.82500 |

**Ranking by mean score: Supplier D > Supplier C > Supplier B > Supplier A.**

Supplier B's and Supplier C's ranges overlap ([0.525, 0.600] and [0.534, 0.628]): although
Supplier C has the higher mean, a single realization of the underlying uncertainty could produce
either ordering between them. Supplier A and Supplier D do not overlap with any other
alternative's range, so their relative position is certain given this model. This is a genuine
consequence of propagating uncertainty rather than an artifact — it is exactly the kind of
information a deterministic score alone would not reveal, and it is what UP-MAVT's own rank
probability heatmaps ([`USER_MANUAL/`](../../USER_MANUAL/), "Run UP-MAVT" Step 5) are designed to
surface at larger scale.

## 5. Software verification

Running [`verification/run_verification.py`](verification/run_verification.py) — which calls
`worker/scripts/weight_space_definition.py::compute_weights` and
`worker/scripts/upmavt.py::run_upmavt` directly, over 50,000 Monte Carlo iterations — produces
the following.

**Weights**

| Criterion | Analytical | UP-MAVT computed | Difference |
|---|---:|---:|---:|
| Cost | 0.375 | 0.375 | 0.000000 |
| Quality | 0.625 | 0.625 | 0.000000 |

**Score distributions (weighted-sum aggregation)**

| Alternative | Analytical mean | MC mean | Analytical [min, max] | MC [min, max] |
|---|---:|---:|---|---|
| Supplier A | 0.481250 | 0.481266 | [0.456250, 0.506250] | [0.456424, 0.506062] |
| Supplier B | 0.562500 | 0.562588 | [0.525000, 0.600000] | [0.525137, 0.599977] |
| Supplier C | 0.581250 | 0.581190 | [0.534375, 0.628125] | [0.534865, 0.627816] |
| Supplier D | 0.781250 | 0.781277 | [0.737500, 0.825000] | [0.737797, 0.824908] |

Every simulated mean matches the analytical mean to within Monte Carlo sampling error, and every
simulated minimum and maximum falls inside the analytically derived bounds (as it must: NumPy's
uniform sampling cannot draw a value outside the interval it is given). The final ranking by mean
score matches Section 4: **Supplier D > Supplier C > Supplier B > Supplier A**, with the same
Supplier B / Supplier C overlap observed in the simulated ranges.

The weight computation in Step 1 is seeded and therefore reproducible across runs; the Monte
Carlo simulation in Step 2 is not seeded, so the exact figures above will differ slightly on each
run of the script, while continuing to satisfy the mean-tolerance and exact-bounds checks it
asserts.

## 6. Reproducing this example

```bash
cd examples/05-analytically-tractable-verification/verification
python run_verification.py
```

Requires `numpy` and `scipy` (as listed in `worker/requirements.txt`). The script imports
`worker/scripts/weight_space_definition.py` and `worker/scripts/upmavt.py` directly, computes
weights, runs the Monte Carlo simulation, and asserts every value against the analytical solution
in Sections 3 and 4.

## Design rationale

**Problem size: two criteria, one comparison.** UP-MAVT's weight solver treats every BWT
judgment as one constraint: `w_reference = VF_adjusted(data_value) · w_adjusted`. With *n*
criteria, the simplex constraint `Σw = 1` supplies one further equation, so *n − 1* independent
judgments exactly determine all *n* weights; fewer leave the system under-determined, and more
make it over-determined, requiring the differential-evolution / SLSQP minimax search designed
for inconsistent judgments (as used in
[case study 04](../04-tradeoff-elicitation-sun-kroesen-rezaei-2026/)). Two criteria and one
comparison is the smallest configuration that is both exactly determined and non-trivial: one
equation, one constraint, closed-form weights, no optimizer required to check the result by
hand.

**Value-function shape: linear, two points.** UP-MAVT's minimum valid value function is defined
by two points (`SessionService.is_value_functions_complete` requires only a non-empty `points`
list; mid-splitting's five-point structure and free-edit points are elicitation aids, not schema
requirements). A straight line between a criterion's minimum and maximum keeps every intermediate
value a one-line calculation.

**Numeric values.** The BWT judgment's `data_value` (6) was chosen so that
`VF_Quality(6) = 6 / 10 = 0.6` is a clean fraction, giving exact closed-form weights (0.375,
0.625) that are easy to distinguish from rounding elsewhere in the example. Four alternatives
give a non-trivial ranking without an unwieldy aggregation table. Supplier D (Cost = 125,
Quality = 8) is Pareto-optimal among the four — no other alternative is at least as good as it
on both criteria simultaneously — and scores highest under the weights this example derives;
Pareto optimality alone does not guarantee first place under every possible weighting (Supplier
A, for example, would rank first under a sufficiently cost-dominant weight vector), so the
ranking in Section 4 holds for these specific weights, not independently of them.

**Choice of uncertainty mechanisms.** Applying the two uncertainty mechanisms to different
criteria, rather than stacking both on the same one, keeps each criterion's contribution to a
score an exactly uniform random variable, which is what makes the mean and bounds in Section 4
closed-form quantities rather than requiring the full probability density of a sum of uniforms.
This also required moving the four alternatives' Cost values away from the criterion's exact
range boundary (100 and 200): `worker/scripts/upmavt.py::evaluate_alternative`'s
`np.clip(normalized_value, 0.001, 1.0)` floor — present so that geometric- and harmonic-mean
aggregation never divide by an exact zero — would otherwise clip a boundary alternative's
value-function output. With Cost now a continuous ±5 EUR distribution centered away from either
boundary, the floor is reached only at a single point of zero probability, so it does not affect
the closed-form result.

## Contents

```text
data/
├── input.csv                      # 2 criteria x 4 suppliers; Cost given as "value±margin"
└── session_1/
    ├── value_functions.csv        # the two linear value functions and their confidence (Section 2)
    └── bwt_comparisons.csv        # the single BWT judgment (Section 3)
verification/
└── run_verification.py            # runs the solver and simulation, asserts against Sections 3-4
```
