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
    constraint_func as ws_constraint_func,
    load_comparisons_from_db,
    build_constraint_structure,
)


# ============================================================================
# LOAD VALUE FUNCTIONS AND CONFIDENCE FROM DB
# ============================================================================
def load_value_functions_with_confidence_from_db(criteria, value_functions_data, qualitative_indicators=None):
    """Load value functions and confidence levels from DB session data.

    For quantitative criteria: interpolation function + single confidence level.
    For qualitative criteria: per-rank confidences dict (rank -> confidence), no VF needed.

    Parameters
    ----------
    criteria : list[dict]
        Criteria from the input document.
    value_functions_data : dict
        The ``value_functions`` field from the session document.
    qualitative_indicators : dict or None
        The ``qualitative_indicators`` field from the session document.

    Returns
    -------
    tuple(dict, dict)
        (vf_dict, confidence_dict) where:
        - For quantitative: vf_dict[name] -> interp1d, confidence_dict[name] -> int
        - For qualitative: vf_dict[name] -> None, confidence_dict[name] -> dict {rank -> int}
    """
    vf_dict = {}
    confidence_dict = {}
    criteria_map = value_functions_data.get('criteria', {}) if isinstance(value_functions_data, dict) else {}

    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        name = criterion.get('criterion_name')
        if not name:
            continue

        if criterion.get('is_qualitative'):
            # For qualitative: keep per-rank confidences dict
            qual_data = qualitative_indicators[name]
            confidences_dict = qual_data['confidences']
            # Convert keys to int for consistency
            confidence_dict[name] = {int(k) if k.isdigit() else k: int(v) 
                                     for k, v in confidences_dict.items()}
            vf_dict[name] = None  # No VF needed for qualitative
        else:
            # For quantitative: traditional VF + single confidence
            cfg = criteria_map[name]
            points = cfg['points']
            confidence = cfg['confidence']

            x_vals = [float(p['x']) for p in points if 'x' in p and 'y' in p]
            y_vals = [float(p['y']) for p in points if 'x' in p and 'y' in p]

            interp_func = interp1d(x_vals, y_vals, kind='linear',
                                   fill_value=(0, 1), bounds_error=False)
            vf_dict[name] = interp_func
            confidence_dict[name] = int(confidence)

    return vf_dict, confidence_dict



# ============================================================================
# WEIGHT SAMPLER (rejection sampling with constraint enforcement)
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
# LOAD ALTERNATIVES FROM DB
# ============================================================================
def load_alternatives_from_db(criteria):
    """Build alternatives dict from the criteria stored in the DB input.

    The input criteria list has the structure:
    [
      {
        "criterion_name": "Capital Investment Budgeted",
        "unit": "EUR",
        "group": "Economic",
        "alternatives": [
          {"name": "Nuclear", "value": "N(8000, 1000)"},
          {"name": "Solar", "value": "N(5000, 500)"},
          ...
        ]
      },
      ...
    ]

    Returns
    -------
    tuple(dict, list)
        alternatives: {alt_name: {crit_name: value_string, ...}, ...}
        criteria_names: [crit_name, ...]
    """
    alternatives = {}
    criteria_names = []

    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        crit_name = criterion.get('criterion_name')
        if not crit_name:
            continue
        criteria_names.append(crit_name)

        for alt in criterion.get('alternatives', []):
            if not isinstance(alt, dict):
                continue
            alt_name = alt.get('name', '')
            if not alt_name:
                continue
            if alt_name not in alternatives:
                alternatives[alt_name] = {}

            value = alt.get('value', '')

            # For qualitative criteria, use normalized x position
            if criterion.get('is_qualitative'):
                value = _get_qualitative_x_value_for_alt(criterion, alt_name)

            alternatives[alt_name][crit_name] = str(value) if value is not None else ''

    return alternatives, criteria_names


def _get_qualitative_x_value_for_alt(criterion, alt_name):
    """Placeholder - qualitative x values need to come from qualitative_indicators.

    This is handled later when we have access to qualitative_indicators.
    """
    return ''


