#!/usr/bin/env python3
"""
Weight Space Explorer (DB version)
Reads comparison constraints and value functions from MongoDB,
explores the weight space, and saves results back to DB.
"""

import numpy as np
import scipy.optimize as opt
from scipy.interpolate import interp1d

# ============================================================================
# PARAMETERS
# ============================================================================
SOLUTION_TARGET = 100
RNG_SEED = 426
Z_THRESHOLD_OFFSET = 0.001
EPS = 0.001


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
            # Generate value function from qualitative indicators
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
        interp_func = interp1d(x_vals, y_vals, kind='linear',
                               fill_value=(min_y, max_y), bounds_error=False)
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

    if is_increasing:
        points.append({'x': 0, 'y': 0})
    else:
        points.append({'x': 0, 'y': 1})

    for idx, rank in enumerate(reversed(unique_ranks)):
        x_pos = idx + 1
        x_normalized = x_pos / (total_points - 1)
        y_value = values.get(rank)
        if y_value is None:
            y_value = values.get(str(rank))
        if y_value is None:
            y_value = x_normalized
        points.append({'x': x_normalized, 'y': y_value})

    if is_increasing:
        points.append({'x': 1, 'y': 1})
    else:
        points.append({'x': 1, 'y': 0})

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
# CONSTRAINT FUNCTION
# ============================================================================
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
            cons.append(np.log(x[-1]) - np.log(abs(w_ref / (w_other + EPS) - 1.0 / vf_val)))
        else:  # worst
            vf_other = constraint_data['value_functions'][other_crit]
            vf_other_val = max(vf_other(comp_value), EPS)
            cons.append(np.log(x[-1]) - np.log(abs(1.0 / vf_other_val - (w_other + EPS) / (w_ref + EPS))))

    if z_star is not None:
        cons.append(z_star - x[-1])

    return cons


# ============================================================================
# OPTIMIZATION
# ============================================================================
def find_max_z(constraint_data, num_criteria):
    """Find maximum z value using COBYQA."""
    bounds = [(0.001, 1) for _ in range(num_criteria)] + [(0.0, 1000.0)]

    def objective(x):
        return x[-1]

    x0 = np.ones(num_criteria + 1) / num_criteria

    result = opt.minimize(
        objective,
        x0,
        method='COBYQA',
        constraints=[
            {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
            {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1},
        ],
        bounds=bounds,
        options={'maxiter': 2000},
    )

    return result.x, result.fun


def max_constraint_violation(x, constraint_data):
    """Calculate maximum constraint violation for a solution."""
    cons = constraint_func(x, constraint_data)
    return max(0, -min(cons)) if cons else 0


def find_all_solutions(constraint_data, num_criteria, num_restarts=150, print_fn=None):
    """Find all feasible solutions using DE + multi-start SLSQP."""
    if print_fn is None:
        print_fn = lambda msg: None

    bounds = [(0.001, 1) for _ in range(num_criteria)] + [(0.0, 1000.0)]

    def objective_for_de(x):
        penalty = 0.0
        PEN = 1e6
        penalty += PEN * max_constraint_violation(x, constraint_data)
        penalty += PEN * abs(np.sum(x[:num_criteria]) - 1.0)
        return x[-1] + penalty

    print_fn("  Running Differential Evolution (maxiter=5000, popsize=20)...")
    result_de = opt.differential_evolution(
        objective_for_de,
        bounds,
        maxiter=5000,
        popsize=20,
        tol=1e-3,
        polish=True,
        seed=RNG_SEED,
    )
    print_fn(f"  DE completed: z={result_de.x[-1]:.6f}, success={result_de.success}")
    max_violation_opt = max_constraint_violation(result_de.x, constraint_data)
    solutions = [result_de.x]

    def objective(x, var=-1):
        return x[var]

    print_fn(f"  Running {num_restarts} multi-start SLSQP restarts...")
    rng = np.random.RandomState(RNG_SEED)
    for i in range(num_restarts):
        x0_random = rng.uniform(0.001, 1, size=num_criteria + 1)
        x0_random[-1] = 0.1
        res = opt.minimize(
            objective,
            x0_random,
            method='SLSQP',
            constraints=[
                {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
                {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1},
            ],
            bounds=bounds,
            options={'maxiter': 1000},
        )
        if max_constraint_violation(res.x, constraint_data) <= max_violation_opt + EPS:
            solutions.append(res.x)
        if (i + 1) % 25 == 0:
            print_fn(f"  SLSQP restart {i + 1}/{num_restarts} done, {len(solutions)} feasible solutions so far")

    return solutions


# ============================================================================
# FORMAT WEIGHT SPACE FOR DB
# ============================================================================
def format_weight_space_for_db(solutions, criteria):
    """Convert solutions to a DB-friendly structure.

    Returns
    -------
    dict
        Mapping criterion_name -> list of unique rounded weight values.
    """
    if not solutions:
        return {}

    num_criteria = len(criteria)
    weights_array = np.array([sol[:-1] for sol in solutions])

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

    print_fn("\nFinding maximum z (COBYQA)...")
    x_opt, _ = find_max_z(constraint_data, num_criteria)
    z_max = x_opt[-1]
    print_fn(f"Maximum z found: {z_max:.3f}")

    print_fn("\nFinding all solutions in weight space...")
    solutions = find_all_solutions(constraint_data, num_criteria, print_fn=print_fn)
    print_fn(f"Found {len(solutions)} solutions")

    # Extract z values and filter by threshold
    z_values = np.array([sol[-1] for sol in solutions])
    z_min = z_values.min()
    z_threshold = z_min + Z_THRESHOLD_OFFSET
    filtered_idx = np.where(z_values <= z_threshold)[0]
    filtered_solutions = [solutions[i] for i in filtered_idx]
    print_fn(f"After filtering (z <= {z_threshold:.3f}): {len(filtered_solutions)} solutions")

    # Deduplicate by rounding weights
    if filtered_solutions:
        rounded = np.round(np.array([sol[:-1] for sol in filtered_solutions]), 3)
        _, uniq_idx = np.unique(rounded, axis=0, return_index=True)
        unique_solutions = []
        for i in sorted(uniq_idx):
            z_val = filtered_solutions[i][-1]
            unique_solutions.append(np.concatenate((rounded[i], [z_val])))
    else:
        unique_solutions = []
    print_fn(f"After deduplication: {len(unique_solutions)} unique solutions")

    weight_space = format_weight_space_for_db(unique_solutions, crit_names)
    print_fn("Weight space computed successfully.")
    return weight_space
