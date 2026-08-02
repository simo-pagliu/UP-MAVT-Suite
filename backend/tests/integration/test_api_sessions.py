"""Integration tests for elicitation session HTTP endpoints."""
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

def create_session(client, name='TestSession', criteria=None):
    criteria = criteria or VALID_CRITERIA
    resp = client.post('/api/session', json={'name': name, 'criteria': criteria})
    assert resp.status_code == 201
    return resp.json['session_id']


# ---------------------------------------------------------------------------
# POST /api/session — create
# ---------------------------------------------------------------------------

class TestCreateSession:
    def test_create_ok(self, client):
        resp = client.post('/api/session', json={'name': 'S1', 'criteria': VALID_CRITERIA})
        assert resp.status_code == 201
        assert 'session_id' in resp.json

    def test_create_missing_name(self, client):
        resp = client.post('/api/session', json={'criteria': VALID_CRITERIA})
        assert resp.status_code == 400
        assert 'error' in resp.json

    def test_create_invalid_criteria(self, client):
        resp = client.post('/api/session', json={'name': 'X', 'criteria': []})
        assert resp.status_code == 400

    def test_create_missing_criteria_alternative_field(self, client):
        bad_criteria = [{'criterion_name': 'C', 'unit': 'km', 'alternatives': [{'name': 'A'}]}]
        resp = client.post('/api/session', json={'name': 'X', 'criteria': bad_criteria})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/session/<id>
# ---------------------------------------------------------------------------

class TestGetSession:
    def test_get_existing_session(self, client):
        sid = create_session(client)
        resp = client.get(f'/api/session/{sid}')
        assert resp.status_code == 200
        assert resp.json['name'] == 'TestSession'

    def test_get_nonexistent_session(self, client):
        resp = client.get(f'/api/session/{ObjectId()}')
        assert resp.status_code == 404

    def test_get_invalid_id(self, client):
        resp = client.get('/api/session/not-an-id')
        # Should either be 400 or 404 (NotFoundError catches invalid IDs)
        assert resp.status_code in (400, 404)


# ---------------------------------------------------------------------------
# GET /api/session/by-name/<name>
# ---------------------------------------------------------------------------

class TestGetSessionByName:
    def test_get_by_existing_name(self, client):
        create_session(client, name='unique-code')
        resp = client.get('/api/session/by-name/unique-code')
        assert resp.status_code == 200
        assert resp.json['exists'] is True
        assert resp.json['name'] == 'unique-code'

    def test_get_by_missing_name_returns_not_exists(self, client):
        resp = client.get('/api/session/by-name/ghost')
        assert resp.status_code == 200
        assert resp.json['exists'] is False


# ---------------------------------------------------------------------------
# GET /api/sessions
# ---------------------------------------------------------------------------

class TestGetAllSessions:
    def test_returns_list(self, client):
        create_session(client, 'A')
        create_session(client, 'B')
        resp = client.get('/api/sessions')
        assert resp.status_code == 200
        assert isinstance(resp.json, list)
        assert len(resp.json) == 2


# ---------------------------------------------------------------------------
# DELETE /api/session/<id>
# ---------------------------------------------------------------------------

class TestDeleteSession:
    def test_delete_existing(self, client):
        sid = create_session(client)
        resp = client.delete(f'/api/session/{sid}')
        assert resp.status_code == 200
        assert resp.json['status'] == 'deleted'
        # Verify it's gone
        resp2 = client.get(f'/api/session/{sid}')
        assert resp2.status_code == 404

    def test_delete_nonexistent(self, client):
        resp = client.delete(f'/api/session/{ObjectId()}')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/session/<id>/lock
# ---------------------------------------------------------------------------

