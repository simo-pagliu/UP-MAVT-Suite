#!/usr/bin/env python3
"""
UP-MAVT: Uncertainty Propagated - Multi Attribute Value Theory (DB version)
Reads all data from MongoDB, runs Monte Carlo simulations, saves results to DB.

Simone Pagliuca, 2025-2026
"""

import numpy as np
from scipy.interpolate import interp1d
import sys
from .weight_space_definition import (
    build_constraint_structure,
)


# ============================================================================
# LOAD VALUE FUNCTIONS AND CONFIDENCE FROM DB
# ============================================================================
# ============================================================================
# WEIGHT SAMPLER (direct sampling from precomputed feasible solutions)
# ============================================================================
def weight_sampler(weight_solutions, criteria, constraint_data=None, use_random_weights=False):
    """Sample a random set of weights.

    Uses direct sampling from precomputed feasible solutions.
    If ``use_random_weights`` is True, falls back to unconstrained
    Dirichlet sampling.

    Parameters
    ----------
    weight_solutions : list[dict]
        List of feasible solutions, each mapping criterion_name -> weight.
    criteria : list[str]
        List of criterion names.
    constraint_data : dict or None
        Unused here (kept for backward compatibility of call sites).
    use_random_weights : bool
        If True, generate weights from a Dirichlet distribution instead
        of sampling from precomputed solutions.

    Returns
    -------
    dict
        Mapping criterion_name -> sampled weight.
    """
    if use_random_weights and (not isinstance(weight_solutions, list) or len(weight_solutions) == 0):
        # Dirichlet distribution: uniform random weights
        n = len(criteria)
        raw = np.random.dirichlet(np.ones(n))
        return {crit: raw[i] for i, crit in enumerate(criteria)}

    if not isinstance(weight_solutions, list) or len(weight_solutions) == 0:
        raise ValueError("No precomputed weight solutions available")
    selected = weight_solutions[np.random.randint(len(weight_solutions))]
    if not isinstance(selected, dict):
        raise ValueError("Selected weight solution is not a valid mapping")

    return {crit: float(selected[crit]) for crit in criteria}


# ============================================================================
# PARSE DISTRIBUTION STRINGS
# ============================================================================
def sample_from_distribution(dist_str):
    """Parse and sample from distribution string."""
    dist_str = str(dist_str).strip()

    # Deterministic value
    try:
        return float(dist_str)
    except Exception:
        pass

    # Normal distribution: N(mu, sigma)
    if dist_str.startswith('N('):
        parts = dist_str[2:-1].split(',')
        mu, sigma = float(parts[0].strip()), float(parts[1].strip())
        return np.random.normal(mu, sigma)

    # Uniform distribution: U(a, b)
    if dist_str.startswith('U('):
        parts = dist_str[2:-1].split(',')
        a, b = float(parts[0].strip()), float(parts[1].strip())
        return np.random.uniform(a, b)

    # Triangular distribution: TRI(a, b, c)
    if dist_str.startswith('TRI('):
        parts = dist_str[4:-1].split(',')
        if len(parts) >= 3:
            a, b, c = float(parts[0].strip()), float(parts[1].strip()), float(parts[2].strip())
            return np.random.triangular(a, b, c)

    # Percentage or absolute margin: 50 ± 5% or 50 ± 5
    if '±' in dist_str:
        parts = dist_str.split('±')
        base = float(parts[0].strip())
        margin_str = parts[1].strip()
        if '%' in margin_str:
            pct = float(margin_str.rstrip('%'))
            margin = base * (pct / 100)
        else:
            margin = float(margin_str)
        return np.random.uniform(base - margin, base + margin)

    # Trapezoidal: TRAP(a, b, c, d[, min_prob])
    if dist_str.startswith('TRAP('):
        parts = dist_str[5:-1].split(',')
        if len(parts) >= 4:
            a, b, c, d = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])
            min_prob = float(parts[4]) if len(parts) >= 5 else 0.0
            max_prob = 1.0
            while True:
                x = np.random.uniform(a, d)
                if x < b:
                    pdf_val = min_prob + (max_prob - min_prob) * (x - a) / (b - a)
                elif x < c:
                    pdf_val = max_prob
                else:
                    pdf_val = max_prob - (max_prob - min_prob) * (x - c) / (d - c)
                if np.random.uniform(0, max_prob) < pdf_val:
                    return x
        elif len(parts) >= 3:
            a, b, c = float(parts[0]), float(parts[1]), float(parts[2])
            return np.random.triangular(a, b, c)

    # Custom_1 distribution: CUSTOM_1({a1, a2, ...}, x_low, x_high)
    if dist_str.startswith('CUSTOM_1('):
        inner = dist_str[9:-1]  # strip CUSTOM_1( and )
        # Parse {a_values}, x_low, x_high
        brace_end = inner.index('}')
        a_str = inner[1:brace_end]  # inside braces
        a_possible = [float(v.strip()) for v in a_str.split(',')]
        rest = inner[brace_end+1:].strip().lstrip(',')
        parts = rest.split(',')
        x_low = float(parts[0].strip())
        x_high = float(parts[1].strip())
        x = np.random.uniform(x_low, x_high)
        a = np.random.choice(a_possible)
        prob_0 = a * (1 - x)
        prob_1 = a * x + (1 - a) * (1 - x)
        prob_2 = (1 - a) * x
        sample = np.random.choice([0, 1, 2], p=[prob_0, prob_1, prob_2])
        return float(sample)

    # Discrete distribution: {N, N2, N3, ...}
    if dist_str.startswith('{') and dist_str.endswith('}'):
        values_str = dist_str[1:-1]
        values = [float(v.strip()) for v in values_str.split(',')]
        return np.random.choice(values)

    # Fallback
    try:
        return float(dist_str.replace('{', '').replace('}', ''))
    except Exception as exc:
        raise ValueError(f"Unsupported or invalid distribution format: {dist_str}") from exc


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
    return 0.001  # Avoid zero


