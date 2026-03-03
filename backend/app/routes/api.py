from flask import Blueprint, request, jsonify, current_app, send_file
from bson.objectid import ObjectId
from datetime import datetime
import csv
import io
import json
import os
import zipfile

bp = Blueprint('api', __name__, url_prefix='/api')

def _ensure_object_id(value):
    if isinstance(value, ObjectId):
        return value
    if not value:
        return None
    try:
        return ObjectId(value)
    except Exception:
        return None

def _serialize_object_id(value):
    if isinstance(value, ObjectId):
        return str(value)
    if value is None:
        return None
    return str(value)

def _normalize_rank_key(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return value

def _normalize_confidence_value(value, default=4):
    try:
        confidence = int(value)
    except (TypeError, ValueError):
        confidence = default
    return max(0, min(4, confidence))

def _build_rank_confidences_from_alternatives(ranking, confidences_alternatives):
    if not isinstance(ranking, dict) or not isinstance(confidences_alternatives, dict):
        return {}

    confidence_by_rank = {}
    for alt_name, rank in ranking.items():
        rank_key = _normalize_rank_key(rank)
        conf_raw = confidences_alternatives.get(alt_name)
        if conf_raw is None:
            continue
        confidence_by_rank.setdefault(rank_key, []).append(
            _normalize_confidence_value(conf_raw, default=4)
        )

    return {
        rank_key: int(round(sum(values) / len(values)))
        for rank_key, values in confidence_by_rank.items()
        if values
    }

def _normalize_qualitative_confidences(ranking, confidences, confidences_alternatives=None):
    if not isinstance(ranking, dict):
        return {}

    legacy_rank_confidences = _build_rank_confidences_from_alternatives(
        ranking,
        confidences_alternatives,
    )
    normalized = {}
    unique_ranks = {_normalize_rank_key(rank) for rank in ranking.values()}

    for rank in unique_ranks:
        conf_raw = None
        if isinstance(confidences, dict):
            conf_raw = confidences.get(rank)
            if conf_raw is None:
                conf_raw = confidences.get(str(rank))
        if conf_raw is None:
            conf_raw = legacy_rank_confidences.get(rank)
        normalized[str(rank)] = _normalize_confidence_value(conf_raw, default=4)

    return normalized

def _normalize_qualitative_indicators(criteria, qualitative_indicators):
    if not isinstance(qualitative_indicators, dict):
        return {}

    qualitative_names = set()
    if isinstance(criteria, list):
        qualitative_names = {
            c.get('criterion_name')
            for c in criteria
            if isinstance(c, dict) and c.get('is_qualitative') and c.get('criterion_name')
        }

    normalized = {}
    for criterion_name, raw_data in qualitative_indicators.items():
        if qualitative_names and criterion_name not in qualitative_names:
            normalized[criterion_name] = raw_data
            continue

        if not isinstance(raw_data, dict):
            normalized[criterion_name] = raw_data
            continue

        ranking = raw_data.get('ranking') if isinstance(raw_data.get('ranking'), dict) else {}
        values = raw_data.get('values') if isinstance(raw_data.get('values'), dict) else {}
        confidences = _normalize_qualitative_confidences(
            ranking,
            raw_data.get('confidences'),
            raw_data.get('confidences_alternatives'),
        )

        normalized[criterion_name] = {
            **raw_data,
            'ranking': ranking,
            'values': values,
            'confidences': confidences,
        }

    return normalized

def _validate_criteria(criteria):
    if not isinstance(criteria, list) or len(criteria) == 0:
        return False, 'At least one criterion is required'

    required_fields = {'criterion_name', 'unit', 'alternatives'}
    normalized = []

    for idx, criterion in enumerate(criteria):
        if not isinstance(criterion, dict):
            return False, f'Criterion {idx + 1} is not valid'
        if not required_fields.issubset(criterion.keys()):
            return False, f'Criterion {idx + 1} is missing required fields'

        normalized_criterion = dict(criterion)
        if 'group' not in normalized_criterion:
            normalized_criterion['group'] = ''
        if not isinstance(normalized_criterion.get('group'), str):
            return False, f'Criterion {idx + 1} group must be a string'

        if 'description' not in normalized_criterion:
            normalized_criterion['description'] = ''
        if not isinstance(normalized_criterion.get('description'), str):
            return False, f'Criterion {idx + 1} description must be a string'

        alternatives = normalized_criterion.get('alternatives')
        if not isinstance(alternatives, list):
            return False, f'Criterion {idx + 1} alternatives must be a list'
        for alt_idx, alt in enumerate(alternatives):
            if not isinstance(alt, dict) or 'name' not in alt or 'value' not in alt:
                return False, f'Criterion {idx + 1}, alternative {alt_idx + 1} is invalid'

        normalized.append(normalized_criterion)

    return True, normalized

def _validate_input_for_features(criteria, features):
    """Validate input based on which features are activated."""
    if not isinstance(criteria, list) or len(criteria) == 0:
        return False, 'At least one criterion is required'
    
    features = features or {'qi': False, 'vf': False, 'bwt': False}
    qi_active = features.get('qi', False)
    vf_active = features.get('vf', False)
    bwt_active = features.get('bwt', False)
    
    # If QI is active, all criteria must have alternatives
    if qi_active:
        for idx, criterion in enumerate(criteria):
            alternatives = criterion.get('alternatives', [])
            if not isinstance(alternatives, list) or len(alternatives) == 0:
                return False, f'QI requires alternatives for all criteria. Criterion "{criterion.get("criterion_name")}" at position {idx + 1} is missing alternatives'
    
    # If VF or BWT is active, we need at least criteria (alternatives are optional)
    if vf_active or bwt_active:
        for idx, criterion in enumerate(criteria):
            if not criterion.get('criterion_name'):
                return False, f'Criterion {idx + 1} must have a name'
    
    return True, 'Valid'

def _resolve_session_criteria(session, db):
    if not isinstance(session, dict):
        return []
    input_id = _ensure_object_id(session.get('input_id'))
    if input_id:
        input_doc = db.inputs.find_one({'_id': input_id})
        if isinstance(input_doc, dict) and isinstance(input_doc.get('criteria'), list):
            return input_doc.get('criteria')
    return session.get('criteria', [])

def _attach_session_criteria(session, db):
    if not isinstance(session, dict):
        return session
    session['criteria'] = _resolve_session_criteria(session, db)
    if 'input_id' in session:
        session['input_id'] = _serialize_object_id(session.get('input_id'))
    if 'study_session_id' in session:
        session['study_session_id'] = _serialize_object_id(session.get('study_session_id'))
    return session

# Admin authentication
@bp.route('/admin/login', methods=['POST'])
def admin_login():
    """Verify admin password"""
    data = request.json or {}
    password = data.get('password')
    
    admin_password = os.getenv('ADMIN_PASSWORD', 'admin123')
    
    if password == admin_password:
        return jsonify({'success': True}), 200
    else:
        return jsonify({'success': False, 'error': 'Invalid password'}), 401

# Session detection
@bp.route('/session/detect/<code>', methods=['GET'])
def detect_session_type(code):
    """Detect if a code belongs to a stakeholder (elicitation) or practitioner session"""
    db = current_app.db
    
    # Check if code exists in stakeholder/elicitation sessions
    stakeholder_session = db.sessions.find_one({'name': code})
    if stakeholder_session:
        return jsonify({
            'exists': True,
            'type': 'stakeholder',
            '_id': str(stakeholder_session.get('_id')),
            'code': code
        }), 200
    
    # Check if code exists in practitioner study sessions
    practitioner_session = db.study_sessions.find_one({'code': code})
    if practitioner_session:
        return jsonify({
            'exists': True,
            'type': 'practitioner',
            '_id': str(practitioner_session.get('_id')),
            'code': code
        }), 200
    
    # Code not found
    return jsonify({'exists': False}), 200

# Initialize session
@bp.route('/session', methods=['POST'])
def create_session():
    """Create a new session with initial name and criteria"""
    data = request.json or {}
    name = data.get('name')
    criteria = data.get('criteria', [])

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    is_valid, criteria_or_error = _validate_criteria(criteria)
    if not is_valid:
        return jsonify({'error': criteria_or_error}), 400
    criteria = criteria_or_error

    db = current_app.db
    session_doc = {
        'name': name,
        'criteria': criteria,
        'qualitative_indicators': None,
        'value_functions': None,
        'bwt': None,
        'locked': False,
        'session_locked': False,
        'created_at': datetime.utcnow()
    }

    result = db.sessions.insert_one(session_doc)
    return jsonify({'session_id': str(result.inserted_id)}), 201

# Study sessions
@bp.route('/study-session', methods=['POST'])
def create_study_session():
    """Create a new study session (code only)."""
    data = request.json or {}
    code = data.get('code')
    if not code:
        return jsonify({'error': 'Study code is required'}), 400

    db = current_app.db
    existing = db.study_sessions.find_one({'code': code})
    if existing:
        return jsonify({'error': 'Study code already exists'}), 409

    study_doc = {
        'code': code,
        'input_id': None,
        'features': {
            'qi': False,
            'vf': False,
            'bwt': False
        },
        'created_at': datetime.utcnow(),
    }
    result = db.study_sessions.insert_one(study_doc)
    return jsonify({'study_session_id': str(result.inserted_id)}), 201

@bp.route('/study-session/by-code/<code>', methods=['GET'])
def get_study_session_by_code(code):
    """Retrieve a study session by code."""
    db = current_app.db
    study = db.study_sessions.find_one({'code': code})
    if not study:
        return jsonify({'exists': False}), 200

    input_id = _ensure_object_id(study.get('input_id'))
    criteria = []
    if input_id:
        input_doc = db.inputs.find_one({'_id': input_id})
        if isinstance(input_doc, dict):
            criteria = input_doc.get('criteria', [])

    study['_id'] = str(study['_id'])
    study['input_id'] = _serialize_object_id(study.get('input_id'))
    study['criteria'] = criteria
    study['exists'] = True
    return jsonify(study), 200

@bp.route('/study-session/<study_session_id>', methods=['GET'])
def get_study_session(study_session_id):
    """Retrieve a study session by id."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        input_id = _ensure_object_id(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = db.inputs.find_one({'_id': input_id})
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])

        study['_id'] = str(study['_id'])
        study['input_id'] = _serialize_object_id(study.get('input_id'))
        study['criteria'] = criteria
        return jsonify(study), 200
    except:
        return jsonify({'error': 'Invalid study session ID'}), 400

@bp.route('/study-session/<study_session_id>', methods=['PATCH'])
def update_study_session(study_session_id):
    """Update study session features."""
    data = request.json or {}
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        # Update features if provided
        update_doc = {}
        if 'features' in data:
            features = data.get('features', {})
            if isinstance(features, dict):
                update_doc['features'] = {
                    'qi': bool(features.get('qi', False)),
                    'vf': bool(features.get('vf', False)),
                    'bwt': bool(features.get('bwt', False))
                }
        
        if update_doc:
            db.study_sessions.update_one(
                {'_id': ObjectId(study_session_id)},
                {'$set': update_doc}
            )
        
        # Return updated session
        updated_study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        updated_study['_id'] = str(updated_study['_id'])
        updated_study['input_id'] = _serialize_object_id(updated_study.get('input_id'))
        return jsonify(updated_study), 200
    except:
        return jsonify({'error': 'Invalid study session ID'}), 400

@bp.route('/study-session/<study_session_id>', methods=['DELETE'])
def delete_study_session(study_session_id):
    """Delete a study session and optionally its elicitation sessions."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        # Check if there are elicitation sessions
        session_count = db.sessions.count_documents({'study_session_id': ObjectId(study_session_id)})
        if session_count > 0:
            return jsonify({'error': 'Cannot delete study session with elicitation sessions'}), 400

        # Delete associated input if it exists
        input_id = _ensure_object_id(study.get('input_id'))
        if input_id:
            db.inputs.delete_one({'_id': input_id})

        # Delete the study session
        db.study_sessions.delete_one({'_id': ObjectId(study_session_id)})
        return jsonify({'success': True}), 200
    except:
        return jsonify({'error': 'Invalid study session ID'}), 400

@bp.route('/study-session/<study_session_id>/input', methods=['PUT'])
def update_study_input(study_session_id):
    """Create or update the study input criteria."""
    data = request.json or {}
    criteria = data.get('criteria', [])

    is_valid, criteria_or_error = _validate_criteria(criteria)
    if not is_valid:
        return jsonify({'error': criteria_or_error}), 400
    criteria = criteria_or_error

    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        input_id = _ensure_object_id(study.get('input_id'))
        now = datetime.utcnow()
        if input_id:
            db.inputs.update_one(
                {'_id': input_id},
                {'$set': {'criteria': criteria, 'updated_at': now}}
            )
        else:
            input_doc = {
                'criteria': criteria,
                'created_at': now,
                'updated_at': now,
            }
            result = db.inputs.insert_one(input_doc)
            db.study_sessions.update_one(
                {'_id': ObjectId(study_session_id)},
                {'$set': {'input_id': result.inserted_id}}
            )

        return jsonify({'status': 'updated'}), 200
    except:
        return jsonify({'error': 'Invalid study session ID'}), 400

@bp.route('/study-session/<study_session_id>/reset-sessions', methods=['POST'])
def reset_elicitation_sessions(study_session_id):
    """Reset all elicitation sessions for a study session."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        # Delete all elicitation sessions associated with this study
        result = db.sessions.delete_many({'study_session_id': ObjectId(study_session_id)})
        
        return jsonify({
            'status': 'reset',
            'deleted_count': result.deleted_count
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@bp.route('/study-session/<study_session_id>/input', methods=['GET'])
def get_study_input(study_session_id):
    """Get study input criteria."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        input_id = _ensure_object_id(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = db.inputs.find_one({'_id': input_id})
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])

        return jsonify({'criteria': criteria}), 200
    except:
        return jsonify({'error': 'Invalid study session ID'}), 400

