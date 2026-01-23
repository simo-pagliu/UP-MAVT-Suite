from flask import Blueprint, request, jsonify, current_app, send_file
from bson.objectid import ObjectId
from datetime import datetime
import csv
import io
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

    # Validate new criteria format: each criterion has name, unit, group (optional), and alternatives
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
        'pile_bwt': None,
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
        result = db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'qualitative_indicators': value}}
        )
        if result.matched_count == 0:
            return jsonify({'error': 'Session not found'}), 404
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
        result = db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'value_functions': value}}
        )
        if result.matched_count == 0:
            return jsonify({'error': 'Session not found'}), 404
        return jsonify({'status': 'updated'}), 200
    except:
        return jsonify({'error': 'Invalid session ID'}), 400

# Update PILE-BWT
@bp.route('/session/<session_id>/pile', methods=['PUT'])
def update_pile(session_id):
    """Update PILE-BWT"""
    data = request.json
    value = data.get('value')
    
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    
    db = current_app.db
    try:
        result = db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'pile_bwt': value}}
        )
        if result.matched_count == 0:
            return jsonify({'error': 'Session not found'}), 404
        return jsonify({'status': 'updated'}), 200
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
            session.get('pile_bwt') or 0
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
        writer.writerow(['PILE-BWT', session.get('pile_bwt')])
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
