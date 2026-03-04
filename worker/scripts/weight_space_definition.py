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


# ============================================================================
# LOAD AND PARSE VALUE FUNCTIONS FROM DB DATA
# ============================================================================
def load_value_functions_from_db(criteria, value_functions_data, qualitative_indicators=None):
    """Build interpolation functions from DB value_functions and qualitative data.

    Parameters
    ----------
    criteria : list[dict]
        The criteria list from the input document.
    value_functions_data : dict
        The ``value_functions`` field stored on the session document.
    qualitative_indicators : dict or None
        The ``qualitative_indicators`` field stored on the session document.

    Returns
    -------
    dict
        Mapping criterion_name -> scipy interp1d function.
    """
    vf_dict = {}
    criteria_map = value_functions_data.get('criteria', {}) if isinstance(value_functions_data, dict) else {}

    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        name = criterion.get('criterion_name')
        if not name:
            continue

        points = []

        if criterion.get('is_qualitative'):
            points = _generate_qualitative_value_function(qualitative_indicators, name)
        else:
            cfg = criteria_map.get(name, {})
            if isinstance(cfg, dict):
                points = cfg.get('points', [])

        if not points or len(points) < 2:
            continue

        x_vals = [float(p['x']) for p in points if 'x' in p and 'y' in p]
        y_vals = [float(p['y']) for p in points if 'x' in p and 'y' in p]

        if len(x_vals) < 2:
            continue

        min_y, max_y = min(y_vals), max(y_vals)
        interp_func = interp1d(
            x_vals,
            y_vals,
            kind='linear',
            fill_value=(min_y, max_y),
            bounds_error=False,
        )
        vf_dict[name] = interp_func

    return vf_dict


def _generate_qualitative_value_function(qualitative_indicators, criterion_name):
    """Generate value function points for a qualitative indicator."""
    if not isinstance(qualitative_indicators, dict):
        return []
    data = qualitative_indicators.get(criterion_name)
    if not isinstance(data, dict):
        return []

    ranking = data.get('ranking')
    values = data.get('values')
    is_increasing = data.get('isIncreasing', True)

    if not isinstance(ranking, dict) or not isinstance(values, dict):
        return []

    unique_ranks = sorted(set(ranking.values()))
    if len(unique_ranks) == 0:
        return []

    points = []
    total_points = len(unique_ranks) + 2

    points.append({'x': 0, 'y': 0 if is_increasing else 1})

    for idx, rank in enumerate(reversed(unique_ranks)):
        x_pos = idx + 1
        x_normalized = x_pos / (total_points - 1)
        y_value = values.get(rank)
        if y_value is None:
            y_value = values.get(str(rank))
        if y_value is None:
            y_value = x_normalized
        points.append({'x': x_normalized, 'y': y_value})

    points.append({'x': 1, 'y': 1 if is_increasing else 0})

    return points


# ============================================================================
# LOAD COMPARISONS FROM DB DATA
# ============================================================================
def load_comparisons_from_db(bwt_data):
    """Convert DB bwt data to comparison records.

    Parameters
    ----------
    bwt_data : dict
        The ``bwt`` field stored on the session document.

    Returns
    -------
    list[dict]
        Each dict has REFERENCE_CRITERION, ADJUSTED_CRITERION, DATA_VALUE, TYPE, GROUP.
    """
    if not isinstance(bwt_data, dict):
        return []

    comparisons_raw = bwt_data.get('comparisons', [])
    comparisons = []
    for comp in comparisons_raw:
        if not isinstance(comp, dict):
            continue
        comparisons.append({
            'REFERENCE_CRITERION': comp.get('reference_criterion', ''),
            'ADJUSTED_CRITERION': comp.get('adjusted_criterion', ''),
            'DATA_VALUE': float(comp.get('data_value', 0)),
            'TYPE': comp.get('type', ''),
            'GROUP': comp.get('group', ''),
        })
    return comparisons


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


def _comparison_abs_violation(comp_type, w_ref, w_adj, vf_adj_val):
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
    # Both best and worst use: 1/vf_adj - w_adj/w_ref
    return abs(1.0 / vf_adj_val - (w_adj + EPS) / (w_ref + EPS))


