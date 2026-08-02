#!/usr/bin/env python3
"""
BOUNDARY WEIGHT-SPACE EXPLORER

This script finds a diverse set of weight vectors that satisfy the constraints.
The algorithm has TWO STEPS:

    STEP A: Find z* (minimum achievable max constraint violation) using Differential Evolution optimizer

    STEP B: Search for diverse valid weight vectors using SLSQP multi-start. After each start we verify if the solution satisfies z < z_cap. Round to third decimal and check for duplicates.

Search stops when we have collected max_results unique solutions or exhausted max_restarts attempts.
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

# SLSQP optimization: max iterations per run
SLSQP_MAXITER = 500

# SLSQP: convergence tolerance for function value
SLSQP_FTOL = 1e-10

# Round all final weights to this many decimal places
OUTPUT_WEIGHT_DECIMALS = 3  # i.e., 0.001

# Differential Evolution max iterations (controls effort)
DE_POPSIZE = 15
DE_MAXITER = 1000
DE_SEED = RNG_SEED

# Default advanced parameters (passed at runtime, with fallbacks)
DEFAULT_MAX_RESULTS = 10
DEFAULT_MAX_RESTARTS = 300


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

def compute_violation(weights, constraint_data, use_non_linear_model=True, eps=EPS):
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
        vf_adj_val = max(vf_adj(comp_value), eps)

        # Compute residual
        if use_non_linear_model:
            residual = 1.0 / vf_adj_val - (w_adj + eps) / (w_ref + eps)
        else:
            residual = 1.0 / vf_adj_val * w_ref - w_adj

        violations.append(abs(residual))

    return float(max(violations)) if violations else 0.0


def normalize_weights(w):
    w = np.asarray(w, dtype=float)
    # Clamp tiny negative noise from optimizers.
    w = np.maximum(w, 0.0)
    s = float(np.sum(w))
    if s < 1e-15:
        # Degenerate case: return a neutral simplex point, never all-zeros.
        return np.full_like(w, 1.0 / len(w), dtype=float)
    return w / s



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
# STEP A: Find z* using Differential Evolution
# ============================================================================

def step_a_minimize_max_violation(
    constraint_data,
    num_criteria,
    use_non_linear_model=True,
    de_seed=DE_SEED,
    de_maxiter=DE_MAXITER,
    de_popsize=DE_POPSIZE,
    eps=EPS,
    print_fn=None,
):
    if print_fn is None:
        print_fn = print

    print_fn("  Using Differential Evolution to minimize max violation...")

    def objective(w):
        """Return max violation for weight vector w."""
        w_simplex = normalize_weights(w)
        return compute_violation(w_simplex, constraint_data, use_non_linear_model, eps=eps)

    # Bounds: each weight in (0, 1)
    bounds = [(0.0, 1.0)] * num_criteria

    # Differential Evolution: global optimizer, very robust
    result = opt.differential_evolution(
        objective,
        bounds,
        seed=de_seed,
        maxiter=de_maxiter,
        popsize=de_popsize,
        atol=1e-10,
        tol=1e-10,
    )

    best_weights = normalize_weights(result.x)
    min_violation = float(result.fun)

    return best_weights, min_violation


# ============================================================================
# STEP B: Sample boundary candidates with immediate validation
# ============================================================================

def step_b_sample_boundary_candidates(
    constraint_data,
    num_criteria,
    max_results,
    max_restarts,
    z_star_weights,
    z_star,
    z_cap,
    use_non_linear_model=True,
    rng_seed=RNG_SEED,
    output_weight_decimals=OUTPUT_WEIGHT_DECIMALS,
    slsqp_maxiter=SLSQP_MAXITER,
    slsqp_ftol=SLSQP_FTOL,
    eps=EPS,
    print_fn=None,
):
    if print_fn is None:
        print_fn = print
    
    upper_threshold = z_cap
    target_step_b = max(0, max_results - 1)  # One slot is already occupied by Step A (DE) solution.
    print_fn(f"  Searching for {target_step_b} additional solutions with z < {upper_threshold:.6f} (max {max_restarts} attempts)...")

    rng = np.random.RandomState(rng_seed)
    valid_solutions = {}  # Key: tuple of rounded weights, Value: weight vector
    z_star_tuple = tuple(np.round(normalize_weights(z_star_weights), output_weight_decimals))
    seen_tuples = {z_star_tuple}   # Track unique rounded solutions, including Step A solution

    def objective_minimize_violation(w):
        """Objective: minimize max violation."""
        w_simplex = normalize_weights(w)
        return compute_violation(w_simplex, constraint_data, use_non_linear_model, eps=eps)

    def constraint_sum_to_one(w):
        """Constraint: weights must sum to 1."""
        return np.sum(w) - 1.0

    def constraint_violation(w):
        """Constraint: max_violation <= z_cap"""
        v = compute_violation(w, constraint_data, use_non_linear_model, eps=eps)
        return z_cap - v  # Must be >= 0 for feasibility

    # Multi-start search
    for restart in range(max_restarts):
        if len(valid_solutions) >= target_step_b:
            print_fn(f"  Target reached: {len(valid_solutions)} unique solutions found")
            break

        # Random starting point (simplex)
        w0 = rng.dirichlet(np.ones(num_criteria))

        # SLSQP constraints: simplex structure
        constraints = [
            {'type': 'ineq', 'fun': constraint_violation},
            {'type': 'eq', 'fun': constraint_sum_to_one},
        ]

        # Run SLSQP to minimize violation
        try:
            result = opt.minimize(
                objective_minimize_violation,
                w0,
                method='SLSQP',
                bounds=[(0.0, 1.0)] * num_criteria,
                constraints=constraints,
                options={'maxiter': slsqp_maxiter, 'ftol': slsqp_ftol},
            )

            if not result.success:
                continue

            w_raw = normalize_weights(result.x)

            violation = compute_violation(w_raw, constraint_data, use_non_linear_model, eps=eps)
            if violation >= upper_threshold:
                continue  # Must satisfy z < z_cap

            # Check for duplicate (using rounded tuple)
            w_rounded = np.round(w_raw, output_weight_decimals)
            tuple_key = tuple(w_rounded)
            if tuple_key in seen_tuples:
                continue  # Skip duplicate

            # Valid unique solution! Store it
            valid_solutions[len(valid_solutions)] = w_raw
            seen_tuples.add(tuple_key)

            if (restart + 1) % max(1, max_restarts // 10) == 0 or len(valid_solutions) % 10 == 0:
                print_fn(f"    Restart {restart + 1}/{max_restarts}: {len(valid_solutions)} valid solutions collected")

        except Exception:
            # Optimizer failed; skip this restart
            pass

    print_fn(f"  ✓ Found {len(valid_solutions)} valid solutions")
    return list(valid_solutions.values())



# ============================================================================
# MAIN ALGORITHM
# ============================================================================

def compute_weights(
    value_functions,
    comparisons,
    criteria_names=None,
    print_fn=None,
    use_non_linear_model=True,
    step_c_lim_percent=None,
    parameter_overrides=None,
    return_metadata=False,
):
    """
    Compute weight vectors using Step A (find z*) + Step B (search with immediate validation).
    
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
    step_c_lim_percent : float, optional
        Ignored (kept for backward compatibility)
    parameter_overrides : dict, optional
        Runtime parameter overrides: {'max_results': int, 'max_restarts': int}
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

    # Extract advanced parameters
    parameter_overrides = parameter_overrides or {}
    max_results = parameter_overrides.get('max_results', DEFAULT_MAX_RESULTS)
    max_restarts = parameter_overrides.get('max_restarts', DEFAULT_MAX_RESTARTS)
    rng_seed = parameter_overrides.get('rng_seed', RNG_SEED)
    eps = parameter_overrides.get('eps', EPS)
    feasibility_tol = parameter_overrides.get('feasibility_tol', FEASIBILITY_TOL)
    slsqp_maxiter = parameter_overrides.get('slsqp_maxiter', SLSQP_MAXITER)
    slsqp_ftol = parameter_overrides.get('slsqp_ftol', SLSQP_FTOL)
    output_weight_decimals = parameter_overrides.get('output_weight_decimals', OUTPUT_WEIGHT_DECIMALS)
    de_popsize = parameter_overrides.get('de_popsize', DE_POPSIZE)
    de_maxiter = parameter_overrides.get('de_maxiter', DE_MAXITER)
    de_seed = parameter_overrides.get('de_seed', DE_SEED)

    try:
        max_results = int(max(1, max_results))
        max_restarts = int(max(10, max_restarts))
        rng_seed = int(rng_seed)
        eps = float(max(1e-12, eps))
        feasibility_tol = float(max(0.0, feasibility_tol))
        slsqp_maxiter = int(max(1, slsqp_maxiter))
        slsqp_ftol = float(max(1e-16, slsqp_ftol))
        output_weight_decimals = int(max(0, min(10, output_weight_decimals)))
        de_popsize = int(max(1, de_popsize))
        de_maxiter = int(max(1, de_maxiter))
        de_seed = int(de_seed)
    except (TypeError, ValueError):
        max_results = DEFAULT_MAX_RESULTS
        max_restarts = DEFAULT_MAX_RESTARTS
        rng_seed = RNG_SEED
        eps = EPS
        feasibility_tol = FEASIBILITY_TOL
        slsqp_maxiter = SLSQP_MAXITER
        slsqp_ftol = SLSQP_FTOL
        output_weight_decimals = OUTPUT_WEIGHT_DECIMALS
        de_popsize = DE_POPSIZE
        de_maxiter = DE_MAXITER
        de_seed = DE_SEED

    constraint_data = build_constraint_structure(
        comparisons,
        value_functions,
        criteria_order=criteria_names,
    )
    criteria_for_weights = constraint_data['criteria']
    num_criteria = len(criteria_for_weights)

    # Header
    print_fn("=" * 70)
    print_fn("WEIGHT-SPACE EXPLORER")
    print_fn("=" * 70)
    print_fn(f"Model: {'non-linear' if use_non_linear_model else 'linear'}")
    print_fn(f"Criteria: {num_criteria}")
    print_fn(f"Comparisons: {len(comparisons)}")
    print_fn(f"Target valid solutions: {max_results}")
    print_fn(f"Maximum restart attempts: {max_restarts}")
    print_fn(f"RNG seed: {rng_seed}")
    print_fn(f"EPS: {eps}")
    print_fn(f"Feasibility tolerance: {feasibility_tol}")
    print_fn(f"SLSQP max iterations: {slsqp_maxiter}")
    print_fn(f"SLSQP ftol: {slsqp_ftol}")
    print_fn(f"Output decimals: {output_weight_decimals}")
    print_fn(f"DE popsize: {de_popsize}")
    print_fn(f"DE max iterations: {de_maxiter}")
    print_fn(f"DE seed: {de_seed}")

    # ========================================================================
    # STEP A: Find z* (critical boundary level)
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("STEP A: Finding z*")
    print_fn("=" * 70)

    z_star_weights, z_star = step_a_minimize_max_violation(
        constraint_data,
        num_criteria,
        use_non_linear_model=use_non_linear_model,
        de_seed=de_seed,
        de_maxiter=de_maxiter,
        de_popsize=de_popsize,
        eps=eps,
        print_fn=print_fn,
    )

    print_fn(f"\nResult:")
    print_fn(f"  Best weights: {np.round(z_star_weights, 4)}")
    print_fn(f"  Critical violation z*: {z_star:.8f}")

    # Compute z_cap (upper boundary threshold)
    if step_c_lim_percent is None:
        step_c_lim_percent = 1.0
    step_c_lim_percent = max(0.0, float(step_c_lim_percent))
    z_cap = z_star + z_star * (step_c_lim_percent / 100.0)
    print_fn(f"  Upper threshold z_cap: {z_cap:.8f}")

    # ========================================================================
    # STEP B: Sample boundary candidates with immediate validation
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("STEP B: Sampling candidates")
    print_fn("=" * 70)

    sampled_weights = step_b_sample_boundary_candidates(
        constraint_data,
        num_criteria,
        max_results=max_results,
        max_restarts=max_restarts,
        z_star_weights=z_star_weights,
        z_star=z_star,
        z_cap=z_cap,
        use_non_linear_model=use_non_linear_model,
        rng_seed=rng_seed,
        output_weight_decimals=output_weight_decimals,
        slsqp_maxiter=slsqp_maxiter,
        slsqp_ftol=slsqp_ftol,
        eps=eps,
        print_fn=print_fn,
    )

    # Always include the Step A solution
    sampled_weights = [z_star_weights] + sampled_weights

    # Convert to solution dicts (already deduplicated in Step B)
    solutions = []
    for w in sampled_weights:
        w_rounded = np.round(w, output_weight_decimals)
        solution = {crit: float(w_rounded[i]) for i, crit in enumerate(criteria_for_weights)}
        solutions.append(solution)

    # Apply linear-mode determinism if needed
    if not use_non_linear_model and solutions:
        # Return only one representative solution
        def score_solution(solution):
            weights = np.array([solution[c] for c in criteria_for_weights], dtype=float)
            violation = compute_violation(weights, constraint_data, use_non_linear_model=False, eps=eps)
            return violation

        best_solution = min(solutions, key=score_solution)
        solutions = [best_solution]

    # ========================================================================
    # Summary
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("COMPLETE")
    print_fn("=" * 70)
    print_fn(f"Total solutions: {len(solutions)}")
    print_fn("Weight space computation finished.")
    print_fn("=" * 70)

    if return_metadata:
        return {
            'accepted_solutions': solutions,
            'pre_threshold_decimal_solutions': [
                {'weights': sol, 'error': z_star} for sol in solutions
            ],
            'runtime_parameters': {
                'max_results': max_results,
                'max_restarts': max_restarts,
                'rng_seed': rng_seed,
                'eps': eps,
                'feasibility_tol': feasibility_tol,
                'slsqp_maxiter': slsqp_maxiter,
                'slsqp_ftol': slsqp_ftol,
                'output_weight_decimals': output_weight_decimals,
                'de_popsize': de_popsize,
                'de_maxiter': de_maxiter,
                'de_seed': de_seed,
            },
        }

    return solutions
