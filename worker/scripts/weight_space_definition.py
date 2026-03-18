#!/usr/bin/env python3
"""
BOUNDARY WEIGHT-SPACE EXPLORER (Simplified)

This script finds the set of weight vectors that lie on or near the constraint boundary.
The algorithm has THREE STEPS:

  STEP A: Find the critical boundary level z* (minimum achievable max constraint violation)
          Uses: Differential Evolution optimizer

  STEP B: Sample diverse weight vectors that violate constraints by at most z_cap
          (where z_cap = z* + z* * LIM%)
          Uses: SLSQP multi-start from many random starting points

  STEP C: Filter to boundary band [z* - tol, z_cap], round outputs to 0.001,
          and deduplicate

Key insight: The algorithm does NOT revalidate after rounding. The rounded outputs
are assumed to satisfy the band criteria by definition of Step A/B/C.
"""

import numpy as np
import scipy.optimize as opt


# ============================================================================
# PARAMETERS (all user-configurable)
# ============================================================================

# Random number generation seed (for reproducibility)
RNG_SEED = 426

# Numerical stability: treat very small value-function outputs as EPS to avoid division by zero
EPS = 0.001

# Constraint satisfaction tolerance (for feasibility checks at intermediate stages)
FEASIBILITY_TOL = 0.01

# STEP B sampling: how many candidate weights to generate
STEP_B_SAMPLES = 1000

# STEP B: how many random starting points for SLSQP
STEP_B_SLSQP_RESTARTS = 96

# STEP B: max iterations per SLSQP run
STEP_B_SLSQP_MAXITER = 500

# STEP B: convergence tolerance for SLSQP function value
STEP_B_SLSQP_FTOL = 1e-10

# STEP A / STEP C filtering: round all final weights to this many decimal places
OUTPUT_WEIGHT_DECIMALS = 3  # i.e., 0.001

# STEP A: Differential Evolution max iterations (controls effort)
STEP_A_DE_POPSIZE = 15
STEP_A_DE_MAXITER = 1000
STEP_A_DE_SEED = RNG_SEED

# STEP C: lower band threshold = z* - BOUNDARY_BAND_TOL
BOUNDARY_BAND_TOL = 1e-4

# STEP C: upper band threshold = z* + z* * (STEP_C_LIM_PERCENT / 100)
# This is typically passed at runtime, but has a default
DEFAULT_STEP_C_LIM_PERCENT = 1.0  # i.e., +1% of z*


# ============================================================================
# UTILITY FUNCTIONS - Building the constraint model
# ============================================================================

def build_constraint_structure(comparisons, value_functions, criteria_order=None):
    """
    Organize input comparisons and value functions into a reusable dict.
    
    Parameters
    ----------
    comparisons : list[dict]
        Each dict has keys: REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE, GROUP
    value_functions : dict
        Maps criterion name -> scipy interp1d function
    
    Returns
    -------
    dict
        Contains 'criteria', 'criterion_to_index', 'comparisons', 'value_functions'
    """
    criteria_in_comparisons = set()
    for comp in comparisons:
        criteria_in_comparisons.add(comp['REFERENCE_CRITERION'])
        criteria_in_comparisons.add(comp['ADJUSTED_CRITERION'])

    if criteria_order:
        # Preserve caller-provided criterion order (typically input-file order).
        criteria = [
            c for c in criteria_order
            if c in value_functions
        ]
        # Add any criteria found in comparisons but missing from criteria_order.
        for c in sorted(criteria_in_comparisons):
            if c not in criteria:
                criteria.append(c)
    else:
        criteria = sorted(list(criteria_in_comparisons))

    criterion_to_index = {c: i for i, c in enumerate(criteria)}

    return {
        'criteria': criteria,
        'criterion_to_index': criterion_to_index,
        'comparisons': comparisons,
        'value_functions': value_functions,
    }


# ============================================================================
# CONSTRAINT VIOLATION COMPUTATION
# ============================================================================
# Mathematical model:
#
# For each comparison, we measure how much the constraint is violated.
#
# Comparison formula:
#   residual = 1 / vf_adjusted(value) - w_adjusted / w_reference
#
# We take the ABSOLUTE VALUE of residual as the violation magnitude.
#
# For each weight vector w, we compute the max violation over all constraints.
# This is called "z" - the worst-case constraint violation.
# ============================================================================