def compute_max_violation_weights_only(weights, constraint_data):
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
        _comparison_abs_violation(comp_type, w_ref, w_adj, vf_adj_val)
        for comp_type, w_ref, w_adj, vf_adj_val in _iter_comparison_terms(weights, constraint_data)
    ]

    return max(violations) if violations else 0.0


def check_sum_to_one(weights, threshold=0.001):
    """Check if weights sum to 1 within threshold."""
    return abs(np.sum(weights) - 1.0) <= threshold


def check_constraints_satisfied(weights, constraint_data, tol=FEASIBILITY_TOL):
    """Check if weights satisfy all constraints within tolerance."""
    violation = compute_max_violation_weights_only(weights, constraint_data)
    return violation <= tol


def constraint_func(x, constraint_data, z_star=None):
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
        abs_violation = _comparison_abs_violation(comp_type, w_ref, w_adj, vf_adj_val)
        violations.append(np.log(z) - np.log(abs_violation))

    return violations


# ============================================================================
# OPTIMIZATION
# ============================================================================
# ============================================================================
# OPTIMIZATION - Three-Phase Approach
# ============================================================================
def find_minimum_infeasibility(constraint_data, num_criteria, print_fn=None):
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
    objective = partial(compute_max_violation_weights_only, constraint_data=constraint_data)
    
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
    
    de_violation = objective(de_result.x)
    de_weights = de_result.x / np.sum(de_result.x)
    print_fn(f"    Global best violation: {de_violation:.6f}")

    print_fn(f"  Final minimum violation: {de_violation:.6f}")
    return de_weights, de_violation


