#!/usr/bin/env python3
"""
Weight Space Explorer (DB version, v4 workflow)
Reads comparison constraints and value functions from MongoDB,
explores the weight space, and saves results back to DB.
"""

import numpy as np
import scipy.optimize as opt
from scipy.interpolate import interp1d

# ============================================================================
# PARAMETERS
# ============================================================================
RNG_SEED = 426
Z_THRESHOLD_OFFSET = 0.001
EPS = 0.001
N_RESTARTS = 200
CONSTRAINT_TOL = 1e-10


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
# CONSTRAINTS
# ============================================================================
def compute_max_constraint_violation(weights, constraint_data):
    """Compute the maximum absolute constraint violation from weights alone."""
    violations = []

    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        other_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']
        comp_type = comp['TYPE'].lower()

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        other_idx = constraint_data['criterion_to_index'][other_crit]

        w_ref = weights[ref_idx]
        w_other = weights[other_idx]

        if comp_type == 'best':
            vf = constraint_data['value_functions'][ref_crit]
            vf_val = max(vf(comp_value), EPS)
            violations.append(abs(w_ref / (w_other + EPS) - 1.0 / (vf_val + EPS)))
        else:
            vf_other = constraint_data['value_functions'][other_crit]
            vf_other_val = max(vf_other(comp_value), EPS)
            violations.append(abs(1.0 / (vf_other_val + EPS) - (w_other + EPS) / (w_ref + EPS)))

    return max(violations) if violations else 0.0


def constraint_func(x, constraint_data, z_star=None):
    """Evaluate constraints.
    x = [w_crit1, w_crit2, ..., w_critN, z]
    Returns list of constraint values (must all be >= 0).
    """
    cons = []

    for comp in constraint_data['comparisons']:
        ref_crit = comp['REFERENCE_CRITERION']
        other_crit = comp['ADJUSTED_CRITERION']
        comp_value = comp['DATA_VALUE']
        comp_type = comp['TYPE'].lower()

        ref_idx = constraint_data['criterion_to_index'][ref_crit]
        other_idx = constraint_data['criterion_to_index'][other_crit]

        w_ref = x[ref_idx]
        w_other = x[other_idx]

        if comp_type == 'best':
            vf = constraint_data['value_functions'][ref_crit]
            vf_val = max(vf(comp_value), EPS)
            cons.append(x[-1] - abs(w_ref / (w_other + EPS) - 1.0 / (vf_val + EPS)))
        else:
            vf_other = constraint_data['value_functions'][other_crit]
            vf_other_val = max(vf_other(comp_value), EPS)
            cons.append(x[-1] - abs(1.0 / (vf_other_val + EPS) - (w_other + EPS) / (w_ref + EPS)))

    if z_star is not None:
        cons.append(z_star - x[-1])

    return cons


def check_sum_to_one(weights, threshold=0.001):
    """Check if weights sum to 1 within threshold."""
    return abs(np.sum(weights) - 1.0) <= threshold


def check_constraints_satisfied(x, constraint_data, tol=CONSTRAINT_TOL):
    """Run constraint_func on optimizer output x and require all constraints >= -tol."""
    cons = constraint_func(x, constraint_data, z_star=None)
    return all(c >= -tol for c in cons) if cons else True


