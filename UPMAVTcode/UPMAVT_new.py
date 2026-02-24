#!/usr/bin/env python3
"""
UP-MAVT: Uncertainty Propagated - Multi Attribute Value Theory

Simone Pagliuca, 2025-2026
"""

import numpy as np
import pandas as pd
import csv
import os
from scipy.interpolate import interp1d
from weight_space_definition import (
    constraint_func as ws_constraint_func,
    load_comparisons,
    build_constraint_structure,
)

# ============================================================================
# PARAMETERS
# ============================================================================
ELICITATION_CODES = ["4"]  # List of elicitation codes (e.g., ["7WVLVCGU", "9"])
ALTERNATIVES_FILE = "input_test.csv"
OUTPUT_DIR = "results"

MC_ITERATIONS = 1000  # Number of Monte Carlo iterations
AGGREGATION_METHOD = "weighted_sum"  # Options: weighted_sum, geometric_mean, harmonic_mean
MC_MODE = "non_strict"  # Options: strict, non_strict

# Opinion weights for selecting elicitations (non-strict mode)
# By default, equal weights for all elicitations
ELICITATION_OPINION_WEIGHTS = None  # If None, will be set to uniform weights

# ============================================================================
# LOAD VALUE FUNCTIONS AND CONFIDENCE LEVELS
# ============================================================================
def load_value_functions_with_confidence(filepath):
    """Load value functions and confidence levels from CSV."""
    vf_dict = {}
    confidence_dict = {}
    df = pd.read_csv(filepath)
    
    for _, row in df.iterrows():
        criterion = row['CRITERION_NAME']
        confidence = int(row['CONFIDENCE'])
        points_str = row['LIST OF POINTS']
        points = [tuple(map(float, p.split(':'))) for p in points_str.split(';')]
        x_vals, y_vals = zip(*points)
        
        # Create interpolation with clamping to min/max y values
        min_y, max_y = 0, 1
        interp_func = interp1d(x_vals, y_vals, kind='linear', fill_value=(min_y, max_y), bounds_error=False)
        vf_dict[criterion] = interp_func
        confidence_dict[criterion] = confidence
    
    return vf_dict, confidence_dict

# ============================================================================
# LOAD WEIGHT SPACES
# ============================================================================
def load_weight_space(filepath):
    """Load weight space from CSV."""
    weight_space = {}
    with open(filepath, 'r') as f:
        for line in f:
            parts = [p.strip() for p in line.strip().split(',')]
            if len(parts) > 1:
                criterion = parts[0]
                try:
                    weights = [float(w) for w in parts[1:] if w and w != '']
                    if weights:
                        weight_space[criterion] = weights
                except ValueError:
                    pass
    return weight_space

# ============================================================================
# WEIGHT SAMPLING (rejection sampling)
# ============================================================================
def weight_sampler(weight_space, criteria, constraint_data, use_random_weights=False):
    """Sample a random set of weights via rejection sampling.

    Randomly picks one weight per criterion from its weight space, then
    checks that (a) they sum to 1 and (b) the BWT constraints are
    satisfied.  Repeats until a valid set is found.

    Parameters
    ----------
    weight_space : dict
        Mapping criterion_name -> list of allowable weight values.
    criteria : list[str]
        List of criterion names.
    constraint_data : dict
        Constraint structure built by ``build_constraint_structure``.
    use_random_weights : bool
        If True, generate weights from a Dirichlet distribution instead
        of sampling from the weight space.

    Returns
    -------
    dict
        Mapping criterion_name -> sampled weight.
    """
    if use_random_weights:
        # Dirichlet distribution: uniform random weights
        n = len(criteria)
        raw = np.random.dirichlet(np.ones(n))
        return {crit: raw[i] for i, crit in enumerate(criteria)}

    while True:
        # Randomly sample one weight per criterion
        sampled_weights = {}
        for crit in criteria:
            if crit in weight_space:
                sampled_weights[crit] = np.random.choice(weight_space[crit])

        # Check if they sum to 1
        total = sum(sampled_weights.values())
        if not np.isclose(total, 1.0, atol=1e-3):
            continue

        # Check constraints
        ordered_criteria = constraint_data['criteria']
        x_temp = np.concatenate(([sampled_weights.get(c, 0.0) for c in ordered_criteria], [0]))
        cons = ws_constraint_func(x_temp, constraint_data)
        if any(c < 0 for c in cons):
            continue

        return sampled_weights

