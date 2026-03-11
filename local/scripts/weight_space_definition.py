#!/usr/bin/env python3
"""
Weight Space Explorer (DB version, v4 workflow)
Reads comparison constraints and value functions from MongoDB,
explores the weight space, and saves results back to DB.
"""

import numpy as np
import scipy.optimize as opt
from functools import partial
from scipy.interpolate import interp1d
from scipy.stats import qmc

# ============================================================================
# PARAMETERS
# ============================================================================
RNG_SEED = 426
EPS = 0.001
N_RESTARTS = 50
CONSTRAINT_TOL = 1e-5
FEASIBILITY_TOL = 0.01  # Tolerance for constraint satisfaction
LHS_SAMPLES = 100  # Number of Latin Hypercube samples
# Absolute slack added to z* when defining the Phase 2 search region.
# This must be large enough so that SLSQP can navigate the feasible set.
# For ratio constraints (sensitivity ~5), a slack of 0.01 maps to ~0.002
# width in weight space, giving headroom for diverse solutions.
PHASE2_SEARCH_SLACK = 0.01


# ============================================================================
# BUILD CONSTRAINT STRUCTURE
# ============================================================================
def build_constraint_structure(comparisons, value_functions):
    """Build a simple structure from comparisons."""
    criteria = set()
    for comp in comparisons:
        criteria.add(comp['REFERENCE_CRITERION'])
        criteria.add(comp['ADJUSTED_CRITERION'])

    criteria = sorted(list(criteria))
    criterion_to_index = {c: i for i, c in enumerate(criteria)}

    return {
        'criteria': criteria,
        'criterion_to_index': criterion_to_index,
        'comparisons': comparisons,
        'value_functions': value_functions,
    }


# ============================================================================
# CONSTRAINTS - Direct violation computation
# ============================================================================
# Mathematical formulation:
# 
# For BEST comparisons (ADJUSTED criterion is reference, other is adjustable):
#   Constraint: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
#
# For WORST comparisons (ADJUSTED criterion is adjustable, other is reference):
#   Constraint: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
#
# Both types follow the SAME pattern:
#   1/vf_adjusted(value) - w_adjusted/w_reference <= z
#
# Variable mapping:
#   - ADJUSTED criterion → adj_crit (the criterion whose value function is used)
#   - REFERENCE criterion → ref_crit (the comparison baseline)
#   - w_adjusted → w_adj
#   - w_reference → w_ref
#   - vf_adjusted(value) → vf_adj_val
#
# For computational stability, we use logarithms:
#   log(violation) <= log(z)  ⟺  log(z) - log(violation) >= 0
# ============================================================================

def _iter_comparison_terms(weights, constraint_data):
    """Yield normalized comparison terms used by constraint evaluation.
    
    Yields
    ------
    comp_type : str
        'best' or 'worst'
    w_ref : float
        Weight of the reference criterion
    w_adj : float
        Weight of the adjusted criterion (whose value function is used)
    vf_adj_val : float
        Value function evaluation: vf_adjusted(comparison_value)
    """
    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']
        comp_type = comp['TYPE'].lower()

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        w_ref = weights[ref_idx]
        w_adj = weights[adj_idx]

        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)

        yield comp_type, w_ref, w_adj, vf_adj_val


def _comparison_abs_violation(comp_type, w_ref, w_adj, vf_adj_val, use_non_linear_model=True):
    """Compute absolute violation for a single comparison.
    
    Both 'best' and 'worst' use the same formula:
        violation = 1/vf_adjusted(value) - w_adjusted/w_reference
    
    Parameters
    ----------
    comp_type : str
        'best' or 'worst' (both use same formula)
    w_ref : float
        Weight of reference criterion
    w_adj : float
        Weight of adjusted criterion
    vf_adj_val : float
        Value function evaluation of adjusted criterion
    
    Returns
    -------
    float
        Absolute violation value (should be <= z for feasibility)
    """
    # Both best and worst use the same pattern. The selected model controls
    # whether the ratio form (non-linear) or the weighted-difference form
    # (linear) is used.
    if use_non_linear_model:
        return abs(1.0 / vf_adj_val - (w_adj + EPS) / (w_ref + EPS))
    return abs(1.0 / vf_adj_val * w_ref - w_adj)