def compute_violation(weights, constraint_data, use_non_linear_model=True):
    """
    Compute max absolute constraint violation for a given weight vector.
    
    Parameters
    ----------
    weights : np.ndarray
        Weight vector (length = number of criteria)
    constraint_data : dict
        Output from build_constraint_structure()
    use_non_linear_model : bool
        If True: use 1/vf - w_adj/w_ref formula
        If False: use (1/vf)*w_ref - w_adj formula
    
    Returns
    -------
    float
        Maximum absolute violation across all constraints for these weights
    """
    violations = []

    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        adj_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']

        # Look up indices
        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        adj_idx = constraint_data['criterion_to_index'][adj_crit]

        # Extract weights and value function
        w_ref = weights[ref_idx]
        w_adj = weights[adj_idx]
        vf_adj = constraint_data['value_functions'][adj_crit]
        vf_adj_val = max(vf_adj(comp_value), EPS)

        # Compute residual
        if use_non_linear_model:
            residual = 1.0 / vf_adj_val - (w_adj + EPS) / (w_ref + EPS)
        else:
            residual = 1.0 / vf_adj_val * w_ref - w_adj

        violations.append(abs(residual))

    return float(max(violations)) if violations else 0.0


def normalize_weights(w):
    """Project weights to a valid simplex vector (non-negative, sum=1)."""
    w = np.asarray(w, dtype=float)
    # Clamp tiny negative noise from optimizers.
    w = np.maximum(w, 0.0)
    s = float(np.sum(w))
    if s < 1e-15:
        # Degenerate case: return a neutral simplex point, never all-zeros.
        return np.full_like(w, 1.0 / len(w), dtype=float)
    return w / s


# ============================================================================
# STEP A: Find the critical boundary level z* using Differential Evolution
# ============================================================================

def step_a_minimize_max_violation(
    constraint_data,
    num_criteria,
    use_non_linear_model=True,
    print_fn=None,
):
    """
    Use Differential Evolution to find the weight vector with minimum max violation.
    
    This vector and its violation level (z*) define the critical boundary.
    
    Returns
    -------
    best_weights : np.ndarray
        Weight vector achieving minimum max violation
    min_violation : float
        The minimum max violation value (z*)
    """
    if print_fn is None:
        print_fn = print

    print_fn("  Using Differential Evolution to minimize max violation...")

    def objective(w):
        """Return max violation for weight vector w."""
        w_simplex = normalize_weights(w)
        return compute_violation(w_simplex, constraint_data, use_non_linear_model)

    # Bounds: each weight in (0, 1)
    bounds = [(0.0, 1.0)] * num_criteria

    # Differential Evolution: global optimizer, very robust
    result = opt.differential_evolution(
        objective,
        bounds,
        seed=STEP_A_DE_SEED,
        maxiter=STEP_A_DE_MAXITER,
        popsize=STEP_A_DE_POPSIZE,
        atol=1e-10,
        tol=1e-10,
    )

    best_weights = normalize_weights(result.x)
    min_violation = float(result.fun)

    return best_weights, min_violation


# ============================================================================
# STEP B: Sample diverse weight vectors near the boundary
# ============================================================================

def step_b_sample_boundary_candidates(
    constraint_data,
    num_criteria,
    z_cap,
    anchor_weights,
    use_non_linear_model=True,
    print_fn=None,
):
    """
    Use SLSQP multi-start to find diverse weight vectors with violation <= z_cap.
    
    Strategy:
    - Try up to STEP_B_SLSQP_RESTARTS starting points
    - Stop early once STEP_B_SAMPLES feasible solutions are found
    - For each starting point, use SLSQP to find a feasible solution
    - Accept solutions where max violation <= z_cap
    
    Returns
    -------
    list[np.ndarray]
        List of candidate weight vectors (normalized)
    """
    if print_fn is None:
        print_fn = print

    # Effective number of candidates we can aim for given the restart budget.
    effective_samples = min(STEP_B_SAMPLES, STEP_B_SLSQP_RESTARTS)
    print_fn(f"  Sampling up to {effective_samples} candidates using SLSQP multi-start...")
    print_fn(f"  Target: max violation <= z_cap = {z_cap:.6f}")

    rng = np.random.RandomState(RNG_SEED)
    candidates = []

    # Anchor guidance (if available in the function signature).
    try:
        anchor_w = anchor_weights  # type: ignore[name-defined]
    except NameError:
        anchor_w = None

    def constraint_violation(w):
        """Constraint: max_violation <= z_cap"""
        v = compute_violation(w, constraint_data, use_non_linear_model)
        return z_cap - v  # Must be >= 0 for feasibility

    def constraint_sum_to_one(w):
        """Constraint: weights must sum to 1."""
        return np.sum(w) - 1.0

    def objective_smooth(w):
        """Objective: try to stay near the boundary (not too far from anchor)."""
        v = compute_violation(w, constraint_data, use_non_linear_model)
        return v  # Maximize proximity to z_cap boundary

    # Multi-start: try many starting points, with an upper bound on restarts.
    for restart in range(STEP_B_SLSQP_RESTARTS):
        # Stop early once we've collected the desired number of candidates.
        if len(candidates) >= STEP_B_SAMPLES:
            break

        # Starting point (simplex: positive weights summing to 1). If an anchor
        # is provided, use it; otherwise, sample from a Dirichlet distribution.
        if anchor_w is not None:
            w0 = normalize_weights(anchor_w)
        else:
            w0 = rng.dirichlet(np.ones(num_criteria))

        # Enforce feasible boundary and simplex structure.
        constraints = [
            {'type': 'ineq', 'fun': constraint_violation},
            {'type': 'eq', 'fun': constraint_sum_to_one},
        ]

        # SLSQP: minimize violation (push toward boundary, staying feasible)
        result = opt.minimize(
            objective_smooth,
            w0,
            method='SLSQP',
            bounds=[(0.0, 1.0)] * num_criteria,
            constraints=constraints,
            options={'maxiter': STEP_B_SLSQP_MAXITER, 'ftol': STEP_B_SLSQP_FTOL},
        )

        if result.success and compute_violation(result.x, constraint_data, use_non_linear_model) <= z_cap:
            w_normalized = normalize_weights(result.x)
            candidates.append(w_normalized)

    print_fn(f"  ✓ Found {len(candidates)} feasible candidates")
    return candidates


