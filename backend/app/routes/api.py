from flask import Blueprint, request, jsonify, current_app, send_file
from bson.objectid import ObjectId
from datetime import datetime
import csv
import io
import json
import os

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

        result = db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'criteria': criteria}}
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

# Export value functions as CSV
@bp.route('/session/<session_id>/value-functions/export', methods=['GET'])
def export_value_functions_csv(session_id):
    """Export value functions as CSV with serialized point lists"""
    db = current_app.db
    try:
        session = db.sessions.find_one({'_id': ObjectId(session_id)})
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        value_functions = session.get('value_functions') or {}
        criteria_map = value_functions.get('criteria') if isinstance(value_functions, dict) else None
        if not criteria_map or not isinstance(criteria_map, dict):
            return jsonify({'error': 'No value functions to export'}), 404

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['CRITERION_NAME', 'LIST OF POINTS'])

        for name, cfg in criteria_map.items():
            points = cfg.get('points') if isinstance(cfg, dict) else []
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
                        parts.append(f"{float(x)}:{float(y)}")
                    except (TypeError, ValueError):
                        continue
                serialized = ';'.join(parts)
            writer.writerow([name, serialized])

        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode()),
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

        value_functions = session.get('value_functions') or {}
        if not value_functions:
            return jsonify({'error': 'No value functions to export'}), 404

        payload = {
            'session_id': str(session.get('_id')),
            'name': session.get('name'),
            'value_functions': value_functions,
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
        
        # Create CSV in memory
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Header row
        writer.writerow(['Session Name', session.get('name')])
        writer.writerow([])  # Empty row
        
        # Criteria and alternatives
        criteria = session.get('criteria', [])
        if criteria:
            writer.writerow(['Criterion', 'Unit', 'Alternative', 'Value'])
            for criterion in criteria:
                criterion_name = criterion.get('criterion_name', '')
                unit = criterion.get('unit', '')
                alternatives = criterion.get('alternatives', [])
                
                for alt in alternatives:
                    writer.writerow([
                        criterion_name,
                        unit,
                        alt.get('name', ''),
                        alt.get('value', '')
                    ])
        
        # Convert to bytes
        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode()),
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

        payload = {
            'session_id': str(session.get('_id')),
            'name': session.get('name'),
            'criteria': session.get('criteria', []),
        }

        return send_file(
            io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode()),
            mimetype='application/json',
            as_attachment=True,
            download_name=f'input_{session.get("name", session_id)}.json'
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

        output = io.StringIO()
        writer = csv.writer(output)

        if isinstance(bwt_data, dict) and isinstance(bwt_data.get('comparisons'), list):
            writer.writerow(['REFERENCE_CRITERION', 'ADJUSTED_CRITERION', 'DATA_VALUE', 'TYPE', 'GROUP'])
            for comp in bwt_data.get('comparisons', []):
                if isinstance(comp, dict):
                    writer.writerow([
                        comp.get('reference_criterion', ''),
                        comp.get('adjusted_criterion', ''),
                        comp.get('data_value', ''),
                        comp.get('type', ''),
                        comp.get('group', '')
                    ])
        else:
            writer.writerow(['VALUE'])
            writer.writerow([bwt_data])

        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode()),
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
