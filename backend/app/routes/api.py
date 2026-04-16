from flask import Blueprint, request, jsonify, current_app, send_file, make_response
import functools
import hmac
import io
import json
import logging
import os
from pathlib import Path
import zipfile

from app.exceptions import ServiceError
from app.services import (
    AuthenticationService,
    SessionService,
    StudySessionService,
    ExportService,
    WorkflowService,
    EmailService,
    EmailVerificationService,
)

bp = Blueprint('api', __name__, url_prefix='/api')
logger = logging.getLogger(__name__)
EXAMPLES_DIR = Path(__file__).resolve().parents[2] / 'examples'

# --------------------------------------------------------------------------- #
# Cookie helpers
# --------------------------------------------------------------------------- #
_COOKIE_ACCESS_TOKEN = 'adm_access_token'
_COOKIE_REFRESH_TOKEN = 'adm_refresh_token'
_COOKIE_PATH = '/api'

# Access-token lifetime matches the JWT (15 min); refresh-token lifetime matches
# the JWT (7 days).  These control max_age on the Set-Cookie header so the
# browser discards the cookie when it can no longer be used.
_ACCESS_COOKIE_MAX_AGE = 15 * 60        # 900 seconds
_REFRESH_COOKIE_MAX_AGE = 7 * 24 * 3600  # 604 800 seconds


def _cookie_kwargs() -> dict:
    """Return common HTTPOnly cookie security kwargs.

    ``Secure`` is enabled only when ``FLASK_ENV=production`` is set so that
    local HTTP development still works.  ``SameSite=Strict`` prevents the
    cookies from being sent with cross-site requests (CSRF protection).
    """
    return {
        'httponly': True,
        'samesite': 'Strict',
        'secure': os.getenv('FLASK_ENV', '') == 'production',
        'path': _COOKIE_PATH,
    }


@bp.errorhandler(ServiceError)
def handle_service_error(e):
    return jsonify({'error': str(e)}), e.status_code


def require_admin_token(f):
    """Decorator that enforces admin JWT cookie authentication.

    Reads the ``adm_access_token`` HTTPOnly cookie, verifies the token with
    :meth:`AuthenticationService.verify_token`, and rejects requests that
    carry no cookie, an invalid token, or a token whose ``role`` is not
    ``'admin'``.
    """
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get(_COOKIE_ACCESS_TOKEN)
        payload = AuthenticationService.verify_token(token)
        if payload is None or payload.get('role') != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def _send(content, filename, mimetype):
    """Helper to send bytes or BytesIO as a file attachment."""
    buf = content if isinstance(content, io.BytesIO) else io.BytesIO(content)
    return send_file(buf, mimetype=mimetype, as_attachment=True, download_name=filename)


def _send_example_case_study(example_id, filename):
    zip_path = EXAMPLES_DIR / f'{example_id}.zip'
    if not zip_path.is_file():
        return jsonify({'error': f'Example case study {example_id} is unavailable'}), 404
    return send_file(zip_path, mimetype='application/zip', as_attachment=True, download_name=filename)


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
# Configuration
# --------------------------------------------------------------------------- #
@bp.route('/config/email-status', methods=['GET'])
def get_email_status():
    """Get the email system status (enabled or disabled)."""
    email_svc = EmailService()
    return jsonify({
        'email_enabled': not email_svc.is_disabled,
    }), 200


