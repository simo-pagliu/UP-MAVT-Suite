#!/usr/bin/env python3
"""
Load data from MongoDB for UPMAVT analysis.

This module provides functions to extract data from MongoDB collections
and format it for use by the core analysis modules (upmavt.py, weight_space_definition.py).

The key principle: these functions normalize MongoDB document structures into
standardized Python dictionaries/lists that the core modules expect.
"""

from bson.objectid import ObjectId


def load_input_data(db, study_session_id):
    """Load criteria and alternatives from the input document.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    study_session_id : str or ObjectId
        Study session ID to retrieve input from.
    
    Returns
    -------
    dict
        {
            'criteria': [list of criterion dicts],
            'alternatives': {alt_name: {crit_name: value_str, ...}, ...},
            'criteria_names': [list of criterion names]
        }
    
    Raises
    ------
    ValueError
        If study session or input not found.
    """
    # Get the study session
    study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
    if not study:
        raise ValueError(f"Study session {study_session_id} not found")
    
    input_id = study.get('input_id')
    if not input_id:
        raise ValueError("Study session has no input defined")
    
    # Get the input document
    input_doc = db.inputs.find_one({'_id': input_id})
    if not input_doc:
        raise ValueError("Input document not found")
    
    criteria = input_doc.get('criteria', [])
    if not criteria:
        raise ValueError("No criteria found in input")
    
    # Build alternatives dict from criteria structure
    alternatives = {}
    criteria_names = []
    
    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        
        crit_name = criterion.get('criterion_name')
        if not crit_name:
            continue
        
        criteria_names.append(crit_name)
        
        # Add each alternative value for this criterion
        for alt in criterion.get('alternatives', []):
            if not isinstance(alt, dict):
                continue
            
            alt_name = alt.get('name', '')
            if not alt_name:
                continue
            
            if alt_name not in alternatives:
                alternatives[alt_name] = {}
            
            # Store the value string (handling qualitative separately)
            value = alt.get('value', '')
            alternatives[alt_name][crit_name] = str(value) if value is not None else ''
    
    return {
        'criteria': criteria,
        'alternatives': alternatives,
        'criteria_names': criteria_names,
    }


def load_session_data(db, session_id):
    """Load elicitation session data.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    session_id : str or ObjectId
        Session ID to load.
    
    Returns
    -------
    dict
        Session document with:
        - _id, name, value_functions, qualitative_indicators, bwt, etc.
    
    Raises
    ------
    ValueError
        If session not found.
    """
    session = db.sessions.find_one({'_id': ObjectId(session_id)})
    if not session:
        raise ValueError(f"Session {session_id} not found")
    
    # Ensure session has an ID for downstream processing
    if '_id' not in session:
        session['_id'] = session_id
    
    return session


def load_session_data_batch(db, session_ids):
    """Load multiple sessions as a batch.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    session_ids : list
        List of session IDs.
    
    Returns
    -------
    list[dict]
        List of session documents.
    """
    session_docs = []
    for session_id in session_ids:
        try:
            session = load_session_data(db, session_id)
            session_docs.append(session)
        except ValueError:
            # Skip missing sessions with warning (let caller decide if critical)
            pass
    
    return session_docs


def load_computed_weights(db, study_session_id):
    """Load pre-computed weight solutions from the study session.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    study_session_id : str or ObjectId
        Study session ID.
    
    Returns  
    -------
    dict
        The computed_weights document containing:
        {
            'weight_solutions': {session_id: [list of weight dicts], ...},
            'timestamp': datetime,
            ...
        }
    
    Raises
    ------
    ValueError
        If study session not found or weights not computed.
    """
    study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
    if not study:
        raise ValueError(f"Study session {study_session_id} not found")
    
    computed_weights = study.get('computed_weights')
    if not computed_weights:
        raise ValueError("Weights have not been computed yet. Run Step 1 first.")
    
    return computed_weights


def load_step_results(db, study_session_id, step_number):
    """Load pre-computed results for a specific step.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    study_session_id : str or ObjectId
        Study session ID.
    step_number : int
        Step number (2-6).
    
    Returns
    -------
    dict or None
        Step results document if it exists, otherwise None.
    """
    study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
    if not study:
        return None
    
    field = f'step_{step_number}_results'
    return study.get(field)


