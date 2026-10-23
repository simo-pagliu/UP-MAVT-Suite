#!/usr/bin/env python3
"""
The UP-MAVT workflow steps, shared by the web worker and the offline bundle.

worker.py loads session documents from MongoDB and saves the results there; the
offline bundle's main.py loads the same documents from the exported files and
writes CSV files and plots. Both run the computation through these functions,
so a step computes exactly the same thing in either place.
"""

from .session_inputs import (
    build_alternatives_with_qualitative,
    build_comparisons_from_session,
    build_value_functions_from_session,
)
from .upmavt import run_upmavt
from .weight_space_definition import compute_weights


def compute_session_weights(session_doc, criteria, use_non_linear_model=True, phase3_tolerance_pct=1.0,
                            weight_space_parameters=None, print_fn=None):
    """Step 1 for one session: the weight solutions consistent with its answers.

    Parameters
    ----------
    session_doc : dict
        Session document (value functions, qualitative indicators, BWT data).
    criteria : list[dict]
        Criteria of the study's input.
    use_non_linear_model : bool
        Use the non-linear constraint model.
    phase3_tolerance_pct : float
        Phase 3 tolerance, in percent.
    weight_space_parameters : dict or None
        Advanced weight-space parameters (target solutions, restarts, seeds, ...).
    print_fn : callable or None
        Logging function.

    Returns
    -------
    dict
        The metadata dict of weight_space_definition.compute_weights:
        ``accepted_solutions``, ``pre_threshold_decimal_solutions``,
        ``runtime_parameters``, ...
    """
    value_functions = build_value_functions_from_session(session_doc, criteria)
    comparisons = build_comparisons_from_session(session_doc)
    criteria_names = [c['criterion_name'] for c in criteria if 'criterion_name' in c]
    return compute_weights(
        value_functions,
        comparisons,
        criteria_names=criteria_names,
        print_fn=print_fn,
        use_non_linear_model=use_non_linear_model,
        step_c_lim_percent=phase3_tolerance_pct,
        parameter_overrides=weight_space_parameters,
        return_metadata=True,
    )


def run_step(step_number, session_docs, criteria, weight_solutions_list, params, print_fn=print, input_doc=None):
    """Run one Monte Carlo step of the workflow (steps 2-6) and return its results.

    Step 4 runs every method in ``params['aggregation_methods']``; the other
    steps run ``params['aggregation_method']``.

    Parameters
    ----------
    step_number : int
        Workflow step (2-6).
    session_docs : list[dict]
        Session documents, in run order: elicitation i of the results is
        session_docs[i].
    criteria : list[dict]
        Criteria of the study's input.
    weight_solutions_list : list[list[dict]]
        Step 1 weight solutions of each session, aligned with session_docs.
    params : dict
        mc_iterations, aggregation_method, aggregation_alpha,
        aggregation_methods, aggregation_alphas, mc_mode, use_random_weights,
        opinion_weights.
    print_fn : callable
        Logging function.
    input_doc : dict or None
        The input document the alternatives are read from; defaults to
        ``{'criteria': criteria}``.

    Returns
    -------
    dict
        The step's results document, as the web app stores it.
    """
    mc_iterations = params.get('mc_iterations', 1000)
    aggregation_method = params.get('aggregation_method', 'weighted_sum')
    aggregation_alpha = params.get('aggregation_alpha', 0.0)
    aggregation_methods = params.get('aggregation_methods', None)
    aggregation_alphas = params.get('aggregation_alphas', None)
    mc_mode = params.get('mc_mode', 'non_strict')
    use_random_weights = params.get('use_random_weights', False)
    opinion_weights = params.get('opinion_weights', None)

    print_fn("\nPreparing data for UP-MAVT analysis...")
    vf_lists = []
    confidence_lists = []
    for i, session_doc in enumerate(session_docs):
        vf_dict, conf_dict = build_value_functions_from_session(
            session_doc, criteria, return_confidence=True
        )
        vf_lists.append(vf_dict)
        confidence_lists.append(conf_dict)
        print_fn(f"  ✓ Elicitation {i + 1}: {len(vf_dict)} value functions")

    # Each session gets its own decision matrix: its qualitative indicator values
    # (with the practitioner's confidence adjustments) fill the qualitative columns.
    alternatives_list = []
    criteria_names = []
    for session_doc in session_docs:
        alternatives, criteria_names = build_alternatives_with_qualitative(
            input_doc if input_doc else {'criteria': criteria},
            session_doc.get('qualitative_indicators'),
            session_doc.get('practitioner_settings'),
        )
        alternatives_list.append(alternatives)
    alternatives = alternatives_list[0] if alternatives_list else {}

    print_fn(f"  ✓ Loaded {len(alternatives)} alternatives")
    print_fn(f"  ✓ Criteria: {criteria_names}")

    if step_number == 4:
        if isinstance(aggregation_methods, list) and aggregation_methods:
            methods_to_run = [str(m) for m in aggregation_methods]
        else:
            methods_to_run = [aggregation_method]
        alpha_map = aggregation_alphas if isinstance(aggregation_alphas, dict) else {}
        print_fn(f"\nStep 4: Running {len(methods_to_run)} selected aggregation method(s)...")
        results_by_aggregation = {}
        for idx, method in enumerate(methods_to_run):
            method_alpha = alpha_map.get(method, aggregation_alpha)
            print_fn(f"\n--- Aggregation method {idx + 1}/{len(methods_to_run)}: {method} (alpha={method_alpha}) ---")
            step_params = {
                'mc_iterations': mc_iterations,
                'aggregation_method': method,
                'aggregation_alpha': method_alpha,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'opinion_weights': opinion_weights,
            }
            results_by_aggregation[method] = run_upmavt(
                vf_lists, confidence_lists, weight_solutions_list,
                alternatives_list, criteria_names,
                step_params,
                print_fn=print_fn
            )

        return {
            'mc_iterations': mc_iterations,
            'aggregation_method': methods_to_run[0] if methods_to_run else aggregation_method,
            'aggregation_alpha': alpha_map.get(methods_to_run[0], aggregation_alpha) if methods_to_run else aggregation_alpha,
            'aggregation_methods': methods_to_run,
            'aggregation_alphas': alpha_map,
            'mc_mode': mc_mode,
            'use_random_weights': use_random_weights,
            'results_by_aggregation': results_by_aggregation,
        }

    step_params = {
        'mc_iterations': mc_iterations,
        'aggregation_method': aggregation_method,
        'aggregation_alpha': aggregation_alpha,
        'mc_mode': mc_mode,
        'use_random_weights': use_random_weights,
        'opinion_weights': opinion_weights,
    }
    formatted = run_upmavt(
        vf_lists, confidence_lists, weight_solutions_list,
        alternatives_list, criteria_names,
        step_params,
        print_fn=print_fn
    )
    result_doc = formatted.copy()
    result_doc.update({
        'mc_iterations': mc_iterations,
        'aggregation_method': aggregation_method,
        'aggregation_alpha': aggregation_alpha,
        'mc_mode': mc_mode,
        'use_random_weights': use_random_weights,
    })
    return result_doc