def load_alternatives_from_db_with_qualitative(criteria, qualitative_indicators):
    """Build alternatives dict, substituting qualitative values with their x-positions.

    Parameters
    ----------
    criteria : list[dict]
        Criteria from the input document.
    qualitative_indicators : dict or None
        Qualitative indicators from the session.

    Returns
    -------
    tuple(dict, list)
        alternatives dict and criteria_names list.
    """
    alternatives = {}
    criteria_names = []

    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        crit_name = criterion.get('criterion_name')
        if not crit_name:
            continue
        criteria_names.append(crit_name)

        for alt in criterion.get('alternatives', []):
            if not isinstance(alt, dict):
                continue
            alt_name = alt.get('name', '')
            if not alt_name:
                continue
            if alt_name not in alternatives:
                alternatives[alt_name] = {}

            if criterion.get('is_qualitative'):
                # Use x-position from qualitative ranking
                value = _get_qualitative_x_value(qualitative_indicators, crit_name, alt_name)
            else:
                value = alt.get('value', '')

            alternatives[alt_name][crit_name] = str(value) if value is not None else ''

    return alternatives, criteria_names


def _get_qualitative_x_value(qualitative_indicators, criterion_name, alt_name):
    """Get the normalized X value for a qualitative alternative."""
    if not isinstance(qualitative_indicators, dict):
        return ''
    data = qualitative_indicators.get(criterion_name)
    if not isinstance(data, dict):
        return ''
    ranking = data.get('ranking')
    if not isinstance(ranking, dict):
        return ''

    rank = ranking.get(alt_name)
    if rank is None:
        return ''

    unique_ranks = sorted(set(ranking.values()))
    if len(unique_ranks) == 0:
        return ''

    total_points = len(unique_ranks) + 2
    rank_list = list(reversed(unique_ranks))
    if rank not in rank_list:
        return ''

    idx = rank_list.index(rank)
    x_pos = idx + 1
    x_normalized = x_pos / (total_points - 1)
    return x_normalized


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
    except Exception:
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
def evaluate_alternative(alt_name, alt_data, criteria, vf_lists, confidence_lists,
                         weight_elicit_idx, vf_elicit_idx, sampled_weights,
                         aggregation_func, qualitative_indicators=None):
    """Evaluate single alternative using MAVT.
    
    For quantitative criteria: sample raw value -> apply VF -> add confidence error
    For qualitative criteria: use normalized x position -> add confidence error per rank
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
            raw_value = sample_from_distribution(alt_data[crit])

            vf = vf_lists[vf_elicit_idx].get(crit)
            confidence_info = confidence_lists[vf_elicit_idx].get(crit)
            
            if vf is None and isinstance(confidence_info, dict):
                # Qualitative criterion: use normalized position with per-rank confidence
                normalized_value = float(raw_value)  # raw_value is already x_normalized
                
                # Get the rank for this alternative from qualitative_indicators
                qi_info = qualitative_indicators[crit]
                ranking = qi_info['ranking']
                rank = ranking[alt_name]
                # Get confidence for this rank from confidence_info dict
                confidence = confidence_info[rank]
                
                # Apply confidence error margin
                error_pct = confidence_errors[confidence]
                if error_pct > 0:
                    error_margin = normalized_value * error_pct
                    normalized_value = np.random.uniform(
                        normalized_value - error_margin,
                        normalized_value + error_margin
                    )
                    normalized_value = np.clip(normalized_value, 0.0, 1.0)
            elif vf is not None and isinstance(confidence_info, int):
                # Quantitative criterion: traditional VF + single confidence
                normalized_value = float(vf(raw_value))
                confidence = confidence_info
                
                error_pct = confidence_errors[confidence]
                if error_pct > 0:
                    error_margin = normalized_value * error_pct
                    normalized_value = np.random.uniform(
                        normalized_value - error_margin,
                        normalized_value + error_margin
                    )
                    normalized_value = np.clip(normalized_value, 0.0, 1.0)
            else:
                continue

            w = sampled_weights.get(crit, 1.0 / len(criteria))
            intermediate_results.append((w, normalized_value))

    score = aggregation_func(intermediate_results)
    return score


# ============================================================================
# MONTE CARLO SIMULATION
# ============================================================================
def run_monte_carlo(alternatives, criteria, weight_spaces, vf_lists,
                    confidence_lists, constraint_data_list, aggregation_method,
                    opinion_weights, num_iterations, mc_mode, use_random_weights=False,
                    qualitative_indicators=None, print_fn=None):
    """Run MC simulation.

    Parameters
    ----------
    weight_spaces : list[dict]
        One weight space dict per elicitation.
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

    num_elicitations = len(weight_spaces)
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
                    weight_spaces[elicit_idx], criteria,
                    constraint_data_list[elicit_idx],
                    use_random_weights=use_random_weights
                )
                for alt_name, alt_data in alternatives.items():
                    score = evaluate_alternative(
                        alt_name, alt_data, criteria, vf_lists, confidence_lists,
                        elicit_idx, elicit_idx, sampled_weights, agg_func,
                        qualitative_indicators=qualitative_indicators
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
                weight_spaces[weight_elicit_idx], criteria,
                constraint_data_list[weight_elicit_idx],
                use_random_weights=use_random_weights
            )
            vf_elicit_idx = np.random.choice(num_elicitations, p=opinion_weights)

            for alt_name, alt_data in alternatives.items():
                score = evaluate_alternative(
                    alt_name, alt_data, criteria, vf_lists, confidence_lists,
                    weight_elicit_idx, vf_elicit_idx, sampled_weights, agg_func,
                    qualitative_indicators=qualitative_indicators
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
def run_upmavt(session_docs, criteria, computed_weights, params, print_fn=None):
    """Run UP-MAVT simulation.

    Parameters
    ----------
    session_docs : list[dict]
        List of elicitation session documents (one per selected session).
    criteria : list[dict]
        Criteria from the study input document.
    computed_weights : dict
        The computed_weights document containing weight_spaces keyed by session ID.
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

    num_elicitations = len(session_docs)

    if opinion_weights_raw is None:
        opinion_weights = np.ones(num_elicitations) / num_elicitations
    else:
        opinion_weights = np.array(opinion_weights_raw)
        opinion_weights = opinion_weights / opinion_weights.sum()

    print_fn("=" * 60)
    print_fn("UP-MAVT: Uncertainty Propagated Multi-Attribute Value Theory")
    print_fn("=" * 60)

    # Load data for each elicitation
    print_fn("\nLoading elicitation data...")
    vf_lists = []
    confidence_lists = []
    weight_spaces_list = []
    constraint_data_list = []

    weight_spaces_data = computed_weights.get('weight_spaces', {})

    for i, session_doc in enumerate(session_docs):
        session_id = str(session_doc.get('_id', session_doc.get('session_id', i)))
        session_name = session_doc.get('name', session_id)
        print_fn(f"  - Elicitation {session_name} (ID: {session_id}):")

        value_functions_data = session_doc.get('value_functions')
        qualitative_indicators = session_doc.get('qualitative_indicators')

        vf_dict, conf_dict = load_value_functions_with_confidence_from_db(
            criteria, value_functions_data, qualitative_indicators
        )
        print_fn(f"    ✓ Loaded {len(vf_dict)} value functions")
        vf_lists.append(vf_dict)
        confidence_lists.append(conf_dict)

        # Get weight space for this session
        ws = weight_spaces_data.get(session_id, {})
        if not ws:
            print_fn(f"    ⚠ No weight space found for session {session_id}")
        else:
            print_fn(f"    ✓ Loaded weight space for {len(ws)} criteria")
        weight_spaces_list.append(ws)
        
        # Build constraint data from BWT comparisons
        bwt_data = session_doc.get('bwt')
        comparisons = load_comparisons_from_db(bwt_data) if bwt_data else []
        if comparisons:
            constraint_data = build_constraint_structure(comparisons, vf_dict)
            print_fn(f"    ✓ Built constraint structure with {len(comparisons)} comparisons")
            constraint_data_list.append(constraint_data)
        else:
            print_fn(f"    ⚠ No BWT comparisons found, using empty constraints")
            # Create minimal constraint structure (no comparisons, just criteria)
            constraint_data = {
                'criteria': constraint_data_list[-1]['criteria'] if constraint_data_list else list(vf_dict.keys()),
                'criterion_to_index': {c: i for i, c in enumerate(list(vf_dict.keys()))},
                'comparisons': [],
                'value_functions': vf_dict
            }
            constraint_data_list.append(constraint_data)

    # Load alternatives (same for all elicitations since they share input)
    print_fn("\nLoading alternatives...")
    # Use first session for qualitative indicators (they should be the same structure)
    first_qi = session_docs[0].get('qualitative_indicators') if session_docs else None
    alternatives, criteria_names = load_alternatives_from_db_with_qualitative(criteria, first_qi)
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

    # Gather all qualitative indicators for access during MC
    all_qi = {}
    for session_doc in session_docs:
        qi = session_doc.get('qualitative_indicators')
        if qi:
            all_qi.update(qi)
    
    results = run_monte_carlo(
        alternatives, criteria_names, weight_spaces_list, vf_lists,
        confidence_lists, constraint_data_list, aggregation_method,
        opinion_weights, mc_iterations, mc_mode, use_random_weights=use_random_weights,
        qualitative_indicators=all_qi if all_qi else None, print_fn=print_fn,
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
            session_name = session_docs[int(elicit_idx_str)].get('name', elicit_idx_str)
            print_fn(f"\nElicitation {session_name}:")
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