def save_computed_weights(db, study_session_id, weight_solutions):
    """Save computed weight solutions to the study session.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    study_session_id : str or ObjectId
        Study session ID.
    weight_solutions : dict
        {session_id: [list of weight dicts], ...}
    
    Returns
    -------
    None
    """
    from datetime import datetime, timezone
    
    result_doc = {
        'timestamp': datetime.now(timezone.utc),
        'weight_solutions': weight_solutions,
    }
    
    db.study_sessions.update_one(
        {'_id': ObjectId(study_session_id)},
        {'$set': {'computed_weights': result_doc}}
    )


def save_step_results(db, study_session_id, step_number, results):
    """Save step results to the study session.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    study_session_id : str or ObjectId
        Study session ID.
    step_number : int
        Step number (2-6).
    results : dict
        Results to save.
    
    Returns
    -------
    None
    """
    from datetime import datetime, timezone
    
    result_doc = {
        'timestamp': datetime.now(timezone.utc),
        **results,
    }
    
    field = f'step_{step_number}_results'
    
    db.study_sessions.update_one(
        {'_id': ObjectId(study_session_id)},
        {'$set': {field: result_doc}}
    )

# ============================================================================
# HELPER FUNCTIONS FOR DATA EXTRACTION & PROCESSING
# ============================================================================

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
            Mapping criterion_name -> scipy interp1d function
        If return_confidence=True:
            (vf_dict, confidence_dict)
    """
    from scipy.interpolate import interp1d
    import numpy as np
    
    vf_dict = {}
    confidence_dict = {}
    
    value_functions_data = session_doc.get('value_functions', {})
    qualitative_indicators = session_doc.get('qualitative_indicators')
    
    criteria_map = value_functions_data.get('criteria', {}) if isinstance(value_functions_data, dict) else {}
    
    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        name = criterion.get('criterion_name')
        if not name:
            continue
        
        points = []
        
        if criterion.get('is_qualitative'):
            # Generate qualitative value function points
            if qualitative_indicators and name in qualitative_indicators:
                qi_data = qualitative_indicators[name]
                ranking = qi_data.get('ranking', {})
                values = qi_data.get('values', {})
                is_increasing = qi_data.get('isIncreasing', True)
                
                if ranking and values:
                    unique_ranks = sorted(set(ranking.values()))
                    if unique_ranks:
                        total_points = len(unique_ranks) + 2
                        points.append({'x': 0, 'y': 0 if is_increasing else 1})
                        
                        for idx, rank in enumerate(reversed(unique_ranks)):
                            x_pos = idx + 1
                            x_normalized = x_pos / (total_points - 1)
                            y_value = values.get(rank, values.get(str(rank), x_normalized))
                            points.append({'x': x_normalized, 'y': y_value})
                        
                        points.append({'x': 1, 'y': 1 if is_increasing else 0})
            
            if return_confidence and qualitative_indicators and name in qualitative_indicators:
                qual_data = qualitative_indicators[name]
                confidences_dict = qual_data.get('confidences', {})
                confidence_dict[name] = {int(k) if isinstance(k, str) and k.isdigit() else k: int(v) 
                                        for k, v in confidences_dict.items()}
        else:
            # Quantitative criterion
            cfg = criteria_map.get(name, {})
            if isinstance(cfg, dict):
                points = cfg.get('points', [])
            if return_confidence:
                confidence = cfg.get('confidence', 4) if isinstance(cfg, dict) else 4
                confidence_dict[name] = int(confidence)
        
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


def build_alternatives_with_qualitative(input_doc, qualitative_indicators=None):
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
    
    # Substitute qualitative values with x-positions
    if qualitative_indicators and isinstance(qualitative_indicators, dict):
        for criterion in criteria:
            if not criterion.get('is_qualitative'):
                continue
            
            crit_name = criterion.get('criterion_name')
            if not crit_name:
                continue
            
            qi_data = qualitative_indicators.get(crit_name, {})
            ranking = qi_data.get('ranking', {})
            
            if not ranking:
                continue
            
            for alt_name in alternatives.keys():
                if alt_name in ranking:
                    rank = ranking[alt_name]
                    unique_ranks = sorted(set(ranking.values()))
                    if unique_ranks:
                        rank_idx = unique_ranks.index(rank) if rank in unique_ranks else 0
                        x_pos = (rank_idx + 1) / (len(unique_ranks) + 1)
                        alternatives[alt_name][crit_name] = x_pos
    
    return alternatives, criteria_names