def compute_max_violation_weights_only(weights, constraint_data, use_non_linear_model=True):
    """Compute the maximum absolute constraint violation from weights alone.
    
    Evaluates all comparison constraints:
        constraint: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
    
    Returns the maximum violation (which should be minimized and bounded by z).
    
    Parameters
    ----------
    weights : ndarray
        Weight vector (must sum to 1).
    constraint_data : dict
        Constraint structure with criteria, indices, comparisons, value functions.
    
    Returns
    -------
    float
        Maximum violation across all constraints (0 = fully satisfied).
    """
    violations = [
        _comparison_abs_violation(
            comp_type, w_ref, w_adj, vf_adj_val, use_non_linear_model=use_non_linear_model
        )
        for comp_type, w_ref, w_adj, vf_adj_val in _iter_comparison_terms(weights, constraint_data)
    ]

    return max(violations) if violations else 0.0


def print_constraint_results(weights, constraint_data, use_non_linear_model=True, print_fn=None):
    """Print per-comparison residuals for a weight vector."""
    if print_fn is None:
        print_fn = print

    print_fn("Constraint results for solution:")
    max_violation = 0.0

    for idx, comp in enumerate(constraint_data['comparisons'], start=1):
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']
        comp_type = comp['TYPE'].lower()

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        w_ref = weights[ref_idx]
        w_adj = weights[adj_idx]

        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)

        if use_non_linear_model:
            residual = 1.0 / vf_adj_val - (w_adj + EPS) / (w_ref + EPS)
        else:
            residual = 1.0 / vf_adj_val * w_ref - w_adj

        abs_violation = abs(residual)
        max_violation = max(max_violation, abs_violation)

        print_fn(
            f"  [{idx:02d}] {comp_type.upper()} | ref={ref_crit} | adj={adj_crit} | "
            f"value={comp_value} | residual={residual:.8f} | abs={abs_violation:.8f}"
        )

    print_fn(f"  Maximum absolute violation: {max_violation:.8f}")


def _normalize_weights(weights):
    """Normalize weight vector to sum to 1 while keeping strict positivity."""
    w = np.asarray(weights, dtype=float)
    w = np.maximum(w, EPS)
    s = np.sum(w)
    if s <= 0:
        return np.ones_like(w) / len(w)
    return w / s


def _to_simplex_from_unit(sample):
    """Map a point in [0,1]^(n-1) to the simplex via stick-breaking."""
    coords = np.concatenate([[0.0], np.sort(sample), [1.0]])
    return np.diff(coords)


def _build_smooth_slsqp_constraints(constraint_data, z_cap, use_non_linear_model=True):
    """Build individual smooth inequality constraints for SLSQP.

    The violation for comparison i is:
        r_i(w) = 1/vf_i - (w_adj+EPS)/(w_ref+EPS)   [non-linear model]
        r_i(w) = 1/vf_i * w_ref - w_adj               [linear model]

    The feasibility constraint |r_i(w)| <= z_cap expands to two smooth inequalities:
        z_cap - r_i(w) >= 0
        z_cap + r_i(w) >= 0

    Both are smooth functions of w (no max, no abs), which SLSQP can handle
    correctly via finite-difference gradients.

    Returns
    -------
    list[dict]
        SLSQP-compatible constraint dicts (type='ineq', fun=callable).
    """
    constraints = []
    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)
        inv_vf = 1.0 / vf_adj_val  # constant per comparison

        if use_non_linear_model:
            # r_i(w) = inv_vf - (w[adj]+EPS)/(w[ref]+EPS)
            def _upper(w, ri=ref_idx, ai=adj_idx, c=inv_vf, z=z_cap):
                return z - (c - (w[ai] + EPS) / (w[ri] + EPS))
            def _lower(w, ri=ref_idx, ai=adj_idx, c=inv_vf, z=z_cap):
                return z + (c - (w[ai] + EPS) / (w[ri] + EPS))
        else:
            # r_i(w) = inv_vf * w[ref] - w[adj]
            def _upper(w, ri=ref_idx, ai=adj_idx, c=inv_vf, z=z_cap):
                return z - (c * w[ri] - w[ai])
            def _lower(w, ri=ref_idx, ai=adj_idx, c=inv_vf, z=z_cap):
                return z + (c * w[ri] - w[ai])

        constraints.append({'type': 'ineq', 'fun': _upper})
        constraints.append({'type': 'ineq', 'fun': _lower})

    return constraints


