from flask import Blueprint, request, jsonify, current_app, send_file
import hmac
import io
import os

from app.exceptions import ServiceError
from app.services import SessionService, StudySessionService, ExportService, WorkflowService

bp = Blueprint('api', __name__, url_prefix='/api')


@bp.errorhandler(ServiceError)
def handle_service_error(e):
    return jsonify({'error': str(e)}), e.status_code


def _send(content, filename, mimetype):
    """Helper to send bytes or BytesIO as a file attachment."""
    buf = content if isinstance(content, io.BytesIO) else io.BytesIO(content)
    return send_file(buf, mimetype=mimetype, as_attachment=True, download_name=filename)


# --------------------------------------------------------------------------- #
# Health Check
# --------------------------------------------------------------------------- #
@bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint to verify backend and database connectivity."""
    try:
        # Try to perform a simple database operation
        current_app.db.command('ping')
        return jsonify({'status': 'ok', 'database': 'connected'}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'database': 'disconnected', 'error': str(e)}), 503


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
@bp.route('/admin/login', methods=['POST'])
def admin_login():
    data = request.json or {}
    password = data.get('password')
    if not password:
        return jsonify({'success': False, 'error': 'Password is required'}), 400
    admin_password = os.getenv('ADMIN_PASSWORD')
    if not admin_password:
        return jsonify({'success': False, 'error': 'ADMIN_PASSWORD is not configured on the server'}), 500
    if hmac.compare_digest(str(password), str(admin_password)):
        return jsonify({'success': True}), 200
    return jsonify({'success': False, 'error': 'Invalid password'}), 401


# --------------------------------------------------------------------------- #
# Session detection
# --------------------------------------------------------------------------- #
@bp.route('/session/detect/<code>', methods=['GET'])
def detect_session_type(code):
    svc = SessionService(current_app.db)
    return jsonify(svc.detect_type(code)), 200


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
@bp.route('/session', methods=['POST'])
def create_session():
    data = request.json or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    svc = SessionService(current_app.db)
    session_id = svc.create(name, data.get('criteria', []))
    return jsonify({'session_id': session_id}), 201


@bp.route('/sessions', methods=['GET'])
def get_all_sessions():
    return jsonify(SessionService(current_app.db).get_all()), 200


@bp.route('/session/by-name/<name>', methods=['GET'])
def get_session_by_name(name):
    result = SessionService(current_app.db).get_by_name(name)
    if result is None:
        return jsonify({'exists': False}), 200
    return jsonify(result), 200


@bp.route('/session/<session_id>', methods=['GET'])
def get_session(session_id):
    return jsonify(SessionService(current_app.db).get_by_id(session_id)), 200


@bp.route('/session/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    SessionService(current_app.db).delete(session_id)
    return jsonify({'status': 'deleted'}), 200


@bp.route('/session/<session_id>/criteria', methods=['PUT'])
def update_criteria(session_id):
    data = request.json or {}
    SessionService(current_app.db).update_criteria(session_id, data.get('criteria', []))
    return jsonify({'status': 'updated'}), 200


@bp.route('/session/<session_id>/lock', methods=['PUT'])
def toggle_session_lock(session_id):
    new_locked = SessionService(current_app.db).toggle_lock(session_id)
    return jsonify({'locked': new_locked}), 200


@bp.route('/session/<session_id>/lock-session', methods=['PUT'])
def toggle_full_session_lock(session_id):
    new_locked = SessionService(current_app.db).toggle_session_lock(session_id)
    return jsonify({'session_locked': new_locked}), 200


@bp.route('/session/<session_id>/qualitative', methods=['PUT'])
def update_qualitative(session_id):
    data = request.json
    if data is None:
        return jsonify({'error': 'Request must include Content-Type: application/json header with a valid JSON body'}), 400
    value = data.get('value')
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    try:
        SessionService(current_app.db).update_qualitative(session_id, value)
        return jsonify({'status': 'updated'}), 200
    except ServiceError:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR in update_qualitative: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal error: {str(e)}'}), 500


@bp.route('/session/<session_id>/value', methods=['PUT'])
def update_value(session_id):
    data = request.json
    if data is None:
        return jsonify({'error': 'Request must include Content-Type: application/json header with a valid JSON body'}), 400
    value = data.get('value')
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    try:
        SessionService(current_app.db).update_value_functions(session_id, value)
        return jsonify({'status': 'updated'}), 200
    except ServiceError:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR in update_value: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal error: {str(e)}'}), 500


@bp.route('/session/<session_id>/bwt', methods=['PUT'])
def update_bwt(session_id):
    data = request.json
    if data is None:
        return jsonify({'error': 'Request must include Content-Type: application/json header with a valid JSON body'}), 400
    value = data.get('value')
    if value is None:
        return jsonify({'error': 'Value is required'}), 400
    SessionService(current_app.db).update_bwt(session_id, value)
    return jsonify({'status': 'updated'}), 200


# --------------------------------------------------------------------------- #
# Study sessions
# --------------------------------------------------------------------------- #
@bp.route('/study-session', methods=['POST'])
def create_study_session():
    data = request.json or {}
    svc = StudySessionService(current_app.db)
    code = data.get('code')
    auto_generate = bool(data.get('auto_generate', False))
    if not code and auto_generate:
        code = svc.generate_unique_study_code()
    study_session_id = svc.create(code)
    return jsonify({'study_session_id': study_session_id, 'code': code}), 201


@bp.route('/study-sessions', methods=['GET'])
def get_all_study_sessions():
    return jsonify(StudySessionService(current_app.db).get_all()), 200


@bp.route('/study-session/by-code/<code>', methods=['GET'])
def get_study_session_by_code(code):
    return jsonify(StudySessionService(current_app.db).get_by_code(code)), 200


@bp.route('/study-session/<study_session_id>', methods=['GET'])
def get_study_session(study_session_id):
    return jsonify(StudySessionService(current_app.db).get_by_id(study_session_id)), 200


@bp.route('/study-session/<study_session_id>', methods=['PATCH'])
def update_study_session(study_session_id):
    data = request.json or {}
    svc = StudySessionService(current_app.db)
    if 'features' in data or 'vf_method' in data:
        result = svc.update_features(
            study_session_id,
            data.get('features', {}),
            data.get('vf_method'),
        )
        return jsonify(result), 200
    return jsonify(svc.get_by_id(study_session_id)), 200


@bp.route('/study-session/<study_session_id>', methods=['DELETE'])
def delete_study_session(study_session_id):
    StudySessionService(current_app.db).delete(study_session_id)
    return jsonify({'success': True}), 200


@bp.route('/study-session/<study_session_id>/input', methods=['PUT'])
def update_study_input(study_session_id):
    data = request.json or {}
    StudySessionService(current_app.db).update_input(study_session_id, data.get('criteria', []))
    return jsonify({'status': 'updated'}), 200


@bp.route('/study-session/<study_session_id>/input', methods=['GET'])
def get_study_input(study_session_id):
    criteria = StudySessionService(current_app.db).get_input(study_session_id)
    return jsonify({'criteria': criteria}), 200


@bp.route('/study-session/<study_session_id>/reset-sessions', methods=['POST'])
def reset_elicitation_sessions(study_session_id):
    deleted = StudySessionService(current_app.db).reset_elicitation_sessions(study_session_id)
    return jsonify({'status': 'reset', 'deleted_count': deleted}), 200


@bp.route('/study-session/<study_session_id>/selective-reset', methods=['POST'])
def selective_reset_sessions(study_session_id):
    data = request.json or {}
    affected_criteria = data.get('criteria', [])
    affected_groups = data.get('groups', [])
    result = StudySessionService(current_app.db).selective_reset_sessions(
        study_session_id, affected_criteria, affected_groups
    )
    return jsonify(result), 200


@bp.route('/study-session/<study_session_id>/elicitation-session', methods=['POST'])
def create_elicitation_session(study_session_id):
    data = request.json or {}
    svc = StudySessionService(current_app.db)
    name = data.get('name')
    auto_generate = bool(data.get('auto_generate', False))
    if not name and auto_generate:
        name = svc.generate_unique_session_code()
    session_id = svc.create_elicitation_session(study_session_id, name)
    return jsonify({'session_id': session_id, 'name': name}), 201


@bp.route('/study-session/<study_session_id>/elicitation-sessions', methods=['GET'])
def list_elicitation_sessions(study_session_id):
    return jsonify(StudySessionService(current_app.db).list_elicitation_sessions(study_session_id)), 200


@bp.route('/study-session/<study_session_id>/backup/export', methods=['GET'])
def export_study_backup(study_session_id):
    content, filename, mime = StudySessionService(current_app.db).export_backup_zip(study_session_id)
    return _send(content, filename, mime)


@bp.route('/study-session/backup/import', methods=['POST'])
def import_study_backup():
    upload = request.files.get('file')
    if upload is None:
        return jsonify({'error': 'Missing file upload'}), 400
    zip_bytes = upload.read()
    if not zip_bytes:
        return jsonify({'error': 'Uploaded file is empty'}), 400

    on_conflict = request.args.get('on_conflict', 'abort')
    result = StudySessionService(current_app.db).import_backup_zip(zip_bytes, on_conflict=on_conflict)
    return jsonify(result), 201


# --------------------------------------------------------------------------- #
# Export routes
# --------------------------------------------------------------------------- #
@bp.route('/session/<session_id>/value-functions/export', methods=['GET'])
def export_value_functions_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_value_functions_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/value-functions/export-json', methods=['GET'])
def export_value_functions_json(session_id):
    content, filename, mime = ExportService(current_app.db).export_value_functions_json(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/bwt/export', methods=['GET'])
def export_bwt_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_bwt_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/export-input', methods=['GET'])
def export_input_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_input_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/export-input-json', methods=['GET'])
def export_input_json(session_id):
    content, filename, mime = ExportService(current_app.db).export_input_json(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/export-input-raw', methods=['GET'])
def export_input_raw_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_input_raw_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/export-input-data', methods=['GET'])
def export_input_data_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_input_data_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/qualitative/export', methods=['GET'])
def export_qualitative_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_qualitative_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/pile/export', methods=['GET'])
def export_pile_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_pile_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/pile/export-debug', methods=['GET'])
def export_pile_debug_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_pile_debug_csv(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/pile/export-json', methods=['GET'])
def export_pile_json(session_id):
    content, filename, mime = ExportService(current_app.db).export_pile_json(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/export-all', methods=['GET'])
def export_all_outputs_zip(session_id):
    content, filename, mime = ExportService(current_app.db).export_all_outputs_zip(session_id)
    return _send(content, filename, mime)


@bp.route('/session/<session_id>/export', methods=['GET'])
def export_csv(session_id):
    content, filename, mime = ExportService(current_app.db).export_summary_csv(session_id)
    return _send(content, filename, mime)


# --------------------------------------------------------------------------- #
# Workflow
# --------------------------------------------------------------------------- #
@bp.route('/study-session/<study_session_id>/compute-weights', methods=['POST'])
def compute_weights_endpoint(study_session_id):
    data = request.json or {}
    svc = WorkflowService(current_app.db)
    task_id = svc.create_compute_weights_task(study_session_id, data.get('selected_session_ids', []))
    return jsonify({'task_id': task_id}), 202


@bp.route('/study-session/<study_session_id>/run-step', methods=['POST'])
def run_step_endpoint(study_session_id):
    data = request.json or {}
    svc = WorkflowService(current_app.db)
    task_id = svc.create_run_step_task(
        study_session_id,
        step_number=data.get('step_number'),
        selected_session_ids=data.get('selected_session_ids', []),
        mc_iterations=data.get('mc_iterations', 1000),
        aggregation_method=data.get('aggregation_method', 'weighted_sum'),
        mc_mode=data.get('mc_mode', 'non_strict'),
        use_random_weights=data.get('use_random_weights', False),
    )
    return jsonify({'task_id': task_id}), 202


@bp.route('/task/<task_id>/status', methods=['GET'])
def get_task_status(task_id):
    return jsonify(WorkflowService(current_app.db).get_task_status(task_id)), 200


@bp.route('/task/<task_id>/cancel', methods=['POST'])
def cancel_task(task_id):
    WorkflowService(current_app.db).cancel_task(task_id)
    return jsonify({'status': 'cancelled'}), 200


@bp.route('/study-session/<study_session_id>/active-task', methods=['GET'])
def get_active_task(study_session_id):
    task = WorkflowService(current_app.db).get_active_task(study_session_id)
    return jsonify({'active_task': task}), 200


@bp.route('/study-session/<study_session_id>/reset-weights', methods=['POST'])
def reset_weights(study_session_id):
    WorkflowService(current_app.db).reset_weights(study_session_id)
    return jsonify({'status': 'reset'}), 200


@bp.route('/study-session/<study_session_id>/reset-step/<int:step_number>', methods=['POST'])
def reset_step(study_session_id, step_number):
    WorkflowService(current_app.db).reset_step(study_session_id, step_number)
    return jsonify({'status': 'reset'}), 200


@bp.route('/study-session/<study_session_id>/weight-solutions/export', methods=['GET'])
def export_weight_solutions_csv(study_session_id):
    content, filename, mime = WorkflowService(current_app.db).export_weight_solutions_csv(study_session_id)
    return _send(content, filename, mime)


@bp.route('/study-session/<study_session_id>/weight-solutions/<session_id>/export', methods=['GET'])
def export_weight_solutions_csv_single_session(study_session_id, session_id):
    content, filename, mime = WorkflowService(current_app.db).export_weight_solutions_single_csv(study_session_id, session_id)
    return _send(content, filename, mime)


@bp.route('/study-session/<study_session_id>/workflow-status', methods=['GET'])
def get_workflow_status(study_session_id):
    return jsonify(WorkflowService(current_app.db).get_workflow_status(study_session_id)), 200


@bp.route('/study-session/<study_session_id>/weight-space/<session_id>', methods=['GET'])
def get_weight_space(study_session_id, session_id):
    data = WorkflowService(current_app.db).get_weight_space(study_session_id, session_id)
    return jsonify({'weight_space': data}), 200


@bp.route('/study-session/<study_session_id>/step-results/<int:step_number>', methods=['GET'])
def get_step_results(study_session_id, step_number):
    return jsonify(WorkflowService(current_app.db).get_step_results(study_session_id, step_number)), 200


@bp.route('/study-session/<study_session_id>/workflow-export/data', methods=['GET'])
def export_workflow_data_zip(study_session_id):
    content, filename, mime = WorkflowService(current_app.db).export_workflow_data_zip(study_session_id)
    return _send(content, filename, mime)
