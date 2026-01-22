from flask import Blueprint, request, jsonify, current_app, send_file
from bson.objectid import ObjectId
from datetime import datetime
import csv
import io

bp = Blueprint('api', __name__, url_prefix='/api')

# Initialize session
@bp.route('/session', methods=['POST'])
def create_session():
    """Create a new session with initial name"""
    data = request.json
    name = data.get('name')
    
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    
    db = current_app.db
    session_doc = {
        'name': name,
        'qualitative_indicators': None,
        'value_functions': None,
        'pile_bwt': None,
        'created_at': datetime.utcnow()
    }
    
    result = db.sessions.insert_one(session_doc)
    return jsonify({'session_id': str(result.inserted_id)}), 201

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
            download_name=f'results_{session_id}.csv'
        )
    except:
        return jsonify({'error': 'Invalid session ID'}), 400