def check_sum_to_one(weights, threshold=0.001):
    """Check if weights sum to 1 within threshold."""
    return abs(np.sum(weights) - 1.0) <= threshold


def check_constraints_satisfied(weights, constraint_data, tol=FEASIBILITY_TOL, use_non_linear_model=True):
    """Check if weights satisfy all constraints within tolerance."""
    violation = compute_max_violation_weights_only(
        weights, constraint_data, use_non_linear_model=use_non_linear_model
    )
    return violation <= tol


def constraint_func(x, constraint_data, z_star=None, use_non_linear_model=True):
    """Legacy constraint function for backward compatibility with upmavt.py.
    
    Evaluates constraints in logarithmic z-variable format.
    
    Mathematical formulation:
        For each comparison: 1/vf_adjusted(value) - w_adjusted/w_reference <= z
        In logarithmic form: log(1/vf_adjusted(value) - w_adjusted/w_reference) <= log(z)
        Rearranged: log(z) - log(violation) >= 0
    
    Parameters
    ----------
    x : ndarray
        [w_crit1, w_crit2, ..., w_critN, z] where z bounds all violations
    constraint_data : dict
        Constraint structure
    z_star : float, optional
        Upper bound on z (if provided, adds constraint z <= z_star)
    
    Returns
    -------
    list[float]
        Constraint values (must all be >= 0 for feasibility)
    """
    weights = x[:-1]  # All but last element are weights
    z = x[-1]  # Last element is the z variable
    
    violations = []
    for comp_type, w_ref, w_adj, vf_adj_val in _iter_comparison_terms(weights, constraint_data):
        abs_violation = _comparison_abs_violation(
            comp_type, w_ref, w_adj, vf_adj_val, use_non_linear_model=use_non_linear_model
        )
        violations.append(np.log(z) - np.log(abs_violation))

    return violations


# ============================================================================
# OPTIMIZATION
# ============================================================================
# ============================================================================
# OPTIMIZATION - Three-Phase Approach
# ============================================================================
def find_minimum_infeasibility(constraint_data, num_criteria, use_non_linear_model=True, print_fn=None):
    """PHASE 1: Find the minimum achievable constraint violation.
    
    Uses global optimization via Differential Evolution.
    
    This determines the best feasibility we can achieve, which defines the boundary
    of the feasible region.
    
    Parameters
    ----------
    constraint_data : dict
        Constraint structure.
    num_criteria : int
        Number of criteria (weight vector dimension).
    print_fn : callable or None
        Logging function.
    
    Returns
    -------
    tuple
        (best_weights, minimum_violation)
    """
    if print_fn is None:
        print_fn = print
    raw_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )

    # DE is run in box bounds and then projected to simplex for objective eval.
    # This avoids sum-to-one drift while keeping compatibility across SciPy versions.
    def objective(w):
        return raw_objective(_normalize_weights(w))
    
    bounds = [(0.001, 1.0) for _ in range(num_criteria)]
    
    # ========================================================================
    # STAGE 1: Global optimization via Differential Evolution
    # ========================================================================
    print_fn("  Stage 1: Global search via Differential Evolution...")
    
    de_result = opt.differential_evolution(
        objective,
        bounds,
        seed=RNG_SEED,
        maxiter=1000,
        popsize=30,
        atol=0.0,
        tol=1e-10,
        workers=1,
    )
    
    de_weights = _normalize_weights(de_result.x)
    de_violation = raw_objective(de_weights)
    print_fn(f"    Global best violation: {de_violation:.6f}")

    print_fn(f"  Final minimum violation: {de_violation:.6f}")
    return de_weights, de_violation


