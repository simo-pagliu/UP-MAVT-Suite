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
COMPARISON_FILE = "pile_bwt_4.csv"
VALUE_FUNCTIONS_FILE = "value_functions_4.csv"
OUTPUT_FILE = "weight_space_output_4.csv"
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
def compute_max_constraint_violation(weights, constraint_data):
    """
    Compute the maximum absolute constraint violation from weights alone.
    weights = [w_crit1, w_crit2, ..., w_critN] (no z auxiliary variable)
    Returns the maximum absolute violation across all constraints.
    """
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
            violation = abs(w_ref / (w_other + EPS) - 1.0 / (vf_val + EPS))
            violations.append(violation)
        else:  # worst
            vf_other = constraint_data['value_functions'][other_crit]
            vf_other_val = max(vf_other(comp_value), EPS)
            violation = abs(1.0 / (vf_other_val + EPS) - (w_other + EPS) / (w_ref + EPS))
            violations.append(violation)
    
    return max(violations) if violations else 0.0


def constraint_func(x, constraint_data, z_star=None):
    """
    Evaluate constraints for optimization.
    x = [w_crit1, w_crit2, ..., w_critN, z]
    z is an auxiliary variable representing the maximum constraint violation.
    Returns list of constraint values (must all be >= 0).
    """
    num_criteria = len(constraint_data['criteria'])
    z = x[-1]
    weights = x[:num_criteria]
    
    # Compute actual constraint violations from weights
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
            violation = abs(w_ref / (w_other + EPS) - 1.0 / (vf_val + EPS))
            violations.append(violation)
        else:  # worst
            vf_other = constraint_data['value_functions'][other_crit]
            vf_other_val = max(vf_other(comp_value), EPS)
            violation = abs(1.0 / (vf_other_val + EPS) - (w_other + EPS) / (w_ref + EPS))
            violations.append(violation)
    
    # Constraint: z must be >= all violations
    cons = [z - v for v in violations]
    
    if z_star is not None:
        cons.append(z_star - z)
    
    return cons

# ============================================================================
# OPTIMIZATION
# ============================================================================
def check_sum_to_one(weights, threshold=0.001):
    """Check if weights sum to 1 within threshold."""
    return abs(np.sum(weights) - 1.0) <= threshold


def check_constraints_satisfied(weights, constraint_data, num_criteria):
    """
    Check if all constraints are satisfied for given weights.
    Sets z=0 and checks if all constraint values are positive (>= 0).
    """
    x = np.concatenate([weights, [0.0]])
    cons = constraint_func(x, constraint_data, z_star=None)
    return all(c >= -EPS for c in cons) if cons else True


def find_solutions_de(constraint_data, num_criteria):
    """Find solutions using Differential Evolution."""
    bounds = [(0.001, 1) for _ in range(num_criteria)] + [(0.0, 1000.0)]
    
    def objective_for_de(x):
        penalty = 0.0
        PEN = 1e6
        # Penalties for constraint violations
        penalty += PEN * abs(np.sum(x[:num_criteria]) - 1.0)
        penalty += PEN * x[-1]  # Minimize z
        return penalty
    
    result_de = opt.differential_evolution(
        objective_for_de,
        bounds,
        maxiter=5000,
        popsize=20,
        tol=1e-3,
        polish=True,
        seed=RNG_SEED
    )
    return [result_de.x]


def find_solutions_multistart_slsqp(constraint_data, num_criteria, num_restarts=150):
    """Find solutions using multi-start SLSQP."""
    bounds = [(0.001, 1) for _ in range(num_criteria)] + [(0.0, 1000.0)]
    
    def objective(x):
        return x[-1]
    
    solutions = []
    rng = np.random.RandomState(RNG_SEED)
    
    for restart_idx in range(num_restarts):
        x0_random = rng.uniform(0.001, 1, size=num_criteria)
        x0_random = x0_random / np.sum(x0_random)  # Normalize to sum to 1
        x0 = np.concatenate([x0_random, [0.1]])
        
        res = opt.minimize(
            objective,
            x0,
            method='SLSQP',
            constraints=[
                {'type': 'ineq', 'fun': constraint_func, 'args': (constraint_data, None)},
                {'type': 'eq', 'fun': lambda x: np.sum(x[:num_criteria]) - 1}
            ],
            bounds=bounds,
            options={'maxiter': 1000}
        )
        
        if res.success:
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
    
    print("\nFinding solutions with Differential Evolution...")
    de_solutions = find_solutions_de(constraint_data, num_criteria)
    print(f"Found {len(de_solutions)} solutions from DE")
    
    print("\nFinding solutions with multi-start SLSQP...")
    slsqp_solutions = find_solutions_multistart_slsqp(constraint_data, num_criteria, num_restarts=150)
    print(f"Found {len(slsqp_solutions)} solutions from SLSQP")
    
    all_solutions = de_solutions + slsqp_solutions
    print(f"\nTotal solutions collected: {len(all_solutions)}")
    
    # Filter 1: Check sum to 1
    sum_filtered = []
    for sol in all_solutions:
        weights = sol[:num_criteria]
        if check_sum_to_one(weights, threshold=0.001):
            sum_filtered.append(sol)
    print(f"After filtering sum to 1: {len(sum_filtered)} solutions")
    
    # Filter 2: Check constraints satisfied
    constraint_filtered = []
    for sol in sum_filtered:
        weights = sol[:num_criteria]
        if check_constraints_satisfied(weights, constraint_data, num_criteria):
            constraint_filtered.append(sol)
    print(f"After filtering constraints satisfied: {len(constraint_filtered)} solutions")
    
    # Round to 3 decimals
    rounded_solutions = []
    for sol in constraint_filtered:
        weights = np.round(sol[:num_criteria], 3)
        # Normalize to sum to 1
        if np.sum(weights) > 0:
            weights = weights / np.sum(weights)
        rounded_solutions.append(weights)
    print(f"After rounding to 3 decimals: {len(rounded_solutions)} solutions")
    
    # Deduplicate
    if rounded_solutions:
        weights_array = np.array(rounded_solutions)
        _, uniq_idx = np.unique(weights_array, axis=0, return_index=True)
        unique_solutions = [weights_array[i] for i in sorted(uniq_idx)]
    else:
        unique_solutions = []
    
    print(f"After deduplication: {len(unique_solutions)} unique solutions")
    
    print("\nSample solutions:")
    for i, weights in enumerate(unique_solutions[:10]):
        violation = compute_max_constraint_violation(weights, constraint_data)
        print(f"  Solution {i+1}: violation = {violation:.6f}, weights = {weights}, sum = {np.sum(weights):.4f}")
    
    print(f"\nSaving weight space to {OUTPUT_FILE}...")
    # Reconstruct solutions with z values for save_weight_space
    final_solutions = []
    for weights in unique_solutions:
        z_val = compute_max_constraint_violation(weights, constraint_data)
        sol = np.concatenate([weights, [z_val]])
        final_solutions.append(sol)
    
    save_weight_space(final_solutions, criteria, OUTPUT_FILE)
    print("Done!")

if __name__ == "__main__":
    main()