@bp.route('/study-session/<study_session_id>/elicitation-session', methods=['POST'])
def create_elicitation_session(study_session_id):
    """Create an elicitation session under a study session."""
    data = request.json or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'Session code is required'}), 400

    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        if db.sessions.find_one({'name': name}):
            return jsonify({'error': 'Session code already exists'}), 409

        input_id = _ensure_object_id(study.get('input_id'))
        if not input_id:
            return jsonify({'error': 'Study input is not defined'}), 400

        # Get input criteria
        input_doc = db.inputs.find_one({'_id': input_id})
        if not input_doc:
            return jsonify({'error': 'Study input not found'}), 400
        
        criteria = input_doc.get('criteria', [])
        features = study.get('features', {'qi': False, 'vf': False, 'bwt': False})
        
        # Validate input based on activated features
        is_valid, validation_msg = _validate_input_for_features(criteria, features)
        if not is_valid:
            return jsonify({'error': validation_msg}), 400

        session_doc = {
            'name': name,
            'input_id': input_id,
            'study_session_id': ObjectId(study_session_id),
            'qualitative_indicators': None,
            'value_functions': None,
            'bwt': None,
            'locked': False,
            'session_locked': False,
            'created_at': datetime.utcnow()
        }
        result = db.sessions.insert_one(session_doc)
        return jsonify({'session_id': str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@bp.route('/study-session/<study_session_id>/elicitation-sessions', methods=['GET'])
def list_elicitation_sessions(study_session_id):
    """List elicitation sessions for a study session."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        input_id = _ensure_object_id(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = db.inputs.find_one({'_id': input_id})
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])

        sessions = list(db.sessions.find({'study_session_id': ObjectId(study_session_id)}).sort('created_at', -1))
        for session in sessions:
            session['_id'] = str(session['_id'])
            session['study_session_id'] = _serialize_object_id(session.get('study_session_id'))
            session['input_id'] = _serialize_object_id(session.get('input_id'))

        return jsonify({
            'study_session_id': str(study.get('_id')),
            'study_code': study.get('code'),
            'criteria': criteria,
            'sessions': sessions,
        }), 200
    except:
        return jsonify({'error': 'Invalid study session ID'}), 400

# Get all study sessions (for admin)
@bp.route('/study-sessions', methods=['GET'])
def get_all_study_sessions():
    """Retrieve all study sessions with their elicitation sessions"""
    db = current_app.db
    study_sessions = list(db.study_sessions.find().sort('created_at', -1))
    result = []
    for study in study_sessions:
        study_id = study.get('_id')
        input_id = _ensure_object_id(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = db.inputs.find_one({'_id': input_id})
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])
        
        # Get elicitation sessions for this study
        sessions = list(db.sessions.find({'study_session_id': study_id}).sort('created_at', -1))
        for session in sessions:
            session['_id'] = str(session['_id'])
            session['study_session_id'] = _serialize_object_id(session.get('study_session_id'))
            session['input_id'] = _serialize_object_id(session.get('input_id'))
        
        study['_id'] = str(study_id)
        study['input_id'] = _serialize_object_id(study.get('input_id'))
        study['criteria'] = criteria
        study['sessions'] = sessions
        result.append(study)
    
    return jsonify(result), 200

# Get all sessions (for admin)
@bp.route('/sessions', methods=['GET'])
def get_all_sessions():
    """Retrieve all sessions"""
    db = current_app.db
    sessions = list(db.sessions.find().sort('created_at', -1))
    for session in sessions:
        session['_id'] = str(session['_id'])
        _attach_session_criteria(session, db)
    return jsonify(sessions), 200

# Get session by name
@bp.route('/session/by-name/<name>', methods=['GET'])
def get_session_by_name(name):
    """Retrieve a session by name"""
    db = current_app.db
    session = db.sessions.find_one({'name': name})
    if not session:
        return jsonify({'exists': False}), 200

    session['_id'] = str(session['_id'])
    session['exists'] = True
    _attach_session_criteria(session, db)
    return jsonify(session), 200

# Get session
@bp.route('/session/<session_id>', methods=['GET'])
def get_session(session_id):
    """Retrieve a session"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        session['_id'] = str(session['_id'])
        _attach_session_criteria(session, db)
        return jsonify(session), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Delete session
@bp.route('/session/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """Delete a session"""
    db = current_app.db
    try:
        result = db.sessions.delete_one({'_id': ObjectId(session_id)})
        if result.deleted_count == 0:
            return jsonify({'error': 'Session not found'}), 404
        return jsonify({'status': 'deleted'}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Update criteria
@bp.route('/session/<session_id>/criteria', methods=['PUT'])
def update_criteria(session_id):
    """Update session criteria"""
    data = request.json or {}
    criteria = data.get('criteria', [])

    is_valid, criteria_or_error = _validate_criteria(criteria)
    if not is_valid:
        return jsonify({'error': criteria_or_error}), 400
    criteria = criteria_or_error

    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        if session.get('session_locked', False):
            return jsonify({'error': 'Session is locked'}), 423
        if session.get('locked', False):
            return jsonify({'error': 'Input is locked'}), 423

        # Check for criteria that became qualitative/non-qualitative and update accordingly
        old_criteria = _resolve_session_criteria(session, db)
        value_functions = session.get('value_functions') or {}
        qualitative_indicators = session.get('qualitative_indicators') or {}
        
        # Build maps of criterion names to is_qualitative status
        old_qualitative_map = {c.get('criterion_name'): c.get('is_qualitative', False) for c in old_criteria}
        new_qualitative_map = {c.get('criterion_name'): c.get('is_qualitative', False) for c in criteria}
        
        # Find criteria that changed from non-qualitative to qualitative (remove from value_functions)
        became_qualitative = []
        # Find criteria that changed from qualitative to non-qualitative (remove from qualitative_indicators)
        became_non_qualitative = []
        
        for criterion_name, was_qualitative in old_qualitative_map.items():
            is_now_qualitative = new_qualitative_map.get(criterion_name, False)
            if not was_qualitative and is_now_qualitative:
                became_qualitative.append(criterion_name)
            elif was_qualitative and not is_now_qualitative:
                became_non_qualitative.append(criterion_name)
        
        # Remove from value_functions if criteria became qualitative
        if became_qualitative and isinstance(value_functions, dict):
            criteria_map = value_functions.get('criteria', {})
            if isinstance(criteria_map, dict):
                for criterion_name in became_qualitative:
                    if criterion_name in criteria_map:
                        del criteria_map[criterion_name]
                value_functions['criteria'] = criteria_map
        
        # Remove from qualitative_indicators if criteria became non-qualitative
        if became_non_qualitative and isinstance(qualitative_indicators, dict):
            for criterion_name in became_non_qualitative:
                if criterion_name in qualitative_indicators:
                    del qualitative_indicators[criterion_name]

        input_id = _ensure_object_id(session.get('input_id'))
        if input_id:
            db.inputs.update_one(
                {'_id': input_id},
                {'$set': {'criteria': criteria, 'updated_at': datetime.utcnow()}}
            )
            update_payload = {'value_functions': value_functions, 'qualitative_indicators': qualitative_indicators}
        else:
            update_payload = {'criteria': criteria, 'value_functions': value_functions, 'qualitative_indicators': qualitative_indicators}

        db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': update_payload}
        )
        return jsonify({'status': 'updated'}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Toggle input lock
@bp.route('/session/<session_id>/lock', methods=['PUT'])
def toggle_session_lock(session_id):
    """Toggle the lock status of a session's input"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        current_locked = session.get('locked', False)
        new_locked = not current_locked
        
        result = db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'locked': new_locked}}
        )
        
        return jsonify({'locked': new_locked}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Toggle session lock
@bp.route('/session/<session_id>/lock-session', methods=['PUT'])
def toggle_full_session_lock(session_id):
    """Toggle the lock status of a session (all fields)"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        current_locked = session.get('session_locked', False)
        new_locked = not current_locked

        db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'session_locked': new_locked}}
        )

        return jsonify({'session_locked': new_locked}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Update qualitative indicators
@bp.route('/session/<session_id>/qualitative', methods=['PUT'])
def update_qualitative(session_id):
    """Update qualitative indicators"""
    data = request.json
    value = data.get('value')
    
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        if session.get('session_locked', False):
            return jsonify({'error': 'Session is locked'}), 423

        criteria = _resolve_session_criteria(session, db)
        normalized_value = _normalize_qualitative_indicators(criteria, value)

        db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'qualitative_indicators': normalized_value}}
        )
        return jsonify({'status': 'updated'}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Update value functions
@bp.route('/session/<session_id>/value', methods=['PUT'])
def update_value(session_id):
    """Update value functions"""
    data = request.json
    value = data.get('value')
    
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        if session.get('session_locked', False):
            return jsonify({'error': 'Session is locked'}), 423

        db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'value_functions': value}}
        )
        return jsonify({'status': 'updated'}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

def _is_qualitative_complete(criteria, qualitative_indicators):
    if not isinstance(criteria, list):
        return False
    if not isinstance(qualitative_indicators, dict):
        return False
    for criterion in criteria:
        if not isinstance(criterion, dict) or not criterion.get('is_qualitative'):
            continue
        name = criterion.get('criterion_name')
        data = qualitative_indicators.get(name) if name else None
        if not isinstance(data, dict):
            return False
        ranking = data.get('ranking')
        values = data.get('values')
        if not isinstance(ranking, dict) or not isinstance(values, dict):
            return False
        if len(ranking) == 0 or len(values) == 0:
            return False
    return True

def _is_value_functions_complete(criteria, value_functions):
    if not isinstance(criteria, list):
        return False
    criteria_map = value_functions.get('criteria') if isinstance(value_functions, dict) else {}
    if not isinstance(criteria_map, dict):
        criteria_map = {}
    for criterion in criteria:
        if not isinstance(criterion, dict) or criterion.get('is_qualitative'):
            continue
        name = criterion.get('criterion_name')
        cfg = criteria_map.get(name) if name else None
        points = cfg.get('points') if isinstance(cfg, dict) else None
        if not isinstance(points, list) or len(points) == 0:
            return False
    return True

def _get_qualitative_alt_value(qualitative_indicators, criterion_name, alt_name):
    if not isinstance(qualitative_indicators, dict):
        return ''
    data = qualitative_indicators.get(criterion_name) if criterion_name else None
    if not isinstance(data, dict):
        return ''
    ranking = data.get('ranking')
    values = data.get('values')
    if not isinstance(ranking, dict) or not isinstance(values, dict):
        return ''
    rank = ranking.get(alt_name)
    if rank is None:
        return ''
    if rank in values:
        return values.get(rank)
    rank_str = str(rank)
    if rank_str in values:
        return values.get(rank_str)
    try:
        rank_int = int(rank)
    except (TypeError, ValueError):
        return ''
    return values.get(rank_int, values.get(str(rank_int), ''))

def _get_qualitative_x_value(qualitative_indicators, criterion_name, alt_name):
    """Get the X value (normalized position) for a qualitative alternative based on its rank"""
    if not isinstance(qualitative_indicators, dict):
        return ''
    data = qualitative_indicators.get(criterion_name) if criterion_name else None
    if not isinstance(data, dict):
        return ''
    ranking = data.get('ranking')
    if not isinstance(ranking, dict):
        return ''
    
    # Get the rank for this alternative
    rank = ranking.get(alt_name)
    if rank is None:
        return ''
    
    # Get all unique ranks to calculate position
    unique_ranks = sorted(set(ranking.values()))
    if len(unique_ranks) == 0:
        return ''
    
    total_points = len(unique_ranks) + 2  # hypothetical worst + ranks + hypothetical best
    
    # Find the position of this rank (reversed because worst=rank N-1, best=rank 0)
    rank_list = list(reversed(unique_ranks))
    if rank not in rank_list:
        return ''
    
    idx = rank_list.index(rank)
    x_pos = idx + 1
    x_normalized = x_pos / (total_points - 1)
    
    return x_normalized

def _build_input_raw_csv(criteria):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Criterion', 'Unit', 'Alternative', 'Value'])
    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        criterion_name = criterion.get('criterion_name', '')
        unit = criterion.get('unit', '')
        alternatives = criterion.get('alternatives', [])
        for alt in alternatives:
            if not isinstance(alt, dict):
                continue
            writer.writerow([
                criterion_name,
                unit,
                alt.get('name', ''),
                alt.get('value', ''),
            ])
    return output.getvalue()

def _build_alternatives_csv(criteria, qualitative_indicators):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Criterion', 'Unit', 'Alternative', 'Value'])
    for criterion in criteria:
        if not isinstance(criterion, dict):
            continue
        criterion_name = criterion.get('criterion_name', '')
        unit = criterion.get('unit', '')
        alternatives = criterion.get('alternatives', [])
        for alt in alternatives:
            if not isinstance(alt, dict):
                continue
            # For qualitative criteria, use X from value functions; for others, use original value
            if criterion.get('is_qualitative'):
                alt_value = _get_qualitative_x_value(
                    qualitative_indicators,
                    criterion_name,
                    alt.get('name')
                )
            else:
                alt_value = alt.get('value', '')
            
            # Round numeric values to 3 decimal places
            if alt_value != '' and alt_value is not None:
                try:
                    alt_value = round(float(alt_value), 3)
                except (TypeError, ValueError):
                    pass
            
            writer.writerow([
                criterion_name,
                unit,
                alt.get('name', ''),
                alt_value,
            ])
    return output.getvalue()

def _build_qualitative_csv(criteria, qualitative_indicators):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['CRITERION_NAME', 'ALTERNATIVE', 'RANK', 'VALUE', 'CONFIDENCE'])
    for criterion in criteria:
        if not isinstance(criterion, dict) or not criterion.get('is_qualitative'):
            continue
        name = criterion.get('criterion_name', '')
        data = qualitative_indicators.get(name, {}) if name else {}
        ranking = data.get('ranking') if isinstance(data, dict) else None
        confidences = data.get('confidences', {}) if isinstance(data, dict) else {}
        if not isinstance(ranking, dict):
            continue
        alternatives = criterion.get('alternatives', [])
        for alt in alternatives:
            if not isinstance(alt, dict):
                continue
            alt_name = alt.get('name')
            if not alt_name:
                continue
            rank = ranking.get(alt_name)
            value = _get_qualitative_alt_value(qualitative_indicators, name, alt_name)
            confidence = 4
            if rank is not None and isinstance(confidences, dict):
                confidence = confidences.get(rank, confidences.get(str(rank), 4))
            writer.writerow([name, alt_name, rank if rank is not None else '', value, confidence])
    return output.getvalue()

