#!/usr/bin/env python3
"""
Build UP-MAVT engine inputs from elicitation session data.

These helpers turn session-shaped dictionaries (value functions, qualitative
indicators, BWT comparisons, practitioner settings) into the structures that
weight_space_definition.compute_weights and upmavt.run_upmavt expect.

They have no database dependency, so the same code serves the web worker
(scripts/load_DB.py reads the session documents from MongoDB) and the offline
export bundle (load_LOCAL.py reads the same data from CSV/JSON files). Keeping a
single implementation keeps offline results identical to the web app's.
"""

import math
from bisect import bisect_right


def _build_piecewise_linear_function(points):
    """Build a piecewise-linear function with endpoint clamping.

    Interpolates only between the two neighboring points that bracket x.
    """
    parsed_points = []
    for point in points:
        if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
            continue
        parsed_points.append((float(point['x']), float(point['y'])))

    if len(parsed_points) < 2:
        return None

    sorted_points = sorted(parsed_points, key=lambda pair: pair[0])
    x_values = [pair[0] for pair in sorted_points]
    y_values = [pair[1] for pair in sorted_points]

    def piecewise_function(raw_x):
        x_value = float(raw_x)

        if x_value <= x_values[0]:
            return y_values[0]
        if x_value >= x_values[-1]:
            return y_values[-1]

        left_index = bisect_right(x_values, x_value) - 1
        right_index = left_index + 1

        x_left = x_values[left_index]
        y_left = y_values[left_index]
        x_right = x_values[right_index]
        y_right = y_values[right_index]

        if x_right == x_left:
            return y_right

        interpolation_ratio = (x_value - x_left) / (x_right - x_left)
        return y_left + interpolation_ratio * (y_right - y_left)

    return piecewise_function


def build_value_functions_from_session(session_doc, criteria, return_confidence=False):
    """Build value function dicts from session data.
    
    Parameters
    ----------
    session_doc : dict
        Session document with value_functions and qualitative_indicators fields.
    criteria : list[dict]
        Criteria list from input document.
    return_confidence : bool
        If True, also return confidence dict.
    
    Returns
    -------
    dict or tuple
        If return_confidence=False:
            Mapping criterion_name -> piecewise-linear callable
        If return_confidence=True:
            (vf_dict, confidence_dict)
    """
    vf_dict = {}
    confidence_dict = {}

    value_functions_data = session_doc.get('value_functions', {})
    qualitative_indicators = session_doc.get('qualitative_indicators')
    practitioner_settings = session_doc.get('practitioner_settings')
    confidence_adjustments = {}
    if isinstance(practitioner_settings, dict):
        confidence_adjustments = practitioner_settings.get('confidence_adjustments', {})
    if not isinstance(confidence_adjustments, dict):
        confidence_adjustments = {}
    overall_adjustment = _normalize_confidence_adjustment(confidence_adjustments.get('overall'))
    vf_group_adjustment = _normalize_confidence_adjustment(confidence_adjustments.get('vf'))
    vf_criteria_adjustments = confidence_adjustments.get('vf_criteria', {})
    if not isinstance(vf_criteria_adjustments, dict):
        vf_criteria_adjustments = {}

    criteria_map = value_functions_data.get('criteria', {}) if isinstance(value_functions_data, dict) else {}
    
    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        name = criterion.get('criterion_name')
        if not name:
            continue
        
        points = []
        
        if criterion.get('is_qualitative'):
            # For weight computation and UP-MAVT, qualitative criteria use identity function: vf(x) = x
            # The uncertainty is encoded in the alternative values themselves (x ± error%)
            # So the VF has no error: confidence = 4
            points = [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}]
            if return_confidence:
                confidence_dict[name] = 4  # No error in VF, uncertainty is in alternative values
        else:
            # Quantitative criterion
            cfg = criteria_map.get(name, {})
            if isinstance(cfg, dict):
                points = cfg.get('points', [])
            if return_confidence:
                confidence = cfg.get('confidence', 4) if isinstance(cfg, dict) else 4
                criterion_adjustment = _normalize_confidence_adjustment(vf_criteria_adjustments.get(name))
                confidence_dict[name] = _apply_confidence_adjustment(
                    confidence,
                    overall_adjustment + vf_group_adjustment + criterion_adjustment,
                )
        
        if not points or len(points) < 2:
            continue
        
        piecewise_function = _build_piecewise_linear_function(points)
        if piecewise_function is None:
            continue
        vf_dict[name] = piecewise_function
    
    if return_confidence:
        return vf_dict, confidence_dict
    return vf_dict


def build_comparisons_from_session(session_doc):
    """Extract and format comparisons from session BWT data.
    
    Parameters
    ----------
    session_doc : dict
        Session document with 'bwt' field.
    
    Returns
    -------
    list[dict]
        List of comparison records with standard format.
    """
    bwt_data = session_doc.get('bwt', {})
    
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