# ============================================================================
# LOAD ALTERNATIVES
# ============================================================================
def load_alternatives(filepath):
    """Load alternatives from input CSV file."""
    df = pd.read_csv(filepath)
    
    # Skip metadata rows: first 3 rows and last row
    data_rows = df.iloc[2:-1]  # Skip Group, Description rows and Unit row
    
    alternatives = {}
    criteria = df.columns[1:]  # Skip the Alternative column
    
    for idx, row in data_rows.iterrows():
        alt_name = row['Alternative']
        alternatives[alt_name] = {}
        for crit in criteria:
            value_str = str(row[crit]).strip()
            alternatives[alt_name][crit] = value_str
    
    return alternatives, list(criteria)

# ============================================================================
# PARSE DISTRIBUTION STRINGS
# ============================================================================
def sample_from_distribution(dist_str):
    """Parse and sample from distribution string."""
    dist_str = str(dist_str).strip()
    
    # Deterministic value
    try:
        return float(dist_str)
    except:
        pass
    
    # Normal distribution: N(mu, sigma)
    if dist_str.startswith('N('):
        parts = dist_str[2:-1].split(',')
        mu, sigma = float(parts[0]), float(parts[1])
        return np.random.normal(mu, sigma)
    
    # Uniform distribution: U(a, b)
    if dist_str.startswith('U('):
        parts = dist_str[2:-1].split(',')
        a, b = float(parts[0]), float(parts[1])
        return np.random.uniform(a, b)
    
    # Percentage or absolute margin: 50 ± 5% or 50 ± 5
    if '±' in dist_str:
        parts = dist_str.split('±')
        base = float(parts[0].strip())
        margin_str = parts[1].strip()
        
        if '%' in margin_str:
            # Percentage margin: 50 ± 5%
            pct = float(margin_str.rstrip('%'))
            margin = base * (pct / 100)
        else:
            # Absolute margin: 50 ± 5
            margin = float(margin_str)
        
        return np.random.uniform(base - margin, base + margin)
    
    # Triangular or Trapezoidal: TRAP(a, b, c, d) or TRAP(a, b, c, d, min_prob)
    # where a, b, c, d are x-coordinates and min_prob is the minimum probability at edges (default 0)
    if dist_str.startswith('TRAP('):
        parts = dist_str[5:-1].split(',')
        if len(parts) >= 4:
            # Trapezoidal distribution
            a, b, c, d = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])
            min_prob = float(parts[4]) if len(parts) >= 5 else 0.0
            
            # Use rejection sampling for trapezoidal distribution
            # PDF: linear from a to b, constant from b to c, linear from c to d
            max_prob = 1.0
            
            # Rejection sampling
            while True:
                x = np.random.uniform(a, d)
                
                # Compute PDF at x
                if x < b:
                    # Linear increase from min_prob to 1.0
                    pdf_val = min_prob + (max_prob - min_prob) * (x - a) / (b - a)
                elif x < c:
                    # Flat at 1.0
                    pdf_val = max_prob
                else:
                    # Linear decrease from 1.0 to min_prob
                    pdf_val = max_prob - (max_prob - min_prob) * (x - c) / (d - c)
                
                # Rejection test
                if np.random.uniform(0, max_prob) < pdf_val:
                    return x
        
        elif len(parts) >= 3:
            # Fall back to triangular if only 3 points given
            a, b, c = float(parts[0]), float(parts[1]), float(parts[2])
            return np.random.triangular(a, b, c)
    
    # Discrete distribution: {N, N2, N3, ...}
    if dist_str.startswith('{') and dist_str.endswith('}'):
        values_str = dist_str[1:-1]  # Remove curly braces
        values = [float(v.strip()) for v in values_str.split(',')]
        return np.random.choice(values)
    
    # Fallback
    try:
        return float(dist_str.replace('{', '').replace('}', ''))
    except:
        return 0.0

