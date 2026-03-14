# Weight Space Sampling Alternatives

## Current Baseline

The current baseline is:

1. Sample points in a unit hypercube.
2. Map them to the simplex so they become valid weights.
3. Filter them by the violation threshold.

This is simple and cheap, but it does not sample the feasible region directly. It samples the full weight simplex first and keeps only the points that pass the constraints.

## What We Are Sampling

Valid weights must satisfy:

$$
w_i \ge 0, \qquad \sum_{i=1}^{n} w_i = 1
$$

So the target space is the simplex, not the full box $[0,1]^n$.

## Alternative Methods

### 1. Direct Dirichlet Sampling

Sample weights directly from a Dirichlet distribution, for example Dirichlet$(1, \dots, 1)$.

How it works:

1. Draw a vector directly on the simplex.
2. Treat the sample as a valid weight vector immediately.
3. Filter by the constraints.

Pros:

1. Conceptually clean: the sampled values are already weights.
2. Very easy to implement.
3. No stick-breaking conversion step.
4. Good baseline method.

Cons:

1. No stratification like LHS.
2. Finite-sample coverage can look clumpy.
3. If the feasible region is small, filtering can still waste many samples.

Best fit:

1. When simplicity and direct interpretability matter most.
2. When you want a strong baseline before more advanced methods.

### 3. Sobol or Halton Sampling on the Simplex

Use a low-discrepancy sequence instead of random draws, then map to the simplex or use a simplex-native construction.

Pros:

1. Usually gives more even coverage than plain random sampling.
2. Often more efficient than naive Monte Carlo at the same sample count.
3. Deterministic and reproducible.

Cons:

1. More technical to explain and implement than Dirichlet.
2. If you sample in the cube and then transform, the transform can distort the low-discrepancy structure.
3. Still does not sample the feasible region directly.

Best fit:

1. When coverage quality matters more than minimal implementation complexity.
2. When you want a cleaner global exploration method than plain random sampling.

### 6. Ball Walk / Dikin Walk / Polytope MCMC

Use more advanced Markov-chain methods to explore a constrained region.

Pros:

1. Strong tools for complex feasible regions.
2. Better geometry handling than naive rejection in many settings.
3. Good for exploring interior mass rather than just finding a few points.

Cons:

1. Much more complex than the current pipeline.
2. Tuning is nontrivial.
3. Most natural for convex constraints; nonlinear ratio constraints are harder.

Best fit:

1. When the feasible region is hard to sample with simple methods.
2. When there is a clear need for serious feasible-region sampling.

### 8. Adaptive Sampling

Sample broadly at first, evaluate violations, then focus later samples near promising or near-feasible regions.

Examples:

1. Cross-entropy style updates.
2. Sequential Monte Carlo.
3. Resampling around good candidates.

Pros:

1. More efficient than static global sampling when feasible points are concentrated.
2. Can find useful regions faster than uniform methods.

Cons:

1. More moving parts and more tuning.
2. Can bias the final sample set toward whatever the adaptatio### 10. Extreme-Point or Vertex Enumeration

If constraints are linear or can be reliably approximated as linear, enumerate vertices or extreme points of the feasible region.

Pros:

1. Highly interpretable.
2. Gives structurally important solutions.
3. Useful for understanding the shape of the feasible region.

Cons:

1. Not natural for genuinely nonlinear constraints.
2. Can still become expensive in higher dimensions.
3. Focuses on boundaries rather than interior coverage.

Best fit:

1. When you care about structural extremes.
2. When the model is linear or close enough to linear.

## Summary Tradeoffs

### Current LHS + Simplex + Filter

Strengths:

1. Easy to implement.
2. Broad global exploration.
3. Reproducible with a fixed seed.
4. Better spread than naive random sampling in the cube.

Weaknesses:

1. It does not sample the feasible region directly.
2. The stratification is defined in the cube, not on the simplex after transformation.
3. Filtering can be wasteful when the feasible region is small.
4. Coverage of narrow feasible bands may be poor.

### Best Simplicity Option

Direct Dirichlet sampling plus filtering.

Reason:

1. The sampled values are already valid weights.
2. The implementation is simple.
3. It is easy to compare against the current method.

### Best Coverage Upgrade Without Major Complexity

Sobol-based simplex sampling plus filtering.

Reason:

1. Better space-filling behavior than plain random sampling.
2. Still much simpler than feasible-region MCMC.

### Best Option When Feasible Region Is Tiny

Hit-and-run from a feasible anchor.

Reason:

1. It explores the feasible region itself.
2. It avoids wasting most samples on points that will be rejected.

## Recommended Evaluation Order

If the goal is to compare methods pragmatically, a sensible sequence is:

1. Direct Dirichlet sampling plus filtering.
2. Sobol-based simplex sampling plus filtering.
3. Hit-and-run if feasible-point yield remains too low.

This sequence moves from simple to more technically demanding methods without changing too many things at once.n prefers.
3. Less transparent than pure rejection or direct simplex sampling.

Best fit:

1. When the goal is to find many good candidates quickly.
2. When exact representativeness matters less than practical efficiency.

### 9. Multi-Start Optimization

Run many optimizations from diverse starting points and collect distinct feasible or near-feasible solutions.

Pros:

1. Good for finding extreme or representative solutions.
2. Useful when the real goal is search rather than statistical sampling.
3. Can produce diverse boundary solutions.

Cons:

1. This is search, not true sampling.
2. Results depend heavily on the objective and solver.
3. Can overrepresent corners or easy-to-find regions.

Best fit:

1. When the goal is to produce a set of candidate solutions for downstream use.
2. When unbiased coverage of feasible mass is not required.