def _generate_qualitative_value_function(qualitative_indicators, criterion_name):
    """Generate value function points for a qualitative indicator from its ranking and values"""
    if not isinstance(qualitative_indicators, dict):
        return []
    
    data = qualitative_indicators.get(criterion_name) if criterion_name else None
    if not isinstance(data, dict):
        return []
    
    ranking = data.get('ranking')
    values = data.get('values')
    is_increasing = data.get('isIncreasing', True)
    
    if not isinstance(ranking, dict) or not isinstance(values, dict):
        return []
    
    # Get unique ranks and sort them
    unique_ranks = sorted(set(ranking.values()))
    
    if len(unique_ranks) == 0:
        return []
    
    points = []
    total_points = len(unique_ranks) + 2  # hypothetical worst + ranks + hypothetical best
    
    # Add hypothetical worst point at x=0
    if is_increasing:
        points.append({'x': 0, 'y': 0})
    else:
        points.append({'x': 0, 'y': 1})
    
    # Add ranked alternatives (equally spaced on x-axis)
    # X-axis goes from left to right: worst (rank N-1) → best (rank 0)
    for idx, rank in enumerate(reversed(unique_ranks)):
        x_pos = idx + 1
        # Convert to normalized x-value (0 to 1 range)
        x_normalized = x_pos / (total_points - 1)
        
        # Get the adjusted y-value for this rank
        y_value = values.get(rank)
        if y_value is None:
            # Try with string key
            y_value = values.get(str(rank))
        if y_value is None:
            # Fallback to linear interpolation
            y_value = x_normalized
        
        points.append({'x': x_normalized, 'y': y_value})
    
    # Add hypothetical best point at x=1
    if is_increasing:
        points.append({'x': 1, 'y': 1})
    else:
        points.append({'x': 1, 'y': 0})
    
    return points