# ============================================================================
# AGGREGATION METHODS
# ============================================================================
def weighted_sum(intermediate_results):
    """w1*v1 + w2*v2 + ... + wn*vn"""
    total = 0.0
    for weight, value in intermediate_results:
        total += weight * value
    return total

def geometric_mean(intermediate_results):
    """(v1^w1 * v2^w2 * ... * vn^wn)"""
    product = 1.0
    for weight, value in intermediate_results:
        if value > 0:
            product *= value ** weight
    return product

def harmonic_mean(intermediate_results):
    """1 / (w1/v1 + w2/v2 + ... + wn/vn)"""
    denom = 0.0
    for weight, value in intermediate_results:
        if value > 0:
            denom += weight / value
    if denom > 0:
        return 1.0 / denom
    return 0.0

# ============================================================================
# EVALUATION FUNCTION
# ============================================================================
def evaluate_alternative(alt_data, criteria, vf_lists, confidence_lists, weight_elicit_idx, vf_elicit_idx, sampled_weights, aggregation_func):
    """Evaluate single alternative using MAVT.
    
    Args:
        alt_data: Alternative data (criterion -> value string)
        criteria: List of criterion names
        vf_lists: List of value function dicts (one per elicitation)
        confidence_lists: List of confidence dicts (one per elicitation)
        weight_elicit_idx: Elicitation index for weight sampling
        vf_elicit_idx: Elicitation index for value functions
        sampled_weights: Sampled weights dict
        aggregation_func: Aggregation function
    """
    # Confidence level error mapping: 0-4 -> percentage error
    confidence_errors = {
        0: 0.10,      # Not confident: ±10%
        1: 0.075,     # Low: ±7.5%
        2: 0.05,      # Medium: ±5%
        3: 0.025,     # High: ±2.5%
        4: 0.0        # Fully confident: no error
    }
    
    intermediate_results = []
    
    for crit in criteria:
        if crit in alt_data:
            # Sample from distribution
            raw_value = sample_from_distribution(alt_data[crit])
            
            # Get value function from vf_elicit_idx
            vf = vf_lists[vf_elicit_idx][crit]
            confidence = confidence_lists[vf_elicit_idx].get(crit, 4)
            
            # Apply value function
            normalized_value = float(vf(raw_value))
            
            # Apply confidence-based error
            error_pct = confidence_errors.get(confidence, 0.0)
            if error_pct > 0:
                error_margin = normalized_value * error_pct
                normalized_value = np.random.uniform(normalized_value - error_margin, normalized_value + error_margin)
                # Clip to [0, 1]
                normalized_value = np.clip(normalized_value, 0.0, 1.0)
            
            # Get weight for this criterion
            w = sampled_weights.get(crit, 1.0 / len(criteria))
            
            intermediate_results.append((w, normalized_value))
    
    # Aggregate
    score = aggregation_func(intermediate_results)
    return score

