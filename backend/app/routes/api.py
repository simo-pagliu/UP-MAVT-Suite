from flask import Blueprint, request, jsonify, current_app, send_file
from bson.objectid import ObjectId
from datetime import datetime
import csv
import io
import json
import os
import zipfile

bp = Blueprint('api', __name__, url_prefix='/api')

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

# Initialize session
@bp.route('/session', methods=['POST'])
def create_session():
    """Create a new session with initial name and criteria"""
    data = request.json or {}
    name = data.get('name')
    criteria = data.get('criteria', [])

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    if not isinstance(criteria, list) or len(criteria) == 0:
        return jsonify({'error': 'At least one criterion is required'}), 400

    # Validate new criteria format: each criterion has name, unit, group (optional), description (optional), and alternatives
    required_fields = {'criterion_name', 'unit', 'alternatives'}
    for idx, criterion in enumerate(criteria):
        if not isinstance(criterion, dict):
            return jsonify({'error': f'Criterion {idx + 1} is not valid'}), 400
        if not required_fields.issubset(criterion.keys()):
            return jsonify({'error': f'Criterion {idx + 1} is missing required fields'}), 400
        # Ensure group field exists and is a string
        if 'group' not in criterion:
            criterion['group'] = ''
        if not isinstance(criterion.get('group'), str):
            return jsonify({'error': f'Criterion {idx + 1} group must be a string'}), 400
        # Ensure description field exists and is a string
        if 'description' not in criterion:
            criterion['description'] = ''
        if not isinstance(criterion.get('description'), str):
            return jsonify({'error': f'Criterion {idx + 1} description must be a string'}), 400
        if not isinstance(criterion.get('alternatives'), list):
            return jsonify({'error': f'Criterion {idx + 1} alternatives must be a list'}), 400
        for alt_idx, alt in enumerate(criterion['alternatives']):
            if not isinstance(alt, dict) or 'name' not in alt or 'value' not in alt:
                return jsonify({'error': f'Criterion {idx + 1}, alternative {alt_idx + 1} is invalid'}), 400

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

# Get all sessions (for admin)
@bp.route('/sessions', methods=['GET'])
def get_all_sessions():
    """Retrieve all sessions"""
    db = current_app.db
    sessions = list(db.sessions.find().sort('created_at', -1))
    for session in sessions:
        session['_id'] = str(session['_id'])
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

    if not isinstance(criteria, list) or len(criteria) == 0:
        return jsonify({'error': 'At least one criterion is required'}), 400

    # Validate criteria format
    required_fields = {'criterion_name', 'unit', 'alternatives'}
    for idx, criterion in enumerate(criteria):
        if not isinstance(criterion, dict):
            return jsonify({'error': f'Criterion {idx + 1} is not valid'}), 400
        if not required_fields.issubset(criterion.keys()):
            return jsonify({'error': f'Criterion {idx + 1} is missing required fields'}), 400
        if 'group' not in criterion:
            criterion['group'] = ''
        if not isinstance(criterion.get('group'), str):
            return jsonify({'error': f'Criterion {idx + 1} group must be a string'}), 400
        if not isinstance(criterion.get('alternatives'), list):
            return jsonify({'error': f'Criterion {idx + 1} alternatives must be a list'}), 400
        for alt_idx, alt in enumerate(criterion['alternatives']):
            if not isinstance(alt, dict) or 'name' not in alt or 'value' not in alt:
                return jsonify({'error': f'Criterion {idx + 1}, alternative {alt_idx + 1} is invalid'}), 400

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
        old_criteria = session.get('criteria', [])
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

        result = db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'criteria': criteria, 'value_functions': value_functions, 'qualitative_indicators': qualitative_indicators}}
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

        db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'qualitative_indicators': value}}
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

        criteria = session.get('criteria', [])
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

        criteria = session.get('criteria', [])
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

        criteria = session.get('criteria', [])
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

        criteria = session.get('criteria', [])
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

        criteria = session.get('criteria', [])
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

        criteria = session.get('criteria', [])
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

        criteria = session.get('criteria', [])
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