# ============================================================================
# EVALUATION FUNCTION
# ============================================================================
def evaluate_alternative(alt_name, alt_data, criteria, vf_lists, confidence_lists,
                         weight_elicit_idx, vf_elicit_idx, sampled_weights,
                         aggregation_func):
    """Evaluate single alternative using MAVT.
    
    Sample from alternative value distribution -> apply VF -> apply confidence error
    
    For qualitative criteria: uncertainty is already encoded in alternative values (x ± error%),
    and VF is identity (y=x) with confidence=4 (no additional error).
    """
    confidence_errors = {
        0: 0.10,
        1: 0.075,
        2: 0.05,
        3: 0.025,
        4: 0.0,
    }

    intermediate_results = []

    for crit in criteria:
        if crit in alt_data:
            # Sample from distribution (handles both deterministic values and distributions)
            raw_value = sample_from_distribution(alt_data[crit])

            vf = vf_lists[vf_elicit_idx].get(crit)
            confidence = confidence_lists[vf_elicit_idx].get(crit, 4)
            
            # Apply value function
            normalized_value = float(vf(raw_value))
            
            # Apply confidence error margin
            error_pct = confidence_errors.get(confidence, 0.0)
            if error_pct > 0:
                error_margin = normalized_value * error_pct
                normalized_value = np.random.uniform(
                    normalized_value - error_margin,
                    normalized_value + error_margin
                )
            normalized_value = np.clip(normalized_value, 0.001, 1.0)

            if crit not in sampled_weights:
                raise KeyError(f"Missing weight for criterion '{crit}' in sampled_weights")
            w = float(sampled_weights[crit])
            intermediate_results.append((w, normalized_value))

    score = aggregation_func(intermediate_results)
    return score