# ============================================================================
# OPTIMIZATION
# ============================================================================
def find_start_solution_cobyla(constraint_data, num_criteria):
    """Find a starting solution using COBYLA."""
    bounds = [(0.001, 1.0) for _ in range(num_criteria)] + [(0.0, 1000.0)]

    def objective(x):
        return x[-1]

    x0 = np.ones(num_criteria + 1) / num_criteria

    result = opt.minimize(
        objective,
        x0,
        method='COBYLA',
        constraints=[
            {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
            {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1.0},
        ],
        bounds=bounds,
        options={'maxiter': 2000},
    )

    return result.x


def run_slsqp_multistart(constraint_data, num_criteria, num_restarts=N_RESTARTS):
    """Run multi-start SLSQP to minimize z with constraint_func."""
    bounds = [(0.001, 1.0) for _ in range(num_criteria)] + [(0.0, 1000.0)]
    rng = np.random.RandomState(RNG_SEED)
    solutions = []

    def objective(x):
        return x[-1]

    for _ in range(num_restarts):
        w0 = rng.dirichlet(np.ones(num_criteria))
        x0 = np.concatenate([w0, [0.1]])
        res = opt.minimize(
            objective,
            x0,
            method='SLSQP',
            constraints=[
                {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
                {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1.0},
            ],
            bounds=bounds,
            options={'maxiter': 1000},
        )
        if res.success:
            solutions.append(res.x)

    return solutions


# ============================================================================
# FORMAT WEIGHT SPACE FOR DB
# ============================================================================
def format_weight_space_for_db(weights_list, criteria):
    """Convert weights to a DB-friendly structure."""
    if not weights_list:
        return {}

    weights_array = np.array(weights_list)
    if weights_array.ndim == 1:
        weights_array = weights_array.reshape(1, -1)

    result = {}
    for crit_idx, crit_name in enumerate(criteria):
        unique_values = sorted(list(set(
            round(float(v), 3) for v in weights_array[:, crit_idx]
        )))
        result[crit_name] = unique_values

    return result


# ============================================================================
# MAIN ENTRY POINT (called by the worker)
# ============================================================================
def compute_weights(session_doc, criteria, print_fn=None):
    """Compute weight space for a single elicitation session.

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
    dict
        Weight space mapping criterion_name -> [weight values].
    """
    if print_fn is None:
        print_fn = print

    bwt_data = session_doc.get('bwt')
    value_functions_data = session_doc.get('value_functions')
    qualitative_indicators = session_doc.get('qualitative_indicators')

    print_fn("Loading value functions from DB...")
    value_functions = load_value_functions_from_db(criteria, value_functions_data, qualitative_indicators)
    print_fn(f"  Loaded {len(value_functions)} value functions")

    print_fn("Loading comparisons from DB...")
    comparisons = load_comparisons_from_db(bwt_data)
    print_fn(f"  Loaded {len(comparisons)} comparisons")

    if not comparisons:
        print_fn("ERROR: No comparisons found.")
        return {}

    if not value_functions:
        print_fn("ERROR: No value functions found.")
        return {}

    print_fn("Building constraint structure...")
    constraint_data = build_constraint_structure(comparisons, value_functions)
    crit_names = constraint_data['criteria']
    num_criteria = len(crit_names)

    print_fn(f"Number of criteria: {num_criteria}")
    print_fn(f"Criteria: {crit_names}")

    print_fn("\nFinding starting solution with COBYLA...")
    start_x = find_start_solution_cobyla(constraint_data, num_criteria)
    start_weights = start_x[:num_criteria]

    if not check_sum_to_one(start_weights, threshold=0.001):
        print_fn(f"Starting weights: {start_weights}")
        print_fn(f"Starting weights sum: {np.sum(start_weights):.6f}")
        raise RuntimeError("Starting solution does not sum to 1 within tolerance.")

    if not check_constraints_satisfied(start_x, constraint_data):
        cons = constraint_func(start_x, constraint_data, z_star=None)
        print_fn(f"Starting weights: {start_weights}")
        print_fn(f"Constraint values: {cons}")
        raise RuntimeError("Starting solution does not satisfy constraints.")

    z_star = compute_max_constraint_violation(start_weights, constraint_data)
    z_limit = z_star + Z_THRESHOLD_OFFSET

    print_fn(f"Starting z_star: {z_star:.6f}")
    print_fn(f"Target z limit: {z_limit:.6f}")

    print_fn("\nSearching for other solutions with SLSQP...")
    slsqp_candidates = run_slsqp_multistart(constraint_data, num_criteria, num_restarts=N_RESTARTS)

    all_candidates = [start_x] + slsqp_candidates
    filtered = []

    for x in all_candidates:
        weights = x[:num_criteria]
        z_val = x[-1]
        if z_val < z_limit:
            if check_sum_to_one(weights, threshold=0.001) and check_constraints_satisfied(x, constraint_data):
                filtered.append(weights)

    print_fn(f"Candidates after filtering: {len(filtered)}")

    rounded = [np.round(w, 3) for w in filtered]

    if rounded:
        weights_array = np.array(rounded)
        _, uniq_idx = np.unique(weights_array, axis=0, return_index=True)
        unique_weights = [weights_array[i] for i in sorted(uniq_idx)]
    else:
        unique_weights = []

    print_fn(f"Unique solutions after rounding: {len(unique_weights)}")

    weight_space = format_weight_space_for_db(unique_weights, crit_names)
    print_fn("Weight space computed successfully.")
    return weight_space