# --------------------------------------------------------------------------- #
# Email verification
# --------------------------------------------------------------------------- #
@bp.route('/email-verification/request', methods=['POST'])
def request_email_verification_code():
    email_svc = EmailService()
    
    if email_svc.is_disabled:
        return jsonify({
            'error': 'Email system is disabled. Cannot request verification code.',
        }), 400
    
    data = request.json or {}
    email = str(data.get('email') or '').strip()
    verification_svc = EmailVerificationService(current_app.db)

    issued = verification_svc.issue_code(email)
    if not issued.get('ok'):
        return jsonify({'error': issued.get('error', 'Invalid request')}), 400

    send_result = email_svc.send_email_verification_code(issued['email'], issued['code'])
    status = send_result.get('status')

    if status == 'sent':
        return jsonify({
            'status': 'sent',
            'expires_in_seconds': issued['expires_in_seconds'],
        }), 200

    if status == 'skipped':
        return jsonify({
            'error': 'Email sending is not configured on the server (SMTP_HOST missing)',
        }), 503

    return jsonify({
        'error': send_result.get('error', 'Failed to send verification email'),
    }), 502


@bp.route('/email-verification/confirm', methods=['POST'])
def confirm_email_verification_code():
    email_svc = EmailService()
    
    if email_svc.is_disabled:
        return jsonify({
            'error': 'Email system is disabled. Cannot confirm verification code.',
        }), 400
    
    data = request.json or {}
    email = str(data.get('email') or '').strip()
    code = str(data.get('code') or '').strip()

    verification_svc = EmailVerificationService(current_app.db)
    confirmed = verification_svc.confirm_code(email, code)
    if not confirmed.get('ok'):
        return jsonify({'error': confirmed.get('error', 'Invalid verification code')}), 400

    return jsonify({
        'status': 'verified',
        'verification_token': confirmed['verification_token'],
        'token_expires_in_seconds': confirmed['token_expires_in_seconds'],
    }), 200


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
@bp.route('/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or {}
    password = data.get('password')
    if not password:
        return jsonify({'success': False, 'error': 'Password is required'}), 400
    if AuthenticationService(current_app.db).authenticate(password):
        access_token = AuthenticationService.generate_access_token('admin')
        refresh_token = AuthenticationService.generate_refresh_token('admin')
        resp = make_response(jsonify({'success': True}), 200)
        resp.set_cookie(
            _COOKIE_ACCESS_TOKEN, access_token,
            max_age=_ACCESS_COOKIE_MAX_AGE, **_cookie_kwargs(),
        )
        resp.set_cookie(
            _COOKIE_REFRESH_TOKEN, refresh_token,
            max_age=_REFRESH_COOKIE_MAX_AGE, **_cookie_kwargs(),
        )
        return resp
    return jsonify({'success': False, 'error': 'Invalid password'}), 401


@bp.route('/admin/logout', methods=['POST'])
def admin_logout():
    """Clear admin auth cookies (invalidates the browser session)."""
    resp = make_response(jsonify({'success': True}), 200)
    resp.delete_cookie(_COOKIE_ACCESS_TOKEN, path=_COOKIE_PATH)
    resp.delete_cookie(_COOKIE_REFRESH_TOKEN, path=_COOKIE_PATH)
    return resp


@bp.route('/admin/refresh', methods=['POST'])
def admin_refresh_token():
    """Issue a new access token using a valid refresh token cookie."""
    token = request.cookies.get(_COOKIE_REFRESH_TOKEN)
    payload = AuthenticationService.verify_token(token)
    if (
        payload is None
        or payload.get('type') != 'refresh'
        or payload.get('role') != 'admin'
    ):
        return jsonify({'success': False, 'error': 'Invalid or expired refresh token'}), 401
    access_token = AuthenticationService.generate_access_token('admin')
    resp = make_response(jsonify({'success': True}), 200)
    resp.set_cookie(
        _COOKIE_ACCESS_TOKEN, access_token,
        max_age=_ACCESS_COOKIE_MAX_AGE, **_cookie_kwargs(),
    )
    return resp


@bp.route('/admin/verify', methods=['GET'])
@require_admin_token
def admin_verify():
    """Lightweight endpoint for the frontend to confirm a valid admin session."""
    return jsonify({'success': True}), 200


@bp.route('/admin/email-diagnostics', methods=['POST'])
@require_admin_token
def admin_email_diagnostics():
    """Run SMTP diagnostics (token + auth) without sending an email."""
    diagnostics = EmailService().diagnose_auth()
    response = {'success': diagnostics.get('status') == 'ok', **diagnostics}

    if diagnostics.get('status') == 'ok':
        return jsonify(response), 200
    if diagnostics.get('status') == 'skipped':
        return jsonify(response), 503
    return jsonify(response), 502


@bp.route('/admin/notify-inactive', methods=['POST'])
@require_admin_token
def notify_inactive_study_sessions():
    """Send inactivity warning emails for study sessions inactive for 12+ months.

    Accepts an optional JSON body:
    * ``months`` (int, default 12) – inactivity threshold in months.

    For each inactive study session that has a ``creator_email`` stored, a
    warning email with a ZIP backup attachment is sent.  The response
    summarises how many sessions were notified and any failures.
    """
    data = request.get_json(silent=True) or {}
    months = int(data.get('months', 12))
    svc = StudySessionService(current_app.db)
    email_svc = EmailService()
    inactive_sessions = svc.get_inactive_study_sessions(months=months)

    notified = []
    skipped = []
    failed = []

    for study in inactive_sessions:
        creator_email = study.get('creator_email', '').strip()
        if not creator_email:
            skipped.append({'code': study.get('code'), 'reason': 'no creator_email'})
            continue
        try:
            zip_buf, zip_filename, _ = svc.export_backup_zip(study['_id'])
            zip_bytes = zip_buf.read() if hasattr(zip_buf, 'read') else zip_buf
        except Exception as exc:  # noqa: BLE001
            logger.error('Failed to generate backup for %s: %s', study.get('code'), exc)
            zip_bytes = None
            zip_filename = f'backup_{study.get("code", study["_id"])}.zip'

        result = email_svc.send_inactivity_warning(
            creator_email,
            code=study.get('code', ''),
            study_session_id=study['_id'],
            months_inactive=study.get('months_inactive', months),
            zip_bytes=zip_bytes or b'',
            zip_filename=zip_filename,
        )
        entry = {'code': study.get('code'), 'email': creator_email, 'status': result.get('status')}
        if result.get('status') == 'failed':
            failed.append(entry)
        else:
            notified.append(entry)

    return jsonify({
        'success': True,
        'inactive_count': len(inactive_sessions),
        'notified': notified,
        'skipped': skipped,
        'failed': failed,
    }), 200


@bp.route('/admin/delete-inactive', methods=['POST'])
@require_admin_token
def delete_inactive_study_sessions():
    """Delete study sessions inactive for 12+ months (GDPR / data-retention).

    Accepts an optional JSON body:
    * ``months`` (int, default 12) – inactivity threshold in months.
    * ``send_backup_email`` (bool, default true) – when ``true`` a ZIP backup
      is emailed to the practitioner *before* the session is deleted.

    For each inactive session that has a ``creator_email`` stored, a final
    backup email is sent (if ``send_backup_email`` is true and SMTP is
    configured).  All associated elicitation sessions and input documents are
    then permanently removed.
    """
    data = request.json or {}
    months = int(data.get('months', 12))
    raw_send = data.get('send_backup_email')
    send_backup_email = raw_send is not False and str(raw_send).lower() not in ('false', '0', 'no')

    svc = StudySessionService(current_app.db)
    email_svc = EmailService()

    # Collect inactive sessions before deletion so we can send backup emails.
    inactive_sessions = svc.get_inactive_study_sessions(months=months)

    email_results = []
    if send_backup_email:
        for study in inactive_sessions:
            creator_email = study.get('creator_email', '').strip()
            if not creator_email:
                continue
            try:
                zip_buf, zip_filename, _ = svc.export_backup_zip(study['_id'])
                zip_bytes = zip_buf.read() if hasattr(zip_buf, 'read') else zip_buf
            except Exception as exc:  # noqa: BLE001
                logger.error('Failed to generate backup for %s: %s', study.get('code'), exc)
                # Skip the email rather than sending an empty ZIP; record the failure.
                email_results.append({
                    'code': study.get('code'),
                    'email': creator_email,
                    'email_status': 'backup_failed',
                })
                continue

            result = email_svc.send_inactivity_warning(
                creator_email,
                code=study.get('code', ''),
                study_session_id=study['_id'],
                months_inactive=study.get('months_inactive', months),
                zip_bytes=zip_bytes,
                zip_filename=zip_filename,
            )
            email_results.append({
                'code': study.get('code'),
                'email': creator_email,
                'email_status': result.get('status'),
            })

    deleted = svc.delete_inactive_study_sessions(months=months)

    return jsonify({
        'success': True,
        'inactive_count': len(inactive_sessions),
        'deleted_count': len(deleted),
        'deleted': deleted,
        'email_results': email_results,
    }), 200


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


@bp.route('/session/<session_id>/friendly-name', methods=['PUT'])
def update_session_friendly_name(session_id):
    data = request.json or {}
    friendly_name = data.get('friendly_name', '')
    updated = SessionService(current_app.db).update_friendly_name(session_id, friendly_name)
    return jsonify(updated), 200


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
        logger.error("ERROR in update_qualitative: %s", str(e), exc_info=True)
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
        logger.error("ERROR in update_value: %s", str(e), exc_info=True)
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


@bp.route('/session/<session_id>/complete', methods=['POST'])
def complete_elicitation_session(session_id):
    """Mark an elicitation session as complete and notify the practitioner.

    When the linked study session has a ``creator_email`` stored, a completion
    notification email is sent to the practitioner.
    """
    svc = StudySessionService(current_app.db)
    result = svc.complete_elicitation_session(session_id)
    session = result['session']
    study = result.get('study')

    email_status = None
    if study:
        practitioner_email = study.get('creator_email', '').strip()
        if practitioner_email:
            email_svc = EmailService()
            send_result = email_svc.send_session_completed(
                practitioner_email,
                stakeholder_name=session.get('name', session_id),
                code=study.get('code', ''),
                study_session_id=str(study.get('_id', '')),
            )
            email_status = send_result.get('status')

    response = {'status': 'completed', 'session_locked': True}
    if email_status is not None:
        response['email_status'] = email_status
    return jsonify(response), 200


# --------------------------------------------------------------------------- #
# Study sessions
# --------------------------------------------------------------------------- #
@bp.route('/study-session', methods=['POST'])
def create_study_session():
    data = request.json or {}
    svc = StudySessionService(current_app.db)
    email_svc = EmailService()
    
    code = data.get('code')
    auto_generate = bool(data.get('auto_generate', False))
    if not code and auto_generate:
        code = svc.generate_unique_study_code()
    
    creator_email = str(data.get('creator_email') or '').strip()
    
    # Email verification is required only if email is enabled
    if creator_email and not email_svc.is_disabled:
        verification_token = str(data.get('email_verification_token') or '').strip()
        verification_svc = EmailVerificationService(current_app.db)
        if not verification_svc.consume_verification_token(creator_email, verification_token):
            return jsonify({
                'error': 'Email verification required. Request and confirm a verification code first.',
            }), 400
    elif email_svc.is_disabled:
        # Email is disabled: creator_email must not be provided
        if creator_email:
            return jsonify({
                'error': 'Cannot provide creator_email when email system is disabled.',
            }), 400
    
    study_session_id = svc.create(
        code,
        title=data.get('title', ''),
        description=data.get('description', ''),
        creator_email=creator_email,
    )
    email_status = None
    if creator_email and not email_svc.is_disabled:
        result = email_svc.send_session_confirmation(creator_email, study_session_id)
        email_status = result.get('status')
    response = {'study_session_id': study_session_id, 'code': code}
    if email_status is not None:
        response['email_status'] = email_status
    return jsonify(response), 201


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
    result = None
    if 'features' in data or 'vf_method' in data:
        result = svc.update_features(
            study_session_id,
            data.get('features', {}),
            data.get('vf_method'),
        )
    if 'title' in data or 'description' in data:
        result = svc.update_metadata(
            study_session_id,
            title=data.get('title') if 'title' in data else None,
            description=data.get('description') if 'description' in data else None,
        )
    if result is None:
        result = svc.get_by_id(study_session_id)
    return jsonify(result), 200


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
def upload_case_study():
    upload = request.files.get('file')
    if upload is None:
        return jsonify({'error': 'Missing file upload'}), 400
    zip_bytes = upload.read()
    if not zip_bytes:
        return jsonify({'error': 'Uploaded file is empty'}), 400

    on_conflict = request.args.get('on_conflict', 'abort')
    contact_email = request.form.get('contact_email', '')
    preserve_creator_email = str(request.args.get('preserve_creator_email', '')).strip().lower() in (
        '1',
        'true',
        'yes',
        'on',
    )
    study_svc = StudySessionService(current_app.db)
    result = study_svc.import_study_case(
        zip_bytes,
        on_conflict=on_conflict,
        contact_email=contact_email,
        preserve_backup_email=preserve_creator_email,
    )
    email_status = None
    imported_study = study_svc.get_by_id(result.get('study_session_id'))
    creator_email = str(imported_study.get('creator_email') or '').strip()
    if creator_email:
        email_result = EmailService().send_session_confirmation(
            creator_email,
            result.get('study_session_id'),
        )
        email_status = email_result.get('status')
    if email_status is not None:
        result['email_status'] = email_status
    return jsonify(result), 201


@bp.route('/example-case-study/1', methods=['GET'])
def download_example_case_study_1():
    """Download example case study ZIP 1."""
    return _send_example_case_study(1, 'reference_case_study.zip')


@bp.route('/example-case-study/2', methods=['GET'])
def download_example_case_study_2():
    """Download example case study ZIP 2."""
    return _send_example_case_study(2, 'uncertain_two_decision_makers_case_study.zip')


@bp.route('/example-case-study/3', methods=['GET'])
def download_example_case_study_3():
    """Download example case study ZIP 3."""
    return _send_example_case_study(3, 'large_hierarchical_uncertain_case_study.zip')



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
    task_id = svc.create_compute_weights_task(
        study_session_id,
        data.get('selected_session_ids', []),
        data.get('use_non_linear_model', True),

        data.get('phase3_tolerance_pct', 1.0),
        data.get('weight_space_parameters', {}),
    )
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


@bp.route('/study-session/<study_session_id>/workflow-preferences/run-page', methods=['PUT'])
def update_run_page_preferences(study_session_id):
    data = request.json or {}
    result = WorkflowService(current_app.db).update_run_page_preferences(
        study_session_id,
        use_non_linear_model=data.get('use_non_linear_model'),
        selected_session_ids=data.get('selected_session_ids'),
    )
    return jsonify(result), 200


@bp.route('/study-session/<study_session_id>/weight-space/<session_id>', methods=['GET'])
def get_weight_space(study_session_id, session_id):
    data = WorkflowService(current_app.db).get_weight_space(study_session_id, session_id)
    return jsonify(data), 200


@bp.route('/study-session/<study_session_id>/step-results/<int:step_number>', methods=['GET'])
def get_step_results(study_session_id, step_number):
    return jsonify(WorkflowService(current_app.db).get_step_results(study_session_id, step_number)), 200


@bp.route('/study-session/<study_session_id>/workflow-export/data', methods=['GET'])
def export_workflow_data_zip(study_session_id):
    content, filename, mime = WorkflowService(current_app.db).export_workflow_data_zip(study_session_id)
    return _send(content, filename, mime)