# ============================================================================
# MONTE CARLO SIMULATION
# ============================================================================
def run_monte_carlo(alternatives, criteria, weight_solutions_list, vf_lists,
                    confidence_lists, constraint_data_list, aggregation_method,
                    opinion_weights, num_iterations, mc_mode, use_random_weights=False,
                    print_fn=None):
    """Run MC simulation.

    Parameters
    ----------
    weight_solutions_list : list[list[dict]]
        One feasible weight solutions list per elicitation.
    vf_lists : list[dict]
        One value function dict per elicitation.
    confidence_lists : list[dict]
        One confidence dict per elicitation.
    constraint_data_list : list[dict]
        One constraint data dict per elicitation.
    opinion_weights : np.ndarray
        Weights for selecting elicitations in non-strict mode.
    mc_mode : str
        "strict" or "non_strict".
    use_random_weights : bool
        If True, use Dirichlet distribution for weights.
    print_fn : callable or None
        Logging function.

    Returns
    -------
    dict
        Results structure depending on mc_mode.
    """
    if print_fn is None:
        print_fn = print

    agg_funcs = {
        'weighted_sum': weighted_sum,
        'geometric_mean': geometric_mean,
        'harmonic_mean': harmonic_mean,
    }
    agg_func = agg_funcs.get(aggregation_method, weighted_sum)

    num_elicitations = len(weight_solutions_list)
    results = {}

    if mc_mode == "strict":
        for elicit_idx in range(num_elicitations):
            results[elicit_idx] = {alt_name: [] for alt_name in alternatives.keys()}

        for iteration in range(num_iterations):
            if iteration % 100 == 0:
                print_fn(f"  Iteration {iteration}/{num_iterations}")
                sys.stdout.flush()
            for elicit_idx in range(num_elicitations):
                sampled_weights = weight_sampler(
                    weight_solutions_list[elicit_idx], criteria,
                    constraint_data_list[elicit_idx],
                    use_random_weights=use_random_weights
                )
                for alt_name, alt_data in alternatives.items():
                    score = evaluate_alternative(
                        alt_name, alt_data, criteria, vf_lists, confidence_lists,
                        elicit_idx, elicit_idx, sampled_weights, agg_func
                    )
                    results[elicit_idx][alt_name].append(score)
    else:
        # Non-strict mode
        results = {alt_name: [] for alt_name in alternatives.keys()}

        for iteration in range(num_iterations):
            if iteration % 100 == 0:
                print_fn(f"  Iteration {iteration}/{num_iterations}")
                sys.stdout.flush()
            weight_elicit_idx = np.random.choice(num_elicitations, p=opinion_weights)
            sampled_weights = weight_sampler(
                weight_solutions_list[weight_elicit_idx], criteria,
                constraint_data_list[weight_elicit_idx],
                use_random_weights=use_random_weights
            )
            vf_elicit_idx = np.random.choice(num_elicitations, p=opinion_weights)

            for alt_name, alt_data in alternatives.items():
                score = evaluate_alternative(
                    alt_name, alt_data, criteria, vf_lists, confidence_lists,
                    weight_elicit_idx, vf_elicit_idx, sampled_weights, agg_func
                )
                results[alt_name].append(score)

    return results


# ============================================================================
# FORMAT RESULTS FOR DB
# ============================================================================
def format_results_for_db(results, alternatives, mc_mode):
    """Convert results to a DB-friendly structure.

    Returns
    -------
    dict
        For strict mode: {"results_by_elicitation": {elicit_idx_str: [[row], ...]}}
        For non-strict mode: {"aggregated_results": [[row], ...]}
        Each row is a list of scores in alternative order.
    """
    alt_names = list(alternatives.keys())

    if mc_mode == "strict":
        results_by_elicitation = {}
        for elicit_idx, elicit_results in results.items():
            num_iterations = len(elicit_results[alt_names[0]])
            rows = []
            for i in range(num_iterations):
                row = [round(float(elicit_results[alt][i]), 6) for alt in alt_names]
                rows.append(row)
            results_by_elicitation[str(elicit_idx)] = rows
        return {
            'alternative_names': alt_names,
            'results_by_elicitation': results_by_elicitation,
        }
    else:
        num_iterations = len(results[alt_names[0]])
        rows = []
        for i in range(num_iterations):
            row = [round(float(results[alt][i]), 6) for alt in alt_names]
            rows.append(row)
        return {
            'alternative_names': alt_names,
            'aggregated_results': rows,
        }


