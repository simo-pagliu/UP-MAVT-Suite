"""Integration tests for study session HTTP endpoints."""
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