# ============================================================================
# STEP C: Filter to boundary band and prepare final output
# ============================================================================

def step_c_build_boundary_solutions(
    sampled_weights,
    criteria,
    z_star,
    z_cap,
    constraint_data,
    use_non_linear_model=True,
    print_fn=None,
):
    """
    Filter candidate weights to the boundary band, round, and deduplicate.
    
    Boundary band: [z_star - BOUNDARY_BAND_TOL, z_cap]
    Output: Dictionary weight -> criterion (rounded to OUTPUT_WEIGHT_DECIMALS)
    
    NOTE: We do NOT revalidate after rounding. Filtering is done on raw values.
    
    Returns
    -------
    list[dict]
        List of solution dicts: {criterion_name: weight, ...}
    unique_count : int
        Number of unique solutions after deduplication
    """
    if print_fn is None:
        print_fn = print

    lower_threshold = z_star - BOUNDARY_BAND_TOL
    upper_threshold = z_cap

    print_fn(f"  Boundary band: [{lower_threshold:.6f}, {upper_threshold:.6f}]")

    unique_solutions = {}  # Key: tuple of rounded weights, Value: dict

    for w in sampled_weights:
        # Reject degenerate non-simplex points.
        if not np.isfinite(np.sum(w)) or np.sum(w) <= 1e-12:
            continue

        # Step C boundary check happens on raw weights.
        violation = compute_violation(w, constraint_data, use_non_linear_model)
        if violation < lower_threshold or violation > upper_threshold:
            continue

        # Round to OUTPUT_WEIGHT_DECIMALS
        w_rounded = np.round(w, OUTPUT_WEIGHT_DECIMALS)

        # Create solution dict
        solution = {crit: float(w_rounded[i]) for i, crit in enumerate(criteria)}
        tuple_key = tuple(w_rounded)

        # Skip if already seen this rounded solution
        if tuple_key in unique_solutions:
            continue

        unique_solutions[tuple_key] = solution

    print_fn(f"  ✓ Enumerated {len(unique_solutions)} unique rounded solutions")

    return list(unique_solutions.values()), len(unique_solutions)


# ============================================================================
# MAIN ALGORITHM
# ============================================================================