# ============================================================================
# MAIN ENTRY POINT (called by the worker)
# ============================================================================
def run_upmavt(vf_lists, confidence_lists, weight_solutions_list, alternatives, 
               criteria_names, params, print_fn=None):
    """Run UP-MAVT simulation.

    Parameters
    ----------
    vf_lists : list[dict]
        List of value function dicts (one per elicitation), mapping criterion_name -> interp1d.
    confidence_lists : list[dict]
        List of confidence dicts (one per elicitation), mapping criterion_name -> confidence_int.
    weight_solutions_list : list[list]
        List of weight solution lists (one per elicitation).
    alternatives : dict
        Alternatives mapping: {alt_name: {criterion_name: value, ...}, ...}
    criteria_names : list[str]
        List of criterion names.
    params : dict
        Parameters:
        - mc_iterations: int
        - aggregation_method: str ("weighted_sum", "geometric_mean", "harmonic_mean")
        - mc_mode: str ("strict" or "non_strict")
        - use_random_weights: bool
        - opinion_weights: list or None
    print_fn : callable or None
        Logging function.

    Returns
    -------
    dict
        Formatted results for DB storage.
    """
    if print_fn is None:
        print_fn = print

    mc_iterations = params.get('mc_iterations', 1000)
    aggregation_method = params.get('aggregation_method', 'weighted_sum')
    mc_mode = params.get('mc_mode', 'non_strict')
    use_random_weights = params.get('use_random_weights', False)
    opinion_weights_raw = params.get('opinion_weights', None)

    num_elicitations = len(vf_lists)

    if opinion_weights_raw is None:
        opinion_weights = np.ones(num_elicitations) / num_elicitations
    else:
        opinion_weights = np.array(opinion_weights_raw)
        opinion_weights = opinion_weights / opinion_weights.sum()

    print_fn("=" * 60)
    print_fn("UP-MAVT: Uncertainty Propagated Multi-Attribute Value Theory")
    print_fn("=" * 60)

    print_fn(f"\n✓ Loaded {num_elicitations} elicitations")
    for i, vf_dict in enumerate(vf_lists):
        print_fn(f"  - Elicitation {i+1}: {len(vf_dict)} value functions")
    
    print_fn(f"✓ Loaded {len(alternatives)} alternatives")
    print_fn(f"✓ Criteria: {criteria_names}")

    # Run MC simulation
    print_fn(f"\nRunning Monte Carlo simulation...")
    print_fn(f"  Iterations: {mc_iterations}")
    print_fn(f"  Mode: {mc_mode}")
    print_fn(f"  Aggregation: {aggregation_method}")
    print_fn(f"  Random weights: {use_random_weights}")
    print_fn(f"  Elicitations: {num_elicitations}")
    print_fn(f"  Opinion weights: {opinion_weights.tolist()}")
    sys.stdout.flush()

    # Build constraint data for each elicitation
    print_fn("\nBuilding constraint structures...")
    constraint_data_list = []
    for i, vf_dict in enumerate(vf_lists):
        # Create constraint structure with criteria and value functions
        constraint_data = {
            'criteria': list(vf_dict.keys()),
            'criterion_to_index': {c: j for j, c in enumerate(vf_dict.keys())},
            'comparisons': [],
            'value_functions': vf_dict
        }
        constraint_data_list.append(constraint_data)
        print_fn(f"  - Elicitation {i+1}: {len(vf_dict)} value functions")
    
    results = run_monte_carlo(
        alternatives, criteria_names, weight_solutions_list, vf_lists,
        confidence_lists, constraint_data_list, aggregation_method,
        opinion_weights, mc_iterations, mc_mode, use_random_weights=use_random_weights,
        print_fn=print_fn,
    )
    print_fn("✓ Simulation complete")

    # Format for DB
    formatted = format_results_for_db(results, alternatives, mc_mode)
    formatted['mc_iterations'] = mc_iterations
    formatted['aggregation_method'] = aggregation_method
    formatted['mc_mode'] = mc_mode
    formatted['use_random_weights'] = use_random_weights

    # Print summary
    print_fn("\nSummary:")
    print_fn("-" * 60)
    alt_names = list(alternatives.keys())

    if mc_mode == "strict":
        for elicit_idx_str, rows in formatted.get('results_by_elicitation', {}).items():
            print_fn(f"\nElicitation {int(elicit_idx_str) + 1}:")
            scores_array = np.array(rows)
            for j, alt in enumerate(alt_names):
                col = scores_array[:, j]
                print_fn(f"  {alt:20s} Mean: {np.mean(col):8.4f}  Std: {np.std(col):8.4f}  Median: {np.median(col):8.4f}")
    else:
        rows = formatted.get('aggregated_results', [])
        scores_array = np.array(rows)
        for j, alt in enumerate(alt_names):
            col = scores_array[:, j]
            print_fn(f"{alt:20s} Mean: {np.mean(col):8.4f}  Std: {np.std(col):8.4f}  Median: {np.median(col):8.4f}")

    print_fn("=" * 60)

    return formatted