def sample_feasible_region_lhs(constraint_data, num_criteria, n_samples=None, print_fn=None):
    """PHASE 2: Sample the feasible region using Latin Hypercube Sampling.
    
    Generates diverse weight vectors across the feasible region and refines them
    locally to improve constraint satisfaction.
    
    Parameters
    ----------
    constraint_data : dict
        Constraint structure.
    num_criteria : int
        Number of criteria.
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
    weights_list = []
    for sample in samples_unit:
        coords = np.concatenate([[0], np.sort(sample), [1]])
        weights = np.diff(coords)
        weights_list.append(weights)
    
    print_fn(f"Refining samples via local optimization...")
    refined_weights = []

    objective = partial(compute_max_violation_weights_only, constraint_data=constraint_data)

    for idx, weights in enumerate(weights_list):
        if idx % max(1, len(weights_list) // 10) == 0:
            print_fn(f"  Progress: {idx}/{len(weights_list)}")
        
        result = opt.minimize(
            objective,
            weights,
            method='SLSQP',
            bounds=[(0.001, 1.0) for _ in range(num_criteria)],
            constraints={'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0},
            options={'maxiter': 200, 'ftol': 1e-8}
        )
        
        if result.success:
            refined_weights.append(result.x / np.sum(result.x))
        else:
            refined_weights.append(weights)
    
    print_fn(f"Refined {len(refined_weights)} samples")
    return refined_weights


def enumerate_weight_space(weights_list, criterion_names, min_violation=0.0,
                          constraint_data=None, print_fn=None):
    """PHASE 3: Filter, discretize, and enumerate unique feasible weight sets.
    
    Keeps only weights satisfying constraints, rounds to 0.001 resolution,
    and deduplicates to produce the final weight space.
    
    Parameters
    ----------
    weights_list : list[ndarray]
        Raw weight vectors (may include near-feasible ones).
    criterion_names : list[str]
        Criterion names for output.
    min_violation : float
        Minimum achievable violation (tolerance threshold).
    constraint_data : dict or None
        Constraint structure for filtering.
    print_fn : callable or None
        Logging function.
    
    Returns
    -------
    tuple
        (weight_solutions, num_unique_weights)
    """
    if print_fn is None:
        print_fn = print
    
    print_fn(f"Filtering to feasible solutions (violation <= {min_violation + 0.01:.6f})...")
    
    # Filter to keep only feasible solutions
    feasible = []
    for w in weights_list:
        if constraint_data is not None:
            violation = compute_max_violation_weights_only(w, constraint_data)
            if violation <= min_violation + 0.01:  # Small tolerance buffer
                feasible.append(w)
        else:
            feasible.append(w)
    
    print_fn(f"Feasible solutions: {len(feasible)}")
    
    if not feasible:
        print_fn("WARNING: No feasible solutions found after filtering!")
        return {}, 0
    
    feasible_array = np.array(feasible)
    
    # Round to 3 decimal places (0.001 resolution)
    print_fn("Rounding to 0.001 resolution and deduplicating...")
    rounded = np.round(feasible_array, 3)
    
    # Normalize each rounded weight to exactly sum to 1
    rounded = rounded / rounded.sum(axis=1, keepdims=True)
    
    # Remove duplicates
    unique_indices = np.unique(rounded, axis=0, return_index=True)[1]
    unique_weights = rounded[np.sort(unique_indices)]
    
    print_fn(f"Unique solutions: {len(unique_weights)}")
    
    # Format for database as complete solutions
    weight_solutions = []
    for w in unique_weights:
        solution = {
            crit_name: round(float(w[crit_idx]), 3)
            for crit_idx, crit_name in enumerate(criterion_names)
        }
        weight_solutions.append(solution)

    return weight_solutions, len(unique_weights)


# ============================================================================
# MAIN ENTRY POINT (called by the worker)
# ============================================================================
def compute_weights(session_doc, criteria, print_fn=None):
    """Compute weight space for a single elicitation session using three-phase approach.
    
    PHASE 1: Find minimum infeasibility (best possible constraint satisfaction)
    PHASE 2: Sample feasible region via Latin Hypercube + local refinement
    PHASE 3: Enumerate unique solutions at 0.001 resolution

    Parameters
    ----------
    session_doc : dict
        The full session document from MongoDB.
    criteria : list[dict]
        The criteria from the input document.
    print_fn : callable or None
        Function to call for logging (defaults to ``print``).

    Returns
    -------
    list[dict]
        Complete feasible weight solutions.
    """
    if print_fn is None:
        print_fn = print

    bwt_data = session_doc.get('bwt')
    value_functions_data = session_doc.get('value_functions')
    qualitative_indicators = session_doc.get('qualitative_indicators')

    print_fn("=" * 70)
    print_fn("THREE-PHASE WEIGHT SPACE EXPLORATION")
    print_fn("=" * 70)

    print_fn("\n[SETUP] Loading value functions from DB...")
    value_functions = load_value_functions_from_db(criteria, value_functions_data, qualitative_indicators)
    print_fn(f"  ✓ Loaded {len(value_functions)} value functions")

    print_fn("\n[SETUP] Loading comparisons from DB...")
    comparisons = load_comparisons_from_db(bwt_data)
    print_fn(f"  ✓ Loaded {len(comparisons)} comparisons")

    if not comparisons:
        print_fn("ERROR: No comparisons found.")
        return {}

    if not value_functions:
        print_fn("ERROR: No value functions found.")
        return {}

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
        constraint_data, num_criteria, print_fn=print_fn
    )
    
    print_fn(f"\nBest solution found:")
    print_fn(f"  Weights: {np.round(best_weights, 4)}")
    print_fn(f"  Max violation: {min_violation:.8f}")
    print_fn(f"  Sum check: {np.sum(best_weights):.6f}")
    
    if min_violation > 0.1:
        print_fn("\nWARNING: Minimum violation is large (>0.1).")
        print_fn("This may indicate infeasible or very constrained problem.")

    # ========================================================================
    # PHASE 2: Sample feasible region
    # ========================================================================
    print_fn("\n" + "=" * 70)
    print_fn("PHASE 2: Sampling feasible region")
    print_fn("=" * 70)
    
    sampled_weights = sample_feasible_region_lhs(
        constraint_data, num_criteria, n_samples=LHS_SAMPLES, print_fn=print_fn
    )

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