class TestToggleLock:
    def test_toggle_lock_on(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/lock')
        assert resp.status_code == 200
        assert resp.json['locked'] is True

    def test_toggle_lock_off(self, client):
        sid = create_session(client)
        client.put(f'/api/session/{sid}/lock')   # on
        resp = client.put(f'/api/session/{sid}/lock')  # off
        assert resp.json['locked'] is False

    def test_toggle_session_lock(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/lock-session')
        assert resp.status_code == 200
        assert resp.json['session_locked'] is True


# ---------------------------------------------------------------------------
# PUT /api/session/<id>/practitioner-settings
# ---------------------------------------------------------------------------

class TestUpdatePractitionerSettings:
    def test_update_ok(self, client):
        sid = create_session(client)
        resp = client.put(
            f'/api/session/{sid}/practitioner-settings',
            json={
                'practitioner_settings': {
                    'notes': 'Session note',
                    'overall_weight': 1.5,
                    'confidence_adjustments': {
                        'overall': -0.8,
                    },
                },
            },
        )
        assert resp.status_code == 200
        assert resp.json['practitioner_settings']['notes'] == 'Session note'
        assert resp.json['practitioner_settings']['overall_weight'] == 1.5
        assert resp.json['practitioner_settings']['confidence_adjustments']['overall'] == -0.8

    def test_invalid_payload_returns_400(self, client):
        sid = create_session(client)
        resp = client.put(
            f'/api/session/{sid}/practitioner-settings',
            json={'practitioner_settings': 'bad'},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# PUT /api/session/<id>/qualitative
# ---------------------------------------------------------------------------

class TestUpdateQualitative:
    def test_update_ok(self, client):
        sid = create_session(client)
        resp = client.put(
            f'/api/session/{sid}/qualitative',
            json={'value': {'Cost': {'ranking': {}, 'values': {}}}},
        )
        assert resp.status_code == 200

    def test_update_missing_json_body(self, client):
        sid = create_session(client)
        resp = client.put(
            f'/api/session/{sid}/qualitative',
            data='not json',
            content_type='text/plain',
        )
        assert resp.status_code in (400, 415)

    def test_update_missing_value_field(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/qualitative', json={})
        assert resp.status_code == 400

    def test_update_locked_session_returns_423(self, client):
        sid = create_session(client)
        client.put(f'/api/session/{sid}/lock-session')
        resp = client.put(f'/api/session/{sid}/qualitative', json={'value': {}})
        assert resp.status_code == 423


# ---------------------------------------------------------------------------
# PUT /api/session/<id>/value
# ---------------------------------------------------------------------------

class TestUpdateValue:
    def test_update_ok(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/value', json={'value': {'criteria': {}}})
        assert resp.status_code == 200

    def test_missing_json_returns_400(self, client):
        sid = create_session(client)
        resp = client.put(
            f'/api/session/{sid}/value',
            data='x',
            content_type='text/plain',
        )
        assert resp.status_code in (400, 415)

    def test_missing_value_returns_400(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/value', json={})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# PUT /api/session/<id>/bwt
# ---------------------------------------------------------------------------

class TestUpdateBwt:
    def test_update_ok(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/bwt', json={'value': {'comparisons': []}})
        assert resp.status_code == 200

    def test_missing_value_returns_400(self, client):
        sid = create_session(client)
        resp = client.put(f'/api/session/{sid}/bwt', json={})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# PUT /api/session/<id>/criteria
# ---------------------------------------------------------------------------

class TestUpdateCriteria:
    def test_update_ok(self, client):
        sid = create_session(client)
        new_criteria = [
            {
                'criterion_name': 'Time',
                'unit': 'days',
                'alternatives': [{'name': 'A', 'value': '5'}],
            }
        ]
        resp = client.put(f'/api/session/{sid}/criteria', json={'criteria': new_criteria})
        assert resp.status_code == 200

    def test_update_locked_input_returns_423(self, client):
        sid = create_session(client)
        client.put(f'/api/session/{sid}/lock')  # lock input
        resp = client.put(f'/api/session/{sid}/criteria', json={'criteria': VALID_CRITERIA})
        assert resp.status_code == 423


# ---------------------------------------------------------------------------
# GET /api/session/detect/<code>
# ---------------------------------------------------------------------------

class TestDetectSession:
    def test_detects_stakeholder_session_by_uuid(self, client):
        sid = create_session(client, 'uuid-test-code')
        resp = client.get(f'/api/session/detect/{sid}')
        assert resp.status_code == 200
        assert resp.json['exists'] is True
        assert resp.json['type'] == 'stakeholder'
        assert resp.json['_id'] == sid
        assert resp.json['code'] == 'uuid-test-code'

    def test_uuid_lookup_unknown_returns_not_exists(self, client):
        resp = client.get(f'/api/session/detect/{ObjectId()}')
        assert resp.status_code == 200
        assert resp.json['exists'] is False


# ---------------------------------------------------------------------------
# GET /api/session/<id>/export
# ---------------------------------------------------------------------------

class TestExportSummary:
    def test_export_summary_csv_ok(self, client):
        sid = create_session(client)
        resp = client.get(f'/api/session/{sid}/export')
        assert resp.status_code == 200
        assert 'text/csv' in resp.content_type
        assert 'charset=utf-8' in resp.content_type
        assert b'Completed Sections' in resp.data

    def test_export_not_found(self, client):
        resp = client.get(f'/api/session/{ObjectId()}/export')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/session/<id>/export-input-raw
# ---------------------------------------------------------------------------

class TestExportInputRaw:
    def test_export_raw_ok(self, client):
        sid = create_session(client)
        resp = client.get(f'/api/session/{sid}/export-input-raw')
        assert resp.status_code == 200
        assert b'Cost' in resp.data