# ============================================================================
# MONTE CARLO SIMULATION
# ============================================================================
def run_monte_carlo(alternatives, criteria, weight_spaces, vf_lists, confidence_lists,
                    constraint_data_list,
                    aggregation_method, opinion_weights, num_iterations, mc_mode):
    """Run MC simulation.
    
    Args:
        weight_spaces: List of weight space dicts (one per elicitation)
        vf_lists: List of value function dicts (one per elicitation)
        confidence_lists: List of confidence dicts (one per elicitation)
        constraint_data_list: List of constraint data dicts (one per elicitation)
        opinion_weights: Weights for selecting elicitations in non-strict mode
        mc_mode: "strict" or "non_strict"
    """
    
    # Select aggregation function
    if aggregation_method == "weighted_sum":
        agg_func = weighted_sum
    elif aggregation_method == "geometric_mean":
        agg_func = geometric_mean
    elif aggregation_method == "harmonic_mean":
        agg_func = harmonic_mean
    else:
        agg_func = weighted_sum
    
    num_elicitations = len(weight_spaces)
    
    # Store results: elicit_idx -> {alt_name -> [scores]}
    # or just alt_name -> [scores] if single elicitation
    results = {}
    
    if mc_mode == "strict":
        # Strict mode: iterate over all elicitations per MC run
        for elicit_idx in range(num_elicitations):
            results[elicit_idx] = {alt_name: [] for alt_name in alternatives.keys()}
        
        for iteration in range(num_iterations):
            for elicit_idx in range(num_elicitations):
                # Sample weights from this elicitation's weight space
                sampled_weights = weight_sampler(
                    weight_spaces[elicit_idx], criteria,
                    constraint_data_list[elicit_idx],
                )
                
                # Evaluate each alternative (both weight and VF from same elicitation)
                for alt_name, alt_data in alternatives.items():
                    score = evaluate_alternative(alt_data, criteria, vf_lists, confidence_lists, 
                                                elicit_idx, elicit_idx, sampled_weights, agg_func)
                    results[elicit_idx][alt_name].append(score)
    else:
        # Non-strict mode: randomly select elicitations for weights and VFs independently
        results = {alt_name: [] for alt_name in alternatives.keys()}
        
        for iteration in range(num_iterations):
            # Randomly select elicitation for weights
            weight_elicit_idx = np.random.choice(num_elicitations, p=opinion_weights)
            sampled_weights = weight_sampler(
                weight_spaces[weight_elicit_idx], criteria,
                constraint_data_list[weight_elicit_idx],
            )
            
            # Randomly select elicitation for value functions
            vf_elicit_idx = np.random.choice(num_elicitations, p=opinion_weights)
            
            # Evaluate each alternative
            for alt_name, alt_data in alternatives.items():
                score = evaluate_alternative(alt_data, criteria, vf_lists, confidence_lists,
                                            weight_elicit_idx, vf_elicit_idx, sampled_weights, agg_func)
                results[alt_name].append(score)
    
    return results

