"""Integration tests for study session HTTP endpoints."""
import io
import pytest
from bson.objectid import ObjectId


VALID_CRITERIA = [
    {
        'criterion_name': 'Cost',
        'unit': 'EUR',
        'alternatives': [
            {'name': 'A', 'value': '100'},
            {'name': 'B', 'value': '200'},
        ],
    }
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def create_study(client, code='STUDY-001'):
    resp = client.post('/api/study-session', json={'code': code})
    assert resp.status_code == 201
    return resp.json['study_session_id']


def set_input(client, study_id, criteria=None):
    criteria = criteria or VALID_CRITERIA
    resp = client.put(f'/api/study-session/{study_id}/input', json={'criteria': criteria})
    assert resp.status_code == 200


def create_elicitation_session(client, study_id, name='EXPERT-01'):
    resp = client.post(f'/api/study-session/{study_id}/elicitation-session', json={'name': name})
    assert resp.status_code == 201
    return resp.json['session_id']


# ---------------------------------------------------------------------------
# POST /api/study-session
# ---------------------------------------------------------------------------

class TestCreateStudySession:
    def test_create_ok(self, client):
        resp = client.post('/api/study-session', json={'code': 'ALPHA'})
        assert resp.status_code == 201
        assert 'study_session_id' in resp.json

    def test_create_empty_code(self, client):
        resp = client.post('/api/study-session', json={'code': ''})
        assert resp.status_code == 400

    def test_create_duplicate_code(self, client):
        client.post('/api/study-session', json={'code': 'DUP'})
        resp = client.post('/api/study-session', json={'code': 'DUP'})
        assert resp.status_code == 409

    def test_create_with_metadata(self, client):
        resp = client.post('/api/study-session', json={
            'code': 'META-CREATE',
            'title': 'Water Policy Study',
            'description': 'Stakeholder elicitation for the water policy case.',
        })
        assert resp.status_code == 201
        sid = resp.json['study_session_id']
        fetched = client.get(f'/api/study-session/{sid}')
        assert fetched.status_code == 200
        assert fetched.json['title'] == 'Water Policy Study'
        assert fetched.json['description'] == 'Stakeholder elicitation for the water policy case.'


# ---------------------------------------------------------------------------
# GET /api/study-sessions
# ---------------------------------------------------------------------------

class TestGetAllStudySessions:
    def test_returns_list(self, client):
        create_study(client, 'S1')
        create_study(client, 'S2')
        resp = client.get('/api/study-sessions')
        assert resp.status_code == 200
        assert len(resp.json) == 2


# ---------------------------------------------------------------------------
# GET /api/study-session/<id>
# ---------------------------------------------------------------------------

class TestGetStudySession:
    def test_get_existing(self, client):
        sid = create_study(client)
        resp = client.get(f'/api/study-session/{sid}')
        assert resp.status_code == 200
        assert resp.json['code'] == 'STUDY-001'

    def test_get_nonexistent(self, client):
        resp = client.get(f'/api/study-session/{ObjectId()}')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/study-session/by-code/<code>
# ---------------------------------------------------------------------------

class TestGetStudyByCode:
    def test_existing(self, client):
        create_study(client, 'CODE-XYZ')
        resp = client.get('/api/study-session/by-code/CODE-XYZ')
        assert resp.status_code == 200
        assert resp.json['exists'] is True

    def test_missing_returns_not_exists(self, client):
        resp = client.get('/api/study-session/by-code/ghost')
        assert resp.status_code == 200
        assert resp.json == {'exists': False}


# ---------------------------------------------------------------------------
# PATCH /api/study-session/<id>
# ---------------------------------------------------------------------------

class TestUpdateStudySession:
    def test_update_features_ok(self, client):
        sid = create_study(client)
        resp = client.patch(f'/api/study-session/{sid}', json={
            'features': {'qi': True, 'vf': False, 'bwt': True}
        })
        assert resp.status_code == 200
        assert resp.json['features']['qi'] is True
        assert resp.json['features']['bwt'] is True

    def test_patch_without_features_returns_study(self, client):
        sid = create_study(client)
        resp = client.patch(f'/api/study-session/{sid}', json={})
        assert resp.status_code == 200
        assert resp.json['code'] == 'STUDY-001'

    def test_update_vf_method_ok(self, client):
        sid = create_study(client)
        resp = client.patch(f'/api/study-session/{sid}', json={
            'vf_method': 'free-edit'
        })
        assert resp.status_code == 200
        assert resp.json['vf_method'] == 'free-edit'

    def test_update_metadata_ok(self, client):
        sid = create_study(client)
        resp = client.patch(f'/api/study-session/{sid}', json={
            'title': 'Case Alpha',
            'description': 'Description for stakeholders',
        })
        assert resp.status_code == 200
        assert resp.json['title'] == 'Case Alpha'
        assert resp.json['description'] == 'Description for stakeholders'


# ---------------------------------------------------------------------------
# DELETE /api/study-session/<id>
# ---------------------------------------------------------------------------

class TestDeleteStudySession:
    def test_delete_without_sessions(self, client):
        sid = create_study(client)
        resp = client.delete(f'/api/study-session/{sid}')
        assert resp.status_code == 200
        assert resp.json['success'] is True
        resp2 = client.get(f'/api/study-session/{sid}')
        assert resp2.status_code == 404

    def test_delete_with_active_sessions_fails(self, client):
        sid = create_study(client)
        set_input(client, sid)
        create_elicitation_session(client, sid)
        resp = client.delete(f'/api/study-session/{sid}')
        assert resp.status_code == 400

    def test_delete_nonexistent(self, client):
        resp = client.delete(f'/api/study-session/{ObjectId()}')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/study-session/<id>/input  &  GET /api/study-session/<id>/input
# ---------------------------------------------------------------------------

class TestStudyInput:
    def test_set_and_get_input(self, client):
        sid = create_study(client)
        set_input(client, sid)
        resp = client.get(f'/api/study-session/{sid}/input')
        assert resp.status_code == 200
        assert len(resp.json['criteria']) == 1

    def test_set_invalid_input_fails(self, client):
        sid = create_study(client)
        resp = client.put(f'/api/study-session/{sid}/input', json={'criteria': []})
        assert resp.status_code == 400

    def test_get_input_empty_returns_empty_list(self, client):
        sid = create_study(client)
        resp = client.get(f'/api/study-session/{sid}/input')
        assert resp.status_code == 200
        assert resp.json['criteria'] == []


# ---------------------------------------------------------------------------
# POST /api/study-session/<id>/elicitation-session
# ---------------------------------------------------------------------------

class TestCreateElicitationSession:
    def test_create_ok(self, client):
        sid = create_study(client)
        set_input(client, sid)
        resp = client.post(
            f'/api/study-session/{sid}/elicitation-session',
            json={'name': 'EXP-01'},
        )
        assert resp.status_code == 201
        assert 'session_id' in resp.json

    def test_create_without_input_fails(self, client):
        sid = create_study(client)
        resp = client.post(
            f'/api/study-session/{sid}/elicitation-session',
            json={'name': 'EXP-01'},
        )
        assert resp.status_code == 400

    def test_create_duplicate_name_fails(self, client):
        sid = create_study(client)
        set_input(client, sid)
        create_elicitation_session(client, sid, 'E1')
        resp = client.post(
            f'/api/study-session/{sid}/elicitation-session',
            json={'name': 'E1'},
        )
        assert resp.status_code == 409

    def test_create_empty_name_fails(self, client):
        sid = create_study(client)
        set_input(client, sid)
        resp = client.post(
            f'/api/study-session/{sid}/elicitation-session',
            json={'name': ''},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/study-session/<id>/elicitation-sessions
# ---------------------------------------------------------------------------

class TestListElicitationSessions:
    def test_list_sessions(self, client):
        sid = create_study(client)
        set_input(client, sid)
        create_elicitation_session(client, sid, 'E1')
        create_elicitation_session(client, sid, 'E2')
        resp = client.get(f'/api/study-session/{sid}/elicitation-sessions')
        assert resp.status_code == 200
        assert len(resp.json['sessions']) == 2

    def test_list_empty_when_no_sessions(self, client):
        sid = create_study(client)
        set_input(client, sid)
        resp = client.get(f'/api/study-session/{sid}/elicitation-sessions')
        assert resp.status_code == 200
        assert resp.json['sessions'] == []


# ---------------------------------------------------------------------------
# POST /api/study-session/<id>/reset-sessions
# ---------------------------------------------------------------------------

class TestResetElicitationSessions:
    def test_reset_removes_all_sessions(self, client):
        sid = create_study(client)
        set_input(client, sid)
        create_elicitation_session(client, sid, 'E1')
        create_elicitation_session(client, sid, 'E2')
        resp = client.post(f'/api/study-session/{sid}/reset-sessions')
        assert resp.status_code == 200
        assert resp.json['deleted_count'] == 2
        resp2 = client.get(f'/api/study-session/{sid}/elicitation-sessions')
        assert resp2.json['sessions'] == []


# ---------------------------------------------------------------------------
# GET /api/study-session/<id>/workflow-status
# ---------------------------------------------------------------------------

class TestWorkflowStatus:
    def test_workflow_status_new_study(self, client):
        sid = create_study(client)
        resp = client.get(f'/api/study-session/{sid}/workflow-status')
        assert resp.status_code == 200
        assert resp.json['weights'] is None
        for step_num in ['2', '3', '4', '5', '6']:
            assert resp.json['steps'][step_num]['completed'] is False


# ---------------------------------------------------------------------------
# POST /api/study-session  (creator_email + email_status)
# ---------------------------------------------------------------------------

class TestCreateStudySessionWithEmail:
    def test_create_with_creator_email_returns_email_status(self, client, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        resp = client.post('/api/study-session', json={
            'code': 'EMAIL-STUDY',
            'creator_email': 'owner@example.com',
        })
        assert resp.status_code == 201
        assert resp.json['study_session_id']
        assert resp.json['email_status'] == 'skipped'

    def test_create_without_creator_email_no_email_status(self, client):
        resp = client.post('/api/study-session', json={'code': 'NO-EMAIL'})
        assert resp.status_code == 201
        assert 'email_status' not in resp.json

    def test_create_stores_creator_email(self, client, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        resp = client.post('/api/study-session', json={
            'code': 'STORED-EMAIL',
            'creator_email': 'owner@example.com',
        })
        study_id = resp.json['study_session_id']
        study_resp = client.get(f'/api/study-session/{study_id}')
        assert study_resp.json.get('creator_email') == 'owner@example.com'


class TestImportStudyBackupWithEmail:
    def test_import_with_contact_email_returns_email_status(self, client, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)

        # Build a valid backup payload from an existing study.
        source_id = create_study(client, 'SRC-IMPORT-EMAIL')
        export_resp = client.get(f'/api/study-session/{source_id}/backup/export')
        assert export_resp.status_code == 200

        import_resp = client.post(
            '/api/study-session/backup/import?on_conflict=regenerate&preserve_creator_email=0',
            data={
                'file': (io.BytesIO(export_resp.data), 'backup.zip'),
                'contact_email': 'owner@example.com',
            },
            content_type='multipart/form-data',
        )

        assert import_resp.status_code == 201
        assert import_resp.json.get('email_status') == 'skipped'


# ---------------------------------------------------------------------------
# POST /api/session/<id>/complete
# ---------------------------------------------------------------------------

class TestCompleteElicitationSession:
    def test_complete_returns_completed_status(self, client):
        sid = create_study(client, 'COMPLETE-STUDY-1')
        set_input(client, sid)
        esid = create_elicitation_session(client, sid, 'EXPERT-A')
        resp = client.post(f'/api/session/{esid}/complete')
        assert resp.status_code == 200
        assert resp.json['status'] == 'completed'
        assert resp.json['session_locked'] is True

    def test_complete_sends_email_when_creator_email_set(self, client, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        # Create study with a creator email
        resp = client.post('/api/study-session', json={
            'code': 'EMAIL-NOTIFY-STUDY',
            'creator_email': 'practitioner@example.com',
        })
        sid = resp.json['study_session_id']
        set_input(client, sid)
        esid = create_elicitation_session(client, sid, 'EXPERT-B')
        complete_resp = client.post(f'/api/session/{esid}/complete')
        assert complete_resp.status_code == 200
        # SMTP not configured so email_status is skipped
        assert complete_resp.json['email_status'] == 'skipped'

    def test_complete_no_email_when_no_creator_email(self, client):
        sid = create_study(client, 'NO-EMAIL-STUDY-1')
        set_input(client, sid)
        esid = create_elicitation_session(client, sid, 'EXPERT-C')
        resp = client.post(f'/api/session/{esid}/complete')
        assert resp.status_code == 200
        assert 'email_status' not in resp.json

    def test_complete_not_found_returns_404(self, client):
        from bson.objectid import ObjectId
        resp = client.post(f'/api/session/{ObjectId()}/complete')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/admin/notify-inactive
# ---------------------------------------------------------------------------

class TestNotifyInactiveStudySessions:
    def test_requires_cookie(self, client):
        resp = client.post('/api/admin/notify-inactive', json={})
        assert resp.status_code == 401
        assert resp.json['success'] is False

    def test_wrong_cookie_returns_401(self, client):
        client.set_cookie('adm_access_token', 'badtoken', path='/api')
        resp = client.post('/api/admin/notify-inactive', json={})
        assert resp.status_code == 401

    def test_correct_cookie_returns_200(self, client):
        from app.services import AuthenticationService
        token = AuthenticationService.generate_access_token('admin')
        client.set_cookie('adm_access_token', token, path='/api')
        resp = client.post('/api/admin/notify-inactive', json={})
        assert resp.status_code == 200
        assert resp.json['success'] is True

    def test_inactive_sessions_no_email_are_skipped(self, client, mock_db):
        from datetime import datetime, timezone, timedelta
        from bson.objectid import ObjectId
        from app.services import AuthenticationService
        import os
        os.environ.pop('SMTP_HOST', None)
        # Create a study with no creator_email
        create_resp = client.post('/api/study-session', json={'code': 'OLD-STUDY-NOEMAIL'})
        sid = create_resp.json['study_session_id']
        old_date = datetime.now(timezone.utc) - timedelta(days=400)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'last_modified_at': old_date}},
        )
        token = AuthenticationService.generate_access_token('admin')
        client.set_cookie('adm_access_token', token, path='/api')
        resp = client.post('/api/admin/notify-inactive', json={})
        assert resp.status_code == 200
        assert any(s['code'] == 'OLD-STUDY-NOEMAIL' for s in resp.json['skipped'])

    def test_inactive_sessions_with_email_are_notified(self, client, mock_db):
        from datetime import datetime, timezone, timedelta
        from bson.objectid import ObjectId
        from app.services import AuthenticationService
        import os
        os.environ.pop('SMTP_HOST', None)
        create_resp = client.post('/api/study-session', json={
            'code': 'OLD-STUDY-EMAIL',
            'creator_email': 'owner@example.com',
        })
        sid = create_resp.json['study_session_id']
        old_date = datetime.now(timezone.utc) - timedelta(days=400)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'last_modified_at': old_date}},
        )
        token = AuthenticationService.generate_access_token('admin')
        client.set_cookie('adm_access_token', token, path='/api')
        resp = client.post('/api/admin/notify-inactive', json={})
        assert resp.status_code == 200
        # SMTP not configured → email is skipped; entry goes into notified with status='skipped'
        notified_or_skipped = resp.json['notified'] + resp.json['skipped']
        matching = [e for e in notified_or_skipped if e.get('code') == 'OLD-STUDY-EMAIL']
        assert len(matching) == 1
        assert matching[0].get('status') == 'skipped'

    def test_response_shape(self, client):
        from app.services import AuthenticationService
        token = AuthenticationService.generate_access_token('admin')
        client.set_cookie('adm_access_token', token, path='/api')
        resp = client.post('/api/admin/notify-inactive', json={})
        assert resp.status_code == 200
        data = resp.json
        assert 'inactive_count' in data
        assert 'notified' in data
        assert 'skipped' in data
        assert 'failed' in data