def sample_feasible_region_lhs(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights=None,
    n_samples=None,
    use_non_linear_model=True,
    print_fn=None,
):
    """PHASE 2: Sample the feasible region using Latin Hypercube Sampling.
    
        Generates diverse weight vectors and solves constrained local problems:
            - sum(w)=1, w>=EPS
            - max_violation(w) <= z_cap
        with random linear objectives to spread solutions across the feasible set.
    
    Parameters
    ----------
    constraint_data : dict
        Constraint structure.
    num_criteria : int
        Number of criteria.
    z_cap : float
        Feasibility cap from Phase 1 (with tiny numeric allowance).
    anchor_weights : ndarray or None
        Best Phase 1 solution to seed local searches.
    n_samples : int or None
        Number of LHS samples (defaults to LHS_SAMPLES).
    print_fn : callable or None
        Logging function.
    
    Returns
    -------
    list[ndarray]
        List of refined weight vectors.
    """
    if print_fn is None:
        print_fn = print
    if n_samples is None:
        n_samples = LHS_SAMPLES
    
    print_fn(f"Generating {n_samples} samples via Latin Hypercube Sampling...")
    
    # Generate LHS samples in unit hypercube, convert to simplex
    try:
        sampler = qmc.LatinHypercube(d=num_criteria-1, scramble=True, seed=RNG_SEED)
        samples_unit = sampler.random(n=n_samples)
    except:
        # Fallback if qmc not available
        print_fn("  (Using fallback random sampling)")
        rng = np.random.RandomState(RNG_SEED)
        samples_unit = rng.random((n_samples, num_criteria-1))
    
    # Convert to simplex using sorted stick-breaking method
    weights_list = [_to_simplex_from_unit(sample) for sample in samples_unit]
    if anchor_weights is not None:
        weights_list.append(_normalize_weights(anchor_weights))
    
    print_fn(f"Refining samples via local optimization...")
    refined_weights = []

    violation_objective = partial(
        compute_max_violation_weights_only,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
    )

    # Build smooth per-comparison constraints once (reused for every seed).
    # Using individual smooth constraints instead of a single max(abs(...)) lets
    # SLSQP estimate valid gradients and navigate the feasible set reliably.
    smooth_constraints = _build_smooth_slsqp_constraints(
        constraint_data, z_cap, use_non_linear_model=use_non_linear_model
    )
    slsqp_constraints = (
        [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}] + smooth_constraints
    )

    rng = np.random.RandomState(RNG_SEED)

    for idx, weights in enumerate(weights_list):
        if idx % max(1, len(weights_list) // 10) == 0:
            print_fn(f"  Progress: {idx}/{len(weights_list)}")

        # Random linear objective pushes each seed toward a different extreme
        # of the feasible polytope, yielding diverse solutions.
        direction = rng.normal(size=num_criteria)
        direction = direction - np.mean(direction)

        result = opt.minimize(
            fun=lambda w, d=direction: float(np.dot(d, w)),
            x0=_normalize_weights(weights),
            method='SLSQP',
            bounds=[(0.001, 1.0) for _ in range(num_criteria)],
            constraints=slsqp_constraints,
            options={'maxiter': 500, 'ftol': 1e-10}
        )

        candidate = _normalize_weights(result.x if result.success else weights)
        if violation_objective(candidate) <= z_cap:
            refined_weights.append(candidate)
        elif violation_objective(_normalize_weights(weights)) <= z_cap:
            # Seed itself was already feasible — keep it as-is.
            refined_weights.append(_normalize_weights(weights))
    
    print_fn(f"Refined {len(refined_weights)} samples")
    return refined_weights


def enumerate_weight_space(weights_list, criterion_names, min_violation=0.0,
                          constraint_data=None, use_non_linear_model=True,
                          z_cap=None, print_fn=None):
    """PHASE 3: Filter and deduplicate feasible weight solutions at full precision.

    Keeps candidates whose violation <= z_cap, deduplicates at float precision,
    and formats as output solutions (no rounding/quantization).

    Parameters
    ----------
    weights_list : list[ndarray]
        Raw weight vectors coming from Phase 2.
    criterion_names : list[str]
        Criterion names for output.
    min_violation : float
        Minimum achievable violation found in Phase 1 (used only for logging).
    constraint_data : dict or None
        Constraint structure for filtering.
    z_cap : float or None
        Acceptance threshold (min_violation + PHASE2_SEARCH_SLACK).  If None,
        falls back to min_violation + PHASE2_SEARCH_SLACK.
    use_non_linear_model : bool
    print_fn : callable or None

    Returns
    -------
    tuple
        (weight_solutions, num_unique_weights)
    """
    if print_fn is None:
        print_fn = print

    threshold = z_cap if z_cap is not None else min_violation + PHASE2_SEARCH_SLACK
    
    print_fn(f"Filtering to feasible solutions (violation <= {threshold:.6f})...")
    
    # Compute violations for all weights and collect statistics
    all_violations = []
    feasible = []
    for w in weights_list:
        if constraint_data is not None:
            violation = compute_max_violation_weights_only(
                w, constraint_data, use_non_linear_model=use_non_linear_model
            )
            all_violations.append(violation)
            if violation <= threshold:
                feasible.append(w)
        else:
            feasible.append(w)
    
    # Report violation statistics
    if all_violations:
        all_violations_arr = np.array(all_violations)
        print_fn(f"Violation statistics across {len(all_violations)} samples:")
        print_fn(f"  Min: {np.min(all_violations_arr):.6f}")
        print_fn(f"  Max: {np.max(all_violations_arr):.6f}")
        print_fn(f"  Mean: {np.mean(all_violations_arr):.6f}")
        print_fn(f"  Std: {np.std(all_violations_arr):.6f}")
        print_fn(f"  Phase 1 best: {min_violation:.6f}")
        print_fn(f"  Tolerance threshold: {threshold:.6f}")
    
    print_fn(f"Feasible solutions: {len(feasible)}")
    
    if not feasible:
        print_fn("WARNING: No feasible solutions found after filtering!")
        return [], 0
    
    feasible_array = np.array(feasible)
    
    print_fn("Deduplicating at full precision...")
    # Deduplicate solutions by treating nearly-identical floats as equal.
    # Use a coarse tolerance (1e-10) suitable for the precision of solver output.
    unique_indices = np.unique(np.round(feasible_array, 10), axis=0, return_index=True)[1]
    unique_weights = feasible_array[np.sort(unique_indices)]

    print_fn(f"Unique solutions: {len(unique_weights)}")
    
    # Format for database as complete solutions (full precision, no rounding)
    weight_solutions = []
    for w in unique_weights:
        solution = {
            crit_name: float(w[crit_idx])
            for crit_idx, crit_name in enumerate(criterion_names)
        }
        # Ensure sum exactly equals 1 (numerical cleanup for storage)
        w_sum = sum(solution.values())
        if abs(w_sum - 1.0) > 1e-10:
            # Normalize proportionally to ensure sum = 1.0
            for crit_name in solution:
                solution[crit_name] /= w_sum
        weight_solutions.append(solution)

    return weight_solutions, len(unique_weights)


# ============================================================================
# MAIN ENTRY POINT (called by the worker)
# ============================================================================
def compute_weights(value_functions, comparisons, criteria_names=None, print_fn=None, use_non_linear_model=True):
    """Compute weight space using three-phase approach.
    
    PHASE 1: Find minimum infeasibility (best possible constraint satisfaction)
    PHASE 2: Sample feasible region via Latin Hypercube + local refinement
    PHASE 3: Filter and deduplicate solutions at full float precision

    Parameters
    ----------
    value_functions : dict
        Mapping criterion_name -> scipy interp1d function object.
    comparisons : list[dict]
        List of comparison dicts with REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE, GROUP.
    criteria_names : list[str] or None
        List of criterion names. If None, extracted from value_functions.
    print_fn : callable or None
        Function to call for logging (defaults to ``print``).

    Returns
    -------
    list[dict]
        Complete feasible weight solutions (unrounded, full precision).
    """
    if print_fn is None:
        print_fn = print

    print_fn("=" * 70)
    print_fn("THREE-PHASE WEIGHT SPACE EXPLORATION")
    print_fn("=" * 70)
    print_fn(f"Model: {'non-linear' if use_non_linear_model else 'linear'}")

    if not criteria_names:
        criteria_names = list(value_functions.keys())
    
    print_fn(f"✓ Value functions: {len(value_functions)}")
    print_fn(f"✓ Comparisons: {len(comparisons)}")

    if not comparisons:
        print_fn("ERROR: No comparisons found.")
        return []

    if not value_functions:
        print_fn("ERROR: No value functions found.")
        return []

    print_fn("\n[SETUP] Building constraint structure...")
    constraint_data = build_constraint_structure(comparisons, value_functions)
    crit_names = constraint_data['criteria']
    num_criteria = len(crit_names)

    print_fn(f"  ✓ Number of criteria: {num_criteria}")
    print_fn(f"  ✓ Criteria: {crit_names}")
    print_fn(f"  ✓ Number of constraints: {len(comparisons)}")

    # ========================================================================
    # PHASE 1: Find minimum infeasibility
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 1: Finding minimum constraint violation")
    print_fn("=" * 70)
    
    best_weights, min_violation = find_minimum_infeasibility(
        constraint_data, num_criteria,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn
    )
    
    print_fn(f"\nBest solution found:")
    print_fn(f"  Weights: {np.round(best_weights, 4)}")
    print_fn(f"  Max violation: {min_violation:.8f}")
    print_fn(f"  Sum check: {np.sum(best_weights):.6f}")
    print_constraint_results(
        best_weights,
        constraint_data,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )
    
    if min_violation > 10:
        print_fn("\nWARNING: Minimum violation is large (>10).")
        print_fn("This may indicate infeasible or very constrained problem.")

    # z_cap defines the acceptance band: solutions with violation <= z_cap are kept.
    # PHASE2_SEARCH_SLACK (0.01 absolute) ensures:
    #   (a) SLSQP constraints have non-trivial interior to navigate,
    #   (b) multiple distinct points exist at 0.001 (3dp) resolution.
    # For z*=1.53 this is <0.7% above optimal – not a policy relaxation.
    z_cap = min_violation + PHASE2_SEARCH_SLACK
    print_fn(f"  Optimal violation (z*):      {min_violation:.8f}")
    print_fn(f"  Acceptance cap (z_cap):      {z_cap:.8f}  (+{PHASE2_SEARCH_SLACK} absolute)")

    # Linear model mode only needs the best Phase 1 solution.
    if not use_non_linear_model:
        best_weights = best_weights / np.sum(best_weights)
        single_solution = {
            crit_name: round(float(best_weights[idx]), 3)
            for idx, crit_name in enumerate(crit_names)
        }

        print_fn("\nSkipping Phase 2 and Phase 3 for linear model.")
        print_fn("Using the best Phase 1 solution as final result.")
        print_fn("\n" + "=" * 70)
        print_fn("SUMMARY")
        print_fn("=" * 70)
        print_fn("Total feasible solutions enumerated: 1")
        print_fn("Criteria in solutions:")
        for crit_name in sorted(single_solution.keys()):
            print_fn(f"  {crit_name}")
        print_fn("\nWeight space computation complete.")
        print_fn("=" * 70)

        return [single_solution]

    # ========================================================================
    # PHASE 2: Sample feasible region
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 2: Sampling feasible region")
    print_fn("=" * 70)
    
    sampled_weights = sample_feasible_region_lhs(
        constraint_data, num_criteria,
        z_cap=z_cap,
        anchor_weights=best_weights,
        n_samples=LHS_SAMPLES,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn
    )

    # Always keep the valid Phase 1 point, even if Phase 2 finds none.
    sampled_weights = [_normalize_weights(best_weights)] + sampled_weights

    # ========================================================================
    # PHASE 3: Enumerate unique solutions
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 3: Enumerating unique solutions")
    print_fn("=" * 70)
    
    weight_solutions, num_unique = enumerate_weight_space(
        sampled_weights, crit_names,
        min_violation=min_violation,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
        z_cap=z_cap,
        print_fn=print_fn
    )
    
    # ========================================================================
    # Summary
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("SUMMARY")
    print_fn("=" * 70)
    print_fn(f"Total feasible solutions enumerated: {num_unique}")
    if weight_solutions:
        print_fn("Criteria in solutions:")
        for crit_name in sorted(weight_solutions[0].keys()):
            print_fn(f"  {crit_name}")
    
    print_fn("\nWeight space computation complete.")
    print_fn("=" * 70)
    
    return weight_solutions
