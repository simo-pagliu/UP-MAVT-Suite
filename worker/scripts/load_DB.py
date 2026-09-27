#!/usr/bin/env python3
"""
Load data from MongoDB for UPMAVT analysis.

This module provides functions to extract data from MongoDB collections
and format it for use by the core analysis modules (upmavt.py, weight_space_definition.py).

The key principle: these functions normalize MongoDB document structures into
standardized Python dictionaries/lists that the core modules expect.
"""

from bson.objectid import ObjectId

# Pure session -> engine-input helpers, shared with the offline export bundle.
from .session_inputs import (  # noqa: F401  (re-exported for worker.py)
    build_value_functions_from_session,
    build_comparisons_from_session,
    build_alternatives_with_qualitative,
)


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
        'input_id': input_id,
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


def save_computed_weights(
    db,
    study_session_id,
    weight_solutions,
    pre_threshold_weight_solutions=None,
    use_non_linear_model=True,
    phase3_tolerance_pct=1.0,
    weight_space_parameters=None,
):
    """Save computed weight solutions to the study session.
    
    Parameters
    ----------
    db : pymongo.database.Database
        MongoDB database connection.
    study_session_id : str or ObjectId
        Study session ID.
    weight_solutions : dict
        {session_id: [list of weight dicts], ...}
    use_non_linear_model : bool
        Whether the non-linear weight model was used.
    phase3_tolerance_pct : float
        Percentage LIM used for Phase 3 filtering.
    
    Returns
    -------
    None
    """
    from datetime import datetime, timezone
    
    result_doc = {
        'timestamp': datetime.now(timezone.utc),
        'use_non_linear_model': bool(use_non_linear_model),
        'phase3_tolerance_pct': float(phase3_tolerance_pct),
        'weight_space_parameters': weight_space_parameters or {},
        'weight_solutions': weight_solutions,
    }
    if isinstance(pre_threshold_weight_solutions, dict):
        result_doc['pre_threshold_weight_solutions'] = pre_threshold_weight_solutions
    
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