def compute_weights(
    value_functions,
    comparisons,
    criteria_names=None,
    print_fn=None,
    use_non_linear_model=True,
    step_c_lim_percent=DEFAULT_STEP_C_LIM_PERCENT,
    parameter_overrides=None,
    return_metadata=False,
):
    """
    Compute boundary weight vectors using the three-step algorithm.
    
    Parameters
    ----------
    value_functions : dict
        Maps criterion_name -> scipy interp1d function
    comparisons : list[dict]
        List of comparison constraints
    criteria_names : list[str], optional
        Criterion names (auto-extracted if None)
    print_fn : callable, optional
        Logging function (defaults to print)
    use_non_linear_model : bool
        Use non-linear constraint model
    step_c_lim_percent : float
        Upper band margin as percentage of z* (default 1%)
    parameter_overrides : dict, optional
        Runtime parameter overrides (ignored in simplified version)
    return_metadata : bool
        If True, return dict with metadata; else return solutions list
    
    Returns
    -------
    list[dict] or dict
        List of weight solution dicts, or metadata dict if return_metadata=True
    """
    if print_fn is None:
        print_fn = print

    # Validate inputs
    if not comparisons:
        print_fn("ERROR: No comparisons found.")
        return [] if not return_metadata else {'accepted_solutions': []}

    if not value_functions:
        print_fn("ERROR: No value functions found.")
        return [] if not return_metadata else {'accepted_solutions': []}

    if criteria_names is None:
        criteria_names = list(value_functions.keys())

    constraint_data = build_constraint_structure(
        comparisons,
        value_functions,
        criteria_order=criteria_names,
    )
    # Use one canonical criterion order for both optimization and output labels.
    criteria_for_weights = constraint_data['criteria']
    num_criteria = len(criteria_for_weights)

    # Build constraint model
    print_fn("=" * 70)
    print_fn("BOUNDARY WEIGHT-SPACE EXPLORATION (Simplified)")
    print_fn("=" * 70)
    print_fn(f"Model: {'non-linear' if use_non_linear_model else 'linear'}")
    print_fn(f"Step A: Differential Evolution (minimize max violation)")
    print_fn(f"Step B: SLSQP multi-start (sample boundary candidates)")
    print_fn(f"Step C: Round to {OUTPUT_WEIGHT_DECIMALS} decimals, deduplicate")
    print_fn(f"Criteria: {num_criteria}")
    print_fn(f"Comparisons: {len(comparisons)}")

    # ========================================================================
    # STEP A: Find z* (critical boundary level)
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("STEP A: Finding critical boundary level z*")
    print_fn("=" * 70)

    z_star_weights, z_star = step_a_minimize_max_violation(
        constraint_data,
        num_criteria,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )

    print_fn(f"\nResult:")
    print_fn(f"  Best weights: {np.round(z_star_weights, 4)}")
    print_fn(f"  Critical violation z*: {z_star:.8f}")

    # Compute z_cap (upper boundary threshold)
    z_cap = z_star + z_star * (step_c_lim_percent / 100.0)
    print_fn(f"  Upper threshold z_cap: {z_cap:.8f} (+{step_c_lim_percent:.2f}%)")

    # ========================================================================
    # STEP B: Sample boundary candidates
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("STEP B: Sampling boundary candidates")
    print_fn("=" * 70)

    sampled_weights = step_b_sample_boundary_candidates(
        constraint_data,
        num_criteria,
        z_cap=z_cap,
        anchor_weights=z_star_weights,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )

    # Always include the Step A solution
    sampled_weights = [z_star_weights] + sampled_weights

    # ========================================================================
    # STEP C: Build rounded boundary solutions
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("STEP C: Building rounded boundary solutions")
    print_fn("=" * 70)

    solutions, num_unique = step_c_build_boundary_solutions(
        sampled_weights,
        criteria_for_weights,
        z_star,
        z_cap,
        constraint_data=constraint_data,
        use_non_linear_model=use_non_linear_model,
        print_fn=print_fn,
    )

    # Keep linear mode deterministic: return one representative solution
    # after running the full Step A/B/C pipeline.
    if not use_non_linear_model and solutions:
        def _solution_score(solution):
            weights = np.array([solution[c] for c in criteria_for_weights], dtype=float)
            violation = compute_violation(weights, constraint_data, use_non_linear_model=False)
            dist_to_anchor = float(np.linalg.norm(weights - z_star_weights))
            return (abs(violation - z_star), dist_to_anchor)

        best_solution = min(solutions, key=_solution_score)
        solutions = [best_solution]
        num_unique = 1

    # ========================================================================
    # Summary
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("COMPLETE")
    print_fn("=" * 70)
    print_fn(f"Total unique boundary solutions: {num_unique}")
    print_fn("Weight space computation finished.")
    print_fn("=" * 70)

    if return_metadata:
        # Compute per-solution violation/error for export
        pre_threshold_decimal_solutions = []
        for sol in solutions:
            weights_array = np.array(
                [sol[c] for c in criteria_for_weights],
                dtype=float,
            )
            violation = compute_violation(
                weights_array,
                constraint_data,
                use_non_linear_model=use_non_linear_model,
            )
            pre_threshold_decimal_solutions.append(
                {
                    'weights': sol,
                    'error': float(violation),
                }
            )

        # Capture the key runtime parameters actually used in this run
        runtime_parameters = {
            'rng_seed': RNG_SEED,
            'eps': EPS,
            'feasibility_tol': FEASIBILITY_TOL,
            'step_b_samples': STEP_B_SAMPLES,
            'step_b_slsqp_restarts': STEP_B_SLSQP_RESTARTS,
            'step_b_slsqp_maxiter': STEP_B_SLSQP_MAXITER,
            'step_b_slsqp_ftol': STEP_B_SLSQP_FTOL,
            'output_weight_decimals': OUTPUT_WEIGHT_DECIMALS,
            'step_a_de_popszie': STEP_A_DE_POPSIZE,
            'z_star': float(z_star),
            'z_cap': float(z_cap),
            'use_non_linear_model': bool(use_non_linear_model),
        }

        return {
            'accepted_solutions': solutions,
            'pre_threshold_decimal_solutions': pre_threshold_decimal_solutions,
            'runtime_parameters': runtime_parameters,
        }

    return solutions