# ============================================================================
# SAVE RESULTS
# ============================================================================
def save_results(results, alternatives, mc_mode, aggregation_method, output_dir):
    """Save MC results and statistics to CSV files."""
    os.makedirs(output_dir, exist_ok=True)
    
    if mc_mode == "strict":
        # Strict mode: save results for each elicitation separately
        for elicit_idx, elicit_results in results.items():
            scores_file = os.path.join(output_dir, f"scores_{aggregation_method}_elicit_{elicit_idx}.csv")
            stats_file = os.path.join(output_dir, f"statistics_{aggregation_method}_elicit_{elicit_idx}.csv")
            
            # Scores: rows = iterations, columns = alternatives
            alt_names = list(alternatives.keys())
            num_iterations = len(elicit_results[alt_names[0]])
            
            with open(scores_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(alt_names)
                for iteration in range(num_iterations):
                    row = [elicit_results[alt][iteration] for alt in alt_names]
                    writer.writerow(row)
            
            # Statistics
            with open(stats_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Alternative', 'Mean', 'Std', 'Min', 'Max', 'Median'])
                
                for alt in alternatives.keys():
                    scores = np.array(elicit_results[alt])
                    writer.writerow([
                        alt,
                        f"{np.mean(scores):.6f}",
                        f"{np.std(scores):.6f}",
                        f"{np.min(scores):.6f}",
                        f"{np.max(scores):.6f}",
                        f"{np.median(scores):.6f}"
                    ])
            
            print(f"✓ Scores saved to {scores_file}")
            print(f"✓ Statistics saved to {stats_file}")
    
    else:
        # Non-strict mode: save aggregated results
        scores_file = os.path.join(output_dir, f"scores_{aggregation_method}.csv")
        stats_file = os.path.join(output_dir, f"statistics_{aggregation_method}.csv")
        
        # Scores: rows = iterations, columns = alternatives
        alt_names = list(alternatives.keys())
        num_iterations = len(results[alt_names[0]])
        
        with open(scores_file, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(alt_names)
            for iteration in range(num_iterations):
                row = [results[alt][iteration] for alt in alt_names]
                writer.writerow(row)
        
        # Statistics
        with open(stats_file, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Alternative', 'Mean', 'Std', 'Min', 'Max', 'Median'])
            
            for alt in alternatives.keys():
                scores = np.array(results[alt])
                writer.writerow([
                    alt,
                    f"{np.mean(scores):.6f}",
                    f"{np.std(scores):.6f}",
                    f"{np.min(scores):.6f}",
                    f"{np.max(scores):.6f}",
                    f"{np.median(scores):.6f}"
                ])
        
        print(f"✓ Scores saved to {scores_file}")
        print(f"✓ Statistics saved to {stats_file}")

# ============================================================================
# MAIN
# ============================================================================
def main():
    print("="*60)
    print("UP-MAVT: Unified Preference Multi-Attribute Value Theory")
    print("="*60)
    
    # Setup opinion weights if not provided
    global ELICITATION_OPINION_WEIGHTS
    if ELICITATION_OPINION_WEIGHTS is None:
        ELICITATION_OPINION_WEIGHTS = np.ones(len(ELICITATION_CODES)) / len(ELICITATION_CODES)
    else:
        ELICITATION_OPINION_WEIGHTS = np.array(ELICITATION_OPINION_WEIGHTS)
        ELICITATION_OPINION_WEIGHTS = ELICITATION_OPINION_WEIGHTS / ELICITATION_OPINION_WEIGHTS.sum()
    
    # Load inputs for all elicitations
    print("\nLoading elicitation data...")
    vf_lists = []
    confidence_lists = []
    weight_spaces = []
    
    constraint_data_list = []
    
    for code in ELICITATION_CODES:
        vf_file = f"value_functions_{code}.csv"
        ws_file = f"weight_space_output_{code}.csv"
        bwt_file = f"pile_bwt_{code}.csv"
        
        print(f"  - Elicitation {code}:")
        vf_dict, conf_dict = load_value_functions_with_confidence(vf_file)
        print(f"    ✓ Loaded {len(vf_dict)} value functions")
        vf_lists.append(vf_dict)
        confidence_lists.append(conf_dict)
        
        weight_space = load_weight_space(ws_file)
        print(f"    ✓ Loaded weight space for {len(weight_space)} criteria")
        weight_spaces.append(weight_space)
        
        # Build constraint data for rejection sampling
        comparisons = load_comparisons(bwt_file)
        constraint_data = build_constraint_structure(comparisons, vf_dict)
        constraint_data_list.append(constraint_data)
        print(f"    ✓ Built constraint structure")
    
    print("\nLoading alternatives...")
    alternatives, criteria = load_alternatives(ALTERNATIVES_FILE)
    print(f"✓ Loaded {len(alternatives)} alternatives")
    print(f"✓ Criteria: {criteria}")
    
    # Run MC simulation
    print(f"\nRunning Monte Carlo simulation ({MC_ITERATIONS} iterations, mode: {MC_MODE})...")
    print(f"Elicitations: {ELICITATION_CODES}")
    print(f"Opinion weights: {ELICITATION_OPINION_WEIGHTS}")
    
    results = run_monte_carlo(alternatives, criteria, weight_spaces, vf_lists, confidence_lists,
                             constraint_data_list,
                             AGGREGATION_METHOD, ELICITATION_OPINION_WEIGHTS, 
                             MC_ITERATIONS, MC_MODE)
    print(f"✓ Simulation complete")
    
    # Save results
    print("\nSaving results...")
    save_results(results, alternatives, MC_MODE, AGGREGATION_METHOD, OUTPUT_DIR)
    
    # Print summary statistics
    print("\nSummary:")
    print("-" * 60)
    
    if MC_MODE == "strict":
        for elicit_idx, elicit_results in results.items():
            print(f"\nElicitation {ELICITATION_CODES[elicit_idx]}:")
            for alt in alternatives.keys():
                scores = np.array(elicit_results[alt])
                print(f"  {alt:20s} Mean: {np.mean(scores):8.4f}  Std: {np.std(scores):8.4f}  Median: {np.median(scores):8.4f}")
    else:
        for alt in alternatives.keys():
            scores = np.array(results[alt])
            print(f"{alt:20s} Mean: {np.mean(scores):8.4f}  Std: {np.std(scores):8.4f}  Median: {np.median(scores):8.4f}")
    
    print("="*60)

if __name__ == "__main__":
    main()
