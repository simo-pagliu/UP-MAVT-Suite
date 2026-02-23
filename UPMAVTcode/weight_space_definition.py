#!/usr/bin/env python3
"""
Simple Weight Space Explorer
Reads comparison constraints and value functions, then explores the weight space.
"""

import numpy as np
import pandas as pd
import scipy.optimize as opt
from scipy.interpolate import interp1d
import csv

# ============================================================================
# PARAMETERS
# ============================================================================
COMPARISON_FILE = "pile_bwt_7WVLVCGU.csv"
VALUE_FUNCTIONS_FILE = "value_functions_7WVLVCGU.csv"
OUTPUT_FILE = "weight_space_output.csv"
SOLUTION_TARGET = 100
RNG_SEED = 426
Z_THRESHOLD_OFFSET = 0.001
EPS = 0.001

# ============================================================================
# LOAD AND PARSE VALUE FUNCTIONS
# ============================================================================
def load_value_functions(filepath):
    """Load value functions from CSV and build interpolation functions."""
    vf_dict = {}
    df = pd.read_csv(filepath)
    
    for _, row in df.iterrows():
        criterion = row['CRITERION_NAME']
        points_str = row['LIST OF POINTS']
        points = [tuple(map(float, p.split(':'))) for p in points_str.split(';')]
        x_vals, y_vals = zip(*points)
        
        # Create interpolation with clamping to min/max y values
        min_y, max_y = min(y_vals), max(y_vals)
        interp_func = interp1d(x_vals, y_vals, kind='linear', fill_value=(min_y, max_y), bounds_error=False)
        vf_dict[criterion] = interp_func
    
    return vf_dict

# ============================================================================
# LOAD COMPARISONS AND BUILD CONSTRAINT DATA
# ============================================================================
def load_comparisons(filepath):
    """Load comparisons from CSV."""
    df = pd.read_csv(filepath)
    return df.to_dict('records')

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
        'value_functions': value_functions
    }

# ============================================================================
# CONSTRAINT FUNCTION
# ============================================================================
def constraint_func(x, constraint_data, z_star=None):
    """
    Evaluate constraints.
    x = [w_crit1, w_crit2, ..., w_critN, z]
    Returns list of constraint values (must all be >= 0).
    """
    num_criteria = len(constraint_data['criteria'])
    z = x[-1]
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
            # cons.append(z - abs(w_ref / (w_other + EPS) - 1.0 / vf_val))
            cons.append(np.log(z) - np.log(abs(w_ref / (w_other + EPS) - 1.0 / vf_val))) # Logarithmic variant
        else:  # worst
            vf_other = constraint_data['value_functions'][other_crit]
            vf_other_val = max(vf_other(comp_value), EPS)
            # cons.append(z - abs(1.0 / vf_other_val - (w_other + EPS) / (w_ref + EPS)))
            cons.append(np.log(z) - np.log(abs(1.0 / vf_other_val - (w_other + EPS) / (w_ref + EPS)))) # Logarithmic variant
    
    if z_star is not None:
        cons.append(z_star - z)
    
    return cons