def _build_value_functions_csv(criteria, criteria_map, qualitative_indicators=None):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['CRITERION_NAME', 'CONFIDENCE', 'LIST OF POINTS'])

    if isinstance(criteria, list) and len(criteria) > 0:
        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue
            name = criterion.get('criterion_name')
            if not name:
                continue
            if criterion.get('is_qualitative'):
                # For qualitative indicators, generate value function from ranking and values
                points = _generate_qualitative_value_function(qualitative_indicators, name)
                # Get per-rank confidences, formatted as comma-separated values in order of ranks
                qual_data = qualitative_indicators.get(name) if isinstance(qualitative_indicators, dict) else None
                if isinstance(qual_data, dict) and 'confidences' in qual_data:
                    confidences_dict = qual_data.get('confidences', {})
                    # Extract confidence values in rank order
                    ranks = []
                    values = qual_data.get('values') if isinstance(qual_data.get('values'), dict) else None
                    ranking_map = qual_data.get('ranking') if isinstance(qual_data.get('ranking'), dict) else None
                    if values:
                        try:
                            ranks = sorted([int(r) for r in values.keys()])
                        except (TypeError, ValueError):
                            ranks = []
                    if not ranks and ranking_map:
                        ranks = sorted({int(r) for r in ranking_map.values()})
                    confidence_values = []
                    for rank in ranks:
                        confidence_values.append(str(confidences_dict.get(rank, confidences_dict.get(str(rank), 4))))
                    confidence = ','.join(confidence_values) if confidence_values else '4'
                else:
                    # Fallback: default confidence based on number of ranks
                    ranks = []
                    values = qual_data.get('values') if isinstance(qual_data, dict) else None
                    ranking_map = qual_data.get('ranking') if isinstance(qual_data, dict) else None
                    if isinstance(values, dict):
                        try:
                            ranks = sorted([int(r) for r in values.keys()])
                        except (TypeError, ValueError):
                            ranks = []
                    if not ranks and isinstance(ranking_map, dict):
                        ranks = sorted({int(r) for r in ranking_map.values()})
                    confidence = ','.join(['4'] * len(ranks)) if ranks else '4'
            else:
                cfg = criteria_map.get(name) if isinstance(criteria_map, dict) else None
                points = cfg.get('points') if isinstance(cfg, dict) else []
                confidence = cfg.get('confidence', 4) if isinstance(cfg, dict) else 4
            serialized = ''
            if isinstance(points, list):
                parts = []
                for p in points:
                    if not isinstance(p, dict):
                        continue
                    x = p.get('x')
                    y = p.get('y')
                    if x is None or y is None:
                        continue
                    try:
                        x_rounded = round(float(x), 3)
                        y_rounded = round(float(y), 3)
                        parts.append(f"{x_rounded}:{y_rounded}")
                    except (TypeError, ValueError):
                        continue
                serialized = ';'.join(parts)
            writer.writerow([name, confidence, serialized])
    else:
        for name, cfg in criteria_map.items():
            points = cfg.get('points') if isinstance(cfg, dict) else []
            confidence = cfg.get('confidence', 4) if isinstance(cfg, dict) else 4
            serialized = ''
            if isinstance(points, list):
                parts = []
                for p in points:
                    if not isinstance(p, dict):
                        continue
                    x = p.get('x')
                    y = p.get('y')
                    if x is None or y is None:
                        continue
                    try:
                        x_rounded = round(float(x), 3)
                        y_rounded = round(float(y), 3)
                        parts.append(f"{x_rounded}:{y_rounded}")
                    except (TypeError, ValueError):
                        continue
                serialized = ';'.join(parts)
            writer.writerow([name, confidence, serialized])
    return output.getvalue()