def build_alternatives_with_qualitative(input_doc, qualitative_indicators=None, practitioner_settings=None):
    """Build alternatives dict with qualitative substitution.
    
    Parameters
    ----------
    input_doc : dict
        Input document with criteria field.
    qualitative_indicators : dict or None
        Qualitative indicators mapping criterion_name -> qualitative data.
    
    Returns
    -------
    tuple
        (alternatives_dict, criteria_names_list)
    """
    criteria = input_doc.get('criteria', [])
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
            alternatives[alt_name][crit_name] = str(value) if value is not None else ''
    
    # Substitute qualitative values with x-positions and encode uncertainty
    if qualitative_indicators and isinstance(qualitative_indicators, dict):
        confidence_adjustments = {}
        if isinstance(practitioner_settings, dict):
            confidence_adjustments = practitioner_settings.get('confidence_adjustments', {})
        if not isinstance(confidence_adjustments, dict):
            confidence_adjustments = {}
        overall_adjustment = _normalize_confidence_adjustment(confidence_adjustments.get('overall'))
        qi_group_adjustment = _normalize_confidence_adjustment(confidence_adjustments.get('qi'))
        qi_criteria_adjustments = confidence_adjustments.get('qi_criteria', {})
        if not isinstance(qi_criteria_adjustments, dict):
            qi_criteria_adjustments = {}
        
        for criterion in criteria:
            if not criterion.get('is_qualitative'):
                continue
            
            crit_name = criterion.get('criterion_name')
            if not crit_name:
                continue
            
            qi_data = qualitative_indicators.get(crit_name, {})
            ranking = qi_data.get('ranking', {})
            values = qi_data.get('values', {})
            confidences = qi_data.get('confidences', {})
            criterion_adjustment = _normalize_confidence_adjustment(qi_criteria_adjustments.get(crit_name))
            
            if not ranking or not values:
                continue
            
            for alt_name in alternatives.keys():
                if alt_name in ranking:
                    rank = ranking[alt_name]
                    
                    # Use the actual value from the QI data, not recalculated from rank
                    rank_key = str(rank) if not isinstance(rank, str) else rank
                    x_pos = values.get(rank_key, values.get(int(rank_key) if rank_key.isdigit() else rank))
                    
                    if x_pos is None:
                        continue
                    
                    x_pos = float(x_pos)
                    
                    # Get confidence for this rank and encode uncertainty
                    conf_key = str(rank) if not isinstance(rank, str) else rank
                    confidence = confidences.get(conf_key, confidences.get(int(conf_key) if conf_key.isdigit() else conf_key, 4))
                    adjusted_confidence = _apply_confidence_adjustment(
                        confidence,
                        overall_adjustment + qi_group_adjustment + criterion_adjustment,
                    )
                    error_pct = _confidence_to_error_pct(adjusted_confidence, scale=10.0)
                    
                    if error_pct > 0:
                        # Format as "x_pos ± error_pct%"
                        alternatives[alt_name][crit_name] = f"{x_pos} ± {error_pct}%"
                    else:
                        # No uncertainty, just store the x_pos
                        alternatives[alt_name][crit_name] = x_pos
    
    return alternatives, criteria_names


def _normalize_confidence_adjustment(value):
    try:
        adjustment = float(value)
    except (TypeError, ValueError):
        adjustment = 0.0
    if adjustment < -4.0 or adjustment > 4.0:
        return 0.0
    return round(adjustment, 1)


def _apply_confidence_adjustment(confidence, adjustment=0.0):
    try:
        normalized = float(confidence)
    except (TypeError, ValueError):
        normalized = 4.0
    return max(0.0, min(4.0, normalized + adjustment))


def _confidence_to_error_pct(confidence, scale=10.0):
    normalized = _apply_confidence_adjustment(confidence, 0.0)
    return scale * (4.0 - normalized) / 4.0


def compute_opinion_weights(practitioner_settings_list):
    """Return NSMC opinion weights for the sessions, or None for equal weights.

    Mirrors backend/app/services/workflow_service.py::start_step: each session's
    practitioner `overall_weight` (non-negative, default 1.0) is normalized to sum
    to 1. Equal weights (the default) return None, so the engine samples uniformly.
    """
    raw_weights = []
    for settings in practitioner_settings_list:
        settings = settings if isinstance(settings, dict) else {}
        try:
            weight = float(settings.get('overall_weight', 1.0))
        except (TypeError, ValueError):
            weight = 1.0
        if not math.isfinite(weight) or weight < 0:
            weight = 1.0
        raw_weights.append(weight)

    total = sum(raw_weights)
    if total <= 0 or len(set(raw_weights)) <= 1:
        return None
    return [weight / total for weight in raw_weights]