# ============================================================================
# OPTIMIZATION
# ============================================================================
def find_max_z(constraint_data, num_criteria):
    """Find maximum z value using COBYQA."""
    bounds = [(0.001, 1) for _ in range(num_criteria)] + [(0.0, 1000.0)]
    
    def objective(x):
        return x[-1]  # Minimize z
    
    x0 = np.ones(num_criteria + 1) / num_criteria
    
    result = opt.minimize(
        objective,
        x0,
        method='COBYQA',
        constraints=[
            {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
            {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1}
        ],
        bounds=bounds,
        options={'maxiter': 2000}
    )
    
    return result.x, result.fun

def max_constraint_violation(x, constraint_data):
    """Calculate maximum constraint violation for a solution."""
    cons = constraint_func(x, constraint_data)
    return max(0, -min(cons)) if cons else 0

def find_all_solutions(constraint_data, num_criteria, num_restarts=150):
    """Find all feasible solutions using DE + multi-start SLSQP."""
    bounds = [(0.001, 1) for _ in range(num_criteria)] + [(0.0, 1000.0)]
    
    # Step 1: Find global optimum using differential evolution
    def objective_for_de(x):
        penalty = 0.0
        PEN = 1e6
        penalty += PEN * max_constraint_violation(x, constraint_data)
        penalty += PEN * abs(np.sum(x[:num_criteria]) - 1.0)
        return x[-1] + penalty
    
    result_de = opt.differential_evolution(
        objective_for_de,
        bounds,
        maxiter=5000,
        popsize=20,
        tol=1e-3,
        polish=True,
        seed=RNG_SEED
    )
    max_violation_opt = max_constraint_violation(result_de.x, constraint_data)
    solutions = [result_de.x]
    
    # Step 2: Multi-start local optimization
    def objective(x, var=-1):
        return x[var]
    
    rng = np.random.RandomState(RNG_SEED)
    for _ in range(num_restarts):
        x0_random = rng.uniform(0.001, 1, size=num_criteria + 1)
        x0_random[-1] = 0.1
        res = opt.minimize(
            objective,
            x0_random,
            method='SLSQP',
            constraints=[
                {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
                {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1}
            ],
            bounds=bounds,
            options={'maxiter': 1000}
        )
        if max_constraint_violation(res.x, constraint_data) <= max_violation_opt + EPS:
            solutions.append(res.x)
    
    return solutions

# ============================================================================
# OUTPUT GENERATION
# ============================================================================
def save_weight_space(solutions, criteria, output_filepath):
    """
    Save weight space to CSV.
    One row per criterion with all its possible weight values.
    """
    if not solutions:
        return
    
    num_criteria = len(criteria)
    weights_array = np.array([sol[:-1] for sol in solutions])
    
    if weights_array.ndim == 1:
        weights_array = weights_array.reshape(1, -1)
    
    with open(output_filepath, 'w', newline='') as f:
        writer = csv.writer(f)
        for crit_idx, crit_name in enumerate(criteria):
            unique_values = sorted(list(set(weights_array[:, crit_idx])))
            writer.writerow([crit_name] + unique_values)

# ============================================================================
# MAIN
# ============================================================================
def main():
    print("Loading value functions...")
    value_functions = load_value_functions(VALUE_FUNCTIONS_FILE)
    
    print("Loading comparisons...")
    comparisons = load_comparisons(COMPARISON_FILE)
    
    print("Building constraint structure...")
    constraint_data = build_constraint_structure(comparisons, value_functions)
    criteria = constraint_data['criteria']
    num_criteria = len(criteria)
    
    print(f"Number of criteria: {num_criteria}")
    print(f"Criteria: {criteria}")
    
    print("\nFinding maximum z...")
    x_opt, _ = find_max_z(constraint_data, num_criteria)
    z_max = x_opt[-1]
    print(f"Maximum z found: {z_max:.3f}")
    
    print(f"\nFinding all solutions in weight space...")
    solutions = find_all_solutions(constraint_data, num_criteria)
    print(f"Found {len(solutions)} solutions")
    
    # Extract z values and filter by threshold
    z_values = np.array([sol[-1] for sol in solutions])
    z_min = z_values.min()
    z_threshold = z_min + Z_THRESHOLD_OFFSET
    filtered_idx = np.where(z_values <= z_threshold)[0]
    filtered_solutions = [solutions[i] for i in filtered_idx]
    print(f"After filtering (z <= {z_threshold:.3f}): {len(filtered_solutions)} solutions")
    
    # Deduplicate by rounding weights
    if filtered_solutions:
        rounded = np.round(np.array([sol[:-1] for sol in filtered_solutions]), 3)
        _, uniq_idx = np.unique(rounded, axis=0, return_index=True)
        # Keep the ROUNDED weights, not the original ones
        unique_solutions = []
        for i in sorted(uniq_idx):
            z_val = filtered_solutions[i][-1]
            unique_solutions.append(np.concatenate((rounded[i], [z_val])))
    else:
        unique_solutions = []
    print(f"After deduplication: {len(unique_solutions)} unique solutions")
    
    print(f"\nSaving weight space to {OUTPUT_FILE}...")
    save_weight_space(unique_solutions, criteria, OUTPUT_FILE)
    print("Done!")

if __name__ == "__main__":
    main()