def _build_pile_bwt_csv(bwt_data):
    output = io.StringIO()
    writer = csv.writer(output)

    if isinstance(bwt_data, dict) and isinstance(bwt_data.get('comparisons'), list):
        writer.writerow(['REFERENCE_CRITERION', 'ADJUSTED_CRITERION', 'DATA_VALUE', 'TYPE', 'GROUP'])
        for comp in bwt_data.get('comparisons', []):
            if isinstance(comp, dict):
                data_value = comp.get('data_value', '')
                # Round numeric values to 3 decimal places
                if data_value != '' and data_value is not None:
                    try:
                        data_value = round(float(data_value), 3)
                    except (TypeError, ValueError):
                        pass
                writer.writerow([
                    comp.get('reference_criterion', ''),
                    comp.get('adjusted_criterion', ''),
                    data_value,
                    comp.get('type', ''),
                    comp.get('group', ''),
                ])
    else:
        writer.writerow(['VALUE'])
        writer.writerow([bwt_data])

    return output.getvalue()

# Export value functions as CSV
@bp.route('/session/<session_id>/value-functions/export', methods=['GET'])
def export_value_functions_csv(session_id):
    """Export value functions as CSV with serialized point lists"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        qualitative_indicators = session.get('qualitative_indicators') or {}
        value_functions = session.get('value_functions') or {}
        if not _is_value_functions_complete(criteria, value_functions):
            return jsonify({'error': 'Complete value functions before export'}), 400

        criteria_map = value_functions.get('criteria') if isinstance(value_functions, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}

        output = _build_value_functions_csv(criteria, criteria_map, qualitative_indicators)
        return send_file(
            io.BytesIO(output.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'value_functions_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export value functions as JSON
@bp.route('/session/<session_id>/value-functions/export-json', methods=['GET'])
def export_value_functions_json(session_id):
    """Export value functions as JSON"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        value_functions = session.get('value_functions') or {}
        if not _is_value_functions_complete(criteria, value_functions):
            return jsonify({'error': 'Complete value functions before export'}), 400

        criteria_map = value_functions.get('criteria') if isinstance(value_functions, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}

        combined_criteria = {}
        if isinstance(criteria, list) and len(criteria) > 0:
            for criterion in criteria:
                if not isinstance(criterion, dict):
                    continue
                name = criterion.get('criterion_name')
                if not name:
                    continue
                if criterion.get('is_qualitative'):
                    combined_criteria[name] = {
                        'points': [
                            {'x': 0, 'y': 0},
                            {'x': 1, 'y': 1},
                        ]
                    }
                else:
                    if name in criteria_map:
                        combined_criteria[name] = criteria_map[name]
        else:
            combined_criteria = criteria_map

        exported_value_functions = dict(value_functions) if isinstance(value_functions, dict) else {}
        exported_value_functions['criteria'] = combined_criteria

        payload = {
            'session_id': str(session.get('_id')),
            'name': session.get('name'),
            'value_functions': exported_value_functions,
        }

        return send_file(
            io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode()),
            mimetype='application/json',
            as_attachment=True,
            download_name=f'value_functions_{session.get("name", session_id)}.json'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Update BWT (Best-Worst Technique)
@bp.route('/session/<session_id>/bwt', methods=['PUT'])
def update_bwt(session_id):
    """Update BWT data"""
    data = request.json
    value = data.get('value')
    
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        if session.get('session_locked', False):
            return jsonify({'error': 'Session is locked'}), 423

        db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'bwt': value}}
        )
        return jsonify({'status': 'updated'}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export BWT as CSV
@bp.route('/session/<session_id>/bwt/export', methods=['GET'])
def export_bwt_csv(session_id):
    """Export BWT data as CSV"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        bwt_data = session.get('bwt') or {}
        comparisons = bwt_data.get('comparisons', [])

        if not comparisons:
            return jsonify({'error': 'No BWT data to export'}), 404

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['REFERENCE_CRITERION', 'ADJUSTED_CRITERION', 'DATA_VALUE', 'TYPE'])

        for comp in comparisons:
            if isinstance(comp, dict):
                writer.writerow([
                    comp.get('reference_criterion', ''),
                    comp.get('adjusted_criterion', ''),
                    comp.get('data_value', ''),
                    comp.get('type', '')
                ])

        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'bwt_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export input data as CSV
@bp.route('/session/<session_id>/export-input', methods=['GET'])
def export_input_csv(session_id):
    """Export session input data (criteria and alternatives) as CSV"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        qualitative_indicators = session.get('qualitative_indicators') or {}
        value_functions = session.get('value_functions') or {}
        if not _is_qualitative_complete(criteria, qualitative_indicators) or not _is_value_functions_complete(criteria, value_functions):
            return jsonify({'error': 'Complete qualitative indicators and value functions before export'}), 400
        
        output = _build_alternatives_csv(criteria, qualitative_indicators)
        return send_file(
            io.BytesIO(output.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'input_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export input data as JSON
@bp.route('/session/<session_id>/export-input-json', methods=['GET'])
def export_input_json(session_id):
    """Export session input data (criteria and alternatives) as JSON"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        qualitative_indicators = session.get('qualitative_indicators') or {}
        value_functions = session.get('value_functions') or {}
        if not _is_qualitative_complete(criteria, qualitative_indicators) or not _is_value_functions_complete(criteria, value_functions):
            return jsonify({'error': 'Complete qualitative indicators and value functions before export'}), 400

        updated_criteria = []
        if isinstance(criteria, list):
            for criterion in criteria:
                if not isinstance(criterion, dict):
                    continue
                updated = dict(criterion)
                alternatives = updated.get('alternatives')
                if isinstance(alternatives, list) and updated.get('is_qualitative'):
                    new_alts = []
                    for alt in alternatives:
                        if not isinstance(alt, dict):
                            continue
                        new_alt = dict(alt)
                        new_alt['value'] = _get_qualitative_alt_value(
                            qualitative_indicators,
                            updated.get('criterion_name'),
                            alt.get('name')
                        )
                        new_alts.append(new_alt)
                    updated['alternatives'] = new_alts
                updated_criteria.append(updated)

        payload = {
            'session_id': str(session.get('_id')),
            'name': session.get('name'),
            'criteria': updated_criteria,
        }

        return send_file(
            io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode()),
            mimetype='application/json',
            as_attachment=True,
            download_name=f'input_{session.get("name", session_id)}.json'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export raw input data as CSV
@bp.route('/session/<session_id>/export-input-raw', methods=['GET'])
def export_input_raw_csv(session_id):
    """Export raw session input data (criteria and alternatives) as CSV"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        if not isinstance(criteria, list) or len(criteria) == 0:
            return jsonify({'error': 'No input data to export'}), 404

        output = _build_input_raw_csv(criteria)
        return send_file(
            io.BytesIO(output.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'input_raw_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export qualitative indicators as CSV
@bp.route('/session/<session_id>/qualitative/export', methods=['GET'])
def export_qualitative_csv(session_id):
    """Export qualitative indicator rankings and values as CSV"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        qualitative_indicators = session.get('qualitative_indicators') or {}
        if not _is_qualitative_complete(criteria, qualitative_indicators):
            return jsonify({'error': 'Complete qualitative indicators before export'}), 400

        output = _build_qualitative_csv(criteria, qualitative_indicators)
        return send_file(
            io.BytesIO(output.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'qualitative_indicators_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export PILE-BWT as CSV
@bp.route('/session/<session_id>/pile/export', methods=['GET'])
def export_pile_csv(session_id):
    """Export PILE-BWT data as CSV"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        bwt_data = session.get('bwt')
        if bwt_data is None:
            return jsonify({'error': 'No PILE-BWT data to export'}), 404

        output = _build_pile_bwt_csv(bwt_data)
        return send_file(
            io.BytesIO(output.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'pile_bwt_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export PILE-BWT as JSON
@bp.route('/session/<session_id>/pile/export-json', methods=['GET'])
def export_pile_json(session_id):
    """Export PILE-BWT data as JSON"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        bwt_data = session.get('bwt')
        if bwt_data is None:
            return jsonify({'error': 'No PILE-BWT data to export'}), 404

        payload = {
            'session_id': str(session.get('_id')),
            'name': session.get('name'),
            'pile_bwt': bwt_data,
        }

        return send_file(
            io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode()),
            mimetype='application/json',
            as_attachment=True,
            download_name=f'pile_bwt_{session.get("name", session_id)}.json'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export combined outputs as ZIP
@bp.route('/session/<session_id>/export-all', methods=['GET'])
def export_all_outputs_zip(session_id):
    """Export alternatives, value functions, and PILE-BWT as a ZIP file"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        criteria = _resolve_session_criteria(session, db)
        qualitative_indicators = session.get('qualitative_indicators') or {}
        value_functions = session.get('value_functions') or {}
        bwt_data = session.get('bwt')

        if not _is_qualitative_complete(criteria, qualitative_indicators) or not _is_value_functions_complete(criteria, value_functions):
            return jsonify({'error': 'Complete qualitative indicators and value functions before export'}), 400

        if bwt_data is None:
            return jsonify({'error': 'Complete PILE-BWT before export'}), 400

        criteria_map = value_functions.get('criteria') if isinstance(value_functions, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}

        alternatives_csv = _build_alternatives_csv(criteria, qualitative_indicators)
        value_functions_csv = _build_value_functions_csv(criteria, criteria_map, qualitative_indicators)
        pile_csv = _build_pile_bwt_csv(bwt_data)

        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
            session_name = session.get('name', session_id)
            zf.writestr(f'alternatives_{session_name}.csv', alternatives_csv)
            zf.writestr(f'value_functions_{session_name}.csv', value_functions_csv)
            zf.writestr(f'pile_bwt_{session_name}.csv', pile_csv)

        output.seek(0)
        return send_file(
            output,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'outputs_{session.get("name", session_id)}.zip'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Export results as CSV
@bp.route('/session/<session_id>/export', methods=['GET'])
def export_csv(session_id):
    """Export session data as CSV"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        # Calculate sum and division
        values = [
            session.get('qualitative_indicators') or 0,
            session.get('value_functions') or 0,
            session.get('bwt') or 0
        ]
        total_sum = sum(values)
        division = total_sum / 3 if total_sum != 0 else 0
        
        # Create CSV in memory
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Field', 'Value'])
        writer.writerow(['Name', session.get('name')])
        writer.writerow(['Qualitative Indicators', session.get('qualitative_indicators')])
        writer.writerow(['Value Functions', session.get('value_functions')])
        writer.writerow(['PILE-BWT', session.get('bwt')])
        writer.writerow(['Sum', total_sum])
        writer.writerow(['Division (Sum / 3)', division])
        
        # Convert to bytes
        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'output_{session.get("name", session_id)}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400


# ============================================================================
# UP-MAVT WORKFLOW ENDPOINTS
# ============================================================================

@bp.route('/study-session/<study_session_id>/compute-weights', methods=['POST'])
def compute_weights_endpoint(study_session_id):
    """Create a task to compute weights for selected elicitation sessions."""
    data = request.json or {}
    selected_session_ids = data.get('selected_session_ids', [])

    if not selected_session_ids:
        return jsonify({'error': 'No sessions selected'}), 400

    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        # Cancel any existing pending/running compute_weights tasks for this study
        db.tasks.update_many(
            {
                'params.study_session_id': study_session_id,
                'type': 'compute_weights',
                'status': {'$in': ['pending', 'running']},
            },
            {'$set': {'status': 'cancelled'}}
        )

        task_doc = {
            'type': 'compute_weights',
            'status': 'pending',
            'params': {
                'study_session_id': study_session_id,
                'selected_session_ids': selected_session_ids,
            },
            'console_output': '',
            'created_at': datetime.utcnow(),
        }
        result = db.tasks.insert_one(task_doc)
        return jsonify({'task_id': str(result.inserted_id)}), 202

    except Exception:
        return jsonify({'error': 'Invalid study session ID'}), 400


@bp.route('/study-session/<study_session_id>/run-step', methods=['POST'])
def run_step_endpoint(study_session_id):
    """Create a task to run a UP-MAVT step (2-6)."""
    data = request.json or {}
    step_number = data.get('step_number')
    selected_session_ids = data.get('selected_session_ids', [])
    mc_iterations = data.get('mc_iterations', 1000)
    aggregation_method = data.get('aggregation_method', 'weighted_sum')
    mc_mode = data.get('mc_mode', 'non_strict')
    use_random_weights = data.get('use_random_weights', False)

    if step_number is None or step_number not in [2, 3, 4, 5, 6]:
        return jsonify({'error': 'Invalid step number (must be 2-6)'}), 400

    if not selected_session_ids:
        return jsonify({'error': 'No sessions selected'}), 400

    # Validate mc_iterations
    mc_iterations = max(100, min(5000, int(mc_iterations)))

    # Map aggregation method shortcodes
    agg_map = {
        'SUM': 'weighted_sum',
        'GEO': 'geometric_mean',
        'HAR': 'harmonic_mean',
        'weighted_sum': 'weighted_sum',
        'geometric_mean': 'geometric_mean',
        'harmonic_mean': 'harmonic_mean',
    }
    aggregation_method = agg_map.get(aggregation_method, 'weighted_sum')

    step_names = {
        2: 'Consensus Analysis (SMC)',
        3: 'Dominance Analysis (NSMC + Random Weights)',
        4: 'Compensation Analysis (NSMC + All Aggregations)',
        5: 'Uncertainty Analysis (SMC)',
        6: 'Final Results (NSMC)',
    }

    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        # Normalize qualitative indicator payloads to guarantee rank-level confidences.
        selected_object_ids = [_ensure_object_id(session_id) for session_id in selected_session_ids]
        selected_object_ids = [session_id for session_id in selected_object_ids if session_id is not None]
        if not selected_object_ids:
            return jsonify({'error': 'No valid session IDs selected'}), 400

        session_docs = list(db.sessions.find({'_id': {'$in': selected_object_ids}}))
        for session_doc in session_docs:
            session_study_id = _ensure_object_id(session_doc.get('study_session_id'))
            if session_study_id != ObjectId(study_session_id):
                continue
            criteria = _resolve_session_criteria(session_doc, db)
            current_qi = session_doc.get('qualitative_indicators')
            current_qi = current_qi if isinstance(current_qi, dict) else {}
            normalized_qi = _normalize_qualitative_indicators(criteria, current_qi)
            if normalized_qi != current_qi:
                db.sessions.update_one(
                    {'_id': session_doc.get('_id')},
                    {'$set': {'qualitative_indicators': normalized_qi}}
                )

        # Check weights are computed
        if not study.get('computed_weights'):
            return jsonify({'error': 'Compute weights first (Step 1)'}), 400

        # Cancel any existing pending/running tasks for this step
        db.tasks.update_many(
            {
                'params.study_session_id': study_session_id,
                'params.step_number': step_number,
                'type': 'run_step',
                'status': {'$in': ['pending', 'running']},
            },
            {'$set': {'status': 'cancelled'}}
        )

        task_doc = {
            'type': 'run_step',
            'status': 'pending',
            'params': {
                'study_session_id': study_session_id,
                'selected_session_ids': selected_session_ids,
                'step_number': step_number,
                'step_name': step_names.get(step_number, f'Step {step_number}'),
                'mc_iterations': mc_iterations,
                'aggregation_method': aggregation_method,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'opinion_weights': None,
            },
            'console_output': '',
            'created_at': datetime.utcnow(),
        }
        result = db.tasks.insert_one(task_doc)
        return jsonify({'task_id': str(result.inserted_id)}), 202

    except Exception:
        return jsonify({'error': 'Invalid study session ID'}), 400


@bp.route('/task/<task_id>/status', methods=['GET'])
def get_task_status(task_id):
    """Get the status and console output of a task."""
    db = current_app.db
    try:
        task = db.tasks.find_one({'_id': ObjectId(task_id)})
        if not task:
            return jsonify({'error': 'Task not found'}), 404

        return jsonify({
            'task_id': str(task['_id']),
            'type': task.get('type'),
            'status': task.get('status'),
            'console_output': task.get('console_output', ''),
            'error': task.get('error'),
            'created_at': task.get('created_at', '').isoformat() if task.get('created_at') else None,
            'started_at': task.get('started_at', '').isoformat() if task.get('started_at') else None,
            'completed_at': task.get('completed_at', '').isoformat() if task.get('completed_at') else None,
        }), 200

    except Exception:
        return jsonify({'error': 'Invalid task ID'}), 400


@bp.route('/task/<task_id>/cancel', methods=['POST'])
def cancel_task(task_id):
    """Cancel a pending or running task."""
    db = current_app.db
    try:
        result = db.tasks.update_one(
            {'_id': ObjectId(task_id), 'status': {'$in': ['pending', 'running']}},
            {'$set': {'status': 'cancelled', 'completed_at': datetime.utcnow()}}
        )
        if result.modified_count == 0:
            return jsonify({'error': 'Task not found or already completed'}), 404
        return jsonify({'status': 'cancelled'}), 200
    except Exception:
        return jsonify({'error': 'Invalid task ID'}), 400


@bp.route('/study-session/<study_session_id>/active-task', methods=['GET'])
def get_active_task(study_session_id):
    """Get the currently running or pending task for a study session."""
    db = current_app.db
    try:
        # Find any pending or running task for this study session
        task = db.tasks.find_one(
            {
                'params.study_session_id': study_session_id,
                'status': {'$in': ['pending', 'running']}
            },
            sort=[('created_at', -1)]  # Get the most recent one
        )
        
        if not task:
            return jsonify({'active_task': None}), 200
        
        return jsonify({
            'active_task': {
                'task_id': str(task['_id']),
                'type': task.get('type'),
                'status': task.get('status'),
                'console_output': task.get('console_output', ''),
                'params': task.get('params', {}),
                'created_at': task.get('created_at', '').isoformat() if task.get('created_at') else None,
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/study-session/<study_session_id>/reset-weights', methods=['POST'])
def reset_weights(study_session_id):
    """Reset computed weights and all step results."""
    db = current_app.db
    try:
        result = db.study_sessions.update_one(
            {'_id': ObjectId(study_session_id)},
            {'$unset': {
                'computed_weights': '',
                'step_2_results': '',
                'step_3_results': '',
                'step_4_results': '',
                'step_5_results': '',
                'step_6_results': '',
            }}
        )
        if result.matched_count == 0:
            return jsonify({'error': 'Study session not found'}), 404
        return jsonify({'status': 'reset'}), 200
    except Exception:
        return jsonify({'error': 'Invalid study session ID'}), 400


@bp.route('/study-session/<study_session_id>/reset-step/<int:step_number>', methods=['POST'])
def reset_step(study_session_id, step_number):
    """Reset results for a specific step."""
    if step_number not in [2, 3, 4, 5, 6]:
        return jsonify({'error': 'Invalid step number'}), 400
    db = current_app.db
    try:
        result = db.study_sessions.update_one(
            {'_id': ObjectId(study_session_id)},
            {'$unset': {f'step_{step_number}_results': ''}}
        )
        if result.matched_count == 0:
            return jsonify({'error': 'Study session not found'}), 404
        return jsonify({'status': 'reset'}), 200
    except Exception:
        return jsonify({'error': 'Invalid study session ID'}), 400


@bp.route('/study-session/<study_session_id>/workflow-status', methods=['GET'])
def get_workflow_status(study_session_id):
    """Get the workflow status for a study session (weights and step results)."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        computed_weights = study.get('computed_weights')
        weights_status = None
        if computed_weights:
            ts = computed_weights.get('timestamp')
            weights_status = {
                'computed': True,
                'timestamp': ts.isoformat() if ts else None,
                'session_count': len(computed_weights.get('weight_spaces', {})),
            }

        steps_status = {}
        for step_num in [2, 3, 4, 5, 6]:
            step_data = study.get(f'step_{step_num}_results')
            if step_data:
                ts = step_data.get('timestamp')
                step_info = {
                    'completed': True,
                    'timestamp': ts.isoformat() if ts else None,
                    'mc_iterations': step_data.get('mc_iterations'),
                    'mc_mode': step_data.get('mc_mode'),
                }
                if step_num == 4:
                    step_info['aggregation_methods'] = list(step_data.get('results_by_aggregation', {}).keys())
                else:
                    step_info['aggregation_method'] = step_data.get('aggregation_method')
                steps_status[str(step_num)] = step_info
            else:
                steps_status[str(step_num)] = {'completed': False}

        return jsonify({
            'weights': weights_status,
            'steps': steps_status,
        }), 200

    except Exception:
        return jsonify({'error': 'Invalid study session ID'}), 400


@bp.route('/study-session/<study_session_id>/weight-space/<session_id>', methods=['GET'])
def get_weight_space(study_session_id, session_id):
    """Get weight space data for a specific elicitation session (for plotting)."""
    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        computed_weights = study.get('computed_weights')
        if not computed_weights:
            return jsonify({'error': 'Weights not computed yet'}), 404

        weight_spaces = computed_weights.get('weight_spaces', {})
        ws = weight_spaces.get(session_id, {})

        if not ws:
            return jsonify({'error': 'Weight space not found for this session'}), 404

        return jsonify({'weight_space': ws}), 200

    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400


@bp.route('/study-session/<study_session_id>/step-results/<int:step_number>', methods=['GET'])
def get_step_results(study_session_id, step_number):
    """Get results for a specific step."""
    if step_number not in [2, 3, 4, 5, 6]:
        return jsonify({'error': 'Invalid step number'}), 400

    db = current_app.db
    try:
        study = db.study_sessions.find_one({'_id': ObjectId(study_session_id)})
        if not study:
            return jsonify({'error': 'Study session not found'}), 404

        step_data = study.get(f'step_{step_number}_results')
        if not step_data:
            return jsonify({'error': f'Step {step_number} results not found'}), 404

        # Serialize datetime
        if 'timestamp' in step_data and step_data['timestamp']:
            step_data['timestamp'] = step_data['timestamp'].isoformat()

        # For step 4, also serialize nested timestamps
        if step_number == 4 and 'results_by_aggregation' in step_data:
            for agg_key, agg_data in step_data['results_by_aggregation'].items():
                if isinstance(agg_data, dict) and 'timestamp' in agg_data:
                    if agg_data['timestamp']:
                        agg_data['timestamp'] = agg_data['timestamp'].isoformat()

        return jsonify(step_data), 200

    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400
