"""Integration tests for workflow HTTP endpoints."""
import csv
import io

import pytest
from bson.objectid import ObjectId
from datetime import datetime, timezone


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

def setup_study_with_session(client):
    """Create a study session with input and one elicitation session.
    Returns (study_id, elicitation_session_id).
    """
    resp = client.post('/api/study-session', json={'code': f'WF-{ObjectId()}'})
    study_id = resp.json['study_session_id']
    client.put(f'/api/study-session/{study_id}/input', json={'criteria': VALID_CRITERIA})
    resp = client.post(
        f'/api/study-session/{study_id}/elicitation-session',
        json={'name': f'EXP-{ObjectId()}'},
    )
    session_id = resp.json['session_id']
    return study_id, session_id


def inject_computed_weights(app, study_id, session_id):
    """Directly insert computed_weights into MongoDB (simulates worker completion)."""
    from bson.objectid import ObjectId as OID
    app.db.study_sessions.update_one(
        {'_id': OID(study_id)},
        {'$set': {'computed_weights': {
            'pre_threshold_weight_solutions': {
                session_id: [
                    {'weights': {'Cost': 0.333}, 'error': 0.1234567},
                    {'weights': {'Cost': 0.667}, 'error': 0.7654321},
                ]
            },
            'weight_solutions': {session_id: [{'Cost': 1.0}]},
            'timestamp': datetime.now(timezone.utc),
        }}}
    )


# ---------------------------------------------------------------------------
# POST /api/study-session/<id>/compute-weights
# ---------------------------------------------------------------------------

class TestComputeWeights:
    def test_creates_task(self, client):
        study_id, session_id = setup_study_with_session(client)
        resp = client.post(
            f'/api/study-session/{study_id}/compute-weights',
            json={'selected_session_ids': [session_id]},
        )
        assert resp.status_code == 202
        assert 'task_id' in resp.json

    def test_no_sessions_fails(self, client):
        study_id, _ = setup_study_with_session(client)
        resp = client.post(
            f'/api/study-session/{study_id}/compute-weights',
            json={'selected_session_ids': []},
        )
        assert resp.status_code == 400

    def test_unknown_study_fails(self, client):
        resp = client.post(
            f'/api/study-session/{ObjectId()}/compute-weights',
            json={'selected_session_ids': ['x']},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/task/<id>/status
# ---------------------------------------------------------------------------

class TestTaskStatus:
    def test_status_pending_after_create(self, client):
        study_id, session_id = setup_study_with_session(client)
        task_resp = client.post(
            f'/api/study-session/{study_id}/compute-weights',
            json={'selected_session_ids': [session_id]},
        )
        task_id = task_resp.json['task_id']
        resp = client.get(f'/api/task/{task_id}/status')
        assert resp.status_code == 200
        assert resp.json['status'] == 'pending'
        assert resp.json['type'] == 'compute_weights'

    def test_status_not_found(self, client):
        resp = client.get(f'/api/task/{ObjectId()}/status')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/task/<id>/cancel
# ---------------------------------------------------------------------------

class TestCancelTask:
    def test_cancel_pending_task(self, client):
        study_id, session_id = setup_study_with_session(client)
        task_resp = client.post(
            f'/api/study-session/{study_id}/compute-weights',
            json={'selected_session_ids': [session_id]},
        )
        task_id = task_resp.json['task_id']
        cancel_resp = client.post(f'/api/task/{task_id}/cancel')
        assert cancel_resp.status_code == 200
        assert cancel_resp.json['status'] == 'cancelled'
        # Verify status changed
        status_resp = client.get(f'/api/task/{task_id}/status')
        assert status_resp.json['status'] == 'cancelled'

    def test_cancel_nonexistent_task(self, client):
        resp = client.post(f'/api/task/{ObjectId()}/cancel')
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/study-session/<id>/active-task
# ---------------------------------------------------------------------------

class TestActiveTask:
    def test_no_active_task_initially(self, client):
        study_id, _ = setup_study_with_session(client)
        resp = client.get(f'/api/study-session/{study_id}/active-task')
        assert resp.status_code == 200
        assert resp.json['active_task'] is None

    def test_active_task_present_after_create(self, client):
        study_id, session_id = setup_study_with_session(client)
        client.post(
            f'/api/study-session/{study_id}/compute-weights',
            json={'selected_session_ids': [session_id]},
        )
        resp = client.get(f'/api/study-session/{study_id}/active-task')
        assert resp.json['active_task'] is not None
        assert resp.json['active_task']['status'] == 'pending'


# ---------------------------------------------------------------------------
# POST /api/study-session/<id>/reset-weights
# ---------------------------------------------------------------------------

class TestResetWeights:
    def test_reset_weights_not_found(self, client):
        resp = client.post(f'/api/study-session/{ObjectId()}/reset-weights')
        assert resp.status_code == 404

    def test_reset_weights_ok(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        # Verify weights are present
        status_resp = client.get(f'/api/study-session/{study_id}/workflow-status')
        assert status_resp.json['weights'] is not None
        # Reset
        resp = client.post(f'/api/study-session/{study_id}/reset-weights')
        assert resp.status_code == 200
        # Verify weights are gone
        status_resp2 = client.get(f'/api/study-session/{study_id}/workflow-status')
        assert status_resp2.json['weights'] is None


# ---------------------------------------------------------------------------
# POST /api/study-session/<id>/run-step
# ---------------------------------------------------------------------------

class TestRunStep:
    def test_run_step_without_weights_fails(self, client):
        study_id, session_id = setup_study_with_session(client)
        resp = client.post(
            f'/api/study-session/{study_id}/run-step',
            json={
                'step_number': 2,
                'selected_session_ids': [session_id],
                'mc_iterations': 500,
                'aggregation_method': 'weighted_sum',
                'mc_mode': 'non_strict',
                'use_random_weights': False,
            },
        )
        assert resp.status_code == 400

    def test_run_step_with_weights_ok(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        resp = client.post(
            f'/api/study-session/{study_id}/run-step',
            json={
                'step_number': 2,
                'selected_session_ids': [session_id],
                'mc_iterations': 200,
                'aggregation_method': 'weighted_sum',
                'mc_mode': 'non_strict',
                'use_random_weights': False,
            },
        )
        assert resp.status_code == 202
        assert 'task_id' in resp.json

    def test_run_step_invalid_step_number(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        resp = client.post(
            f'/api/study-session/{study_id}/run-step',
            json={
                'step_number': 99,
                'selected_session_ids': [session_id],
                'mc_iterations': 200,
                'aggregation_method': 'weighted_sum',
                'mc_mode': 'non_strict',
                'use_random_weights': False,
            },
        )
        assert resp.status_code == 400

    def test_run_step_no_sessions_fails(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        resp = client.post(
            f'/api/study-session/{study_id}/run-step',
            json={
                'step_number': 2,
                'selected_session_ids': [],
                'mc_iterations': 200,
                'aggregation_method': 'weighted_sum',
                'mc_mode': 'non_strict',
                'use_random_weights': False,
            },
        )
        assert resp.status_code == 400


class TestRunPagePreferences:
    def test_updates_confidence_adjustments(self, client):
        study_id, session_id = setup_study_with_session(client)
        resp = client.put(
            f'/api/study-session/{study_id}/workflow-preferences/run-page',
            json={'confidence_adjustments_by_session': {session_id: 1.5}},
        )
        assert resp.status_code == 200
        assert resp.json['preferences']['run_page']['confidence_adjustments_by_session'][session_id] == pytest.approx(1.5)


# ---------------------------------------------------------------------------
# GET /api/study-session/<id>/weight-solutions/export
# ---------------------------------------------------------------------------

class TestExportWeightSolutions:
    def test_export_without_weights_fails(self, client):
        study_id, _ = setup_study_with_session(client)
        resp = client.get(f'/api/study-session/{study_id}/weight-solutions/export')
        assert resp.status_code == 404

    def test_export_ok(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        resp = client.get(f'/api/study-session/{study_id}/weight-solutions/export')
        assert resp.status_code == 200
        assert 'text/csv' in resp.content_type
        assert 'charset=utf-8' in resp.content_type
        assert b'SESSION_ID' in resp.data
        assert b'ERROR' in resp.data


# ---------------------------------------------------------------------------
# GET /api/study-session/<id>/weight-solutions/<session_id>/export
# ---------------------------------------------------------------------------

class TestExportWeightSolutionsSingle:
    def test_export_single_ok(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        resp = client.get(
            f'/api/study-session/{study_id}/weight-solutions/{session_id}/export'
        )
        assert resp.status_code == 200
        rows = list(csv.reader(io.StringIO(resp.data.decode('utf-8-sig'))))
        assert rows[0] == ['SOLUTION_INDEX', 'Cost', 'ERROR']
        assert rows[1] == ['0', '0.333', '0.123457']

    def test_export_single_unknown_session_fails(self, app, client):
        study_id, session_id = setup_study_with_session(client)
        inject_computed_weights(app, study_id, session_id)
        resp = client.get(
            f'/api/study-session/{study_id}/weight-solutions/unknown-session/export'
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/study-session/<id>/reset-step/<step>
# ---------------------------------------------------------------------------

class TestResetStep:
    def test_reset_step_not_found(self, client):
        resp = client.post(f'/api/study-session/{ObjectId()}/reset-step/2')
        assert resp.status_code == 404

    def test_reset_step_ok_even_when_no_data(self, client):
        study_id, _ = setup_study_with_session(client)
        # Resetting a step that doesn't have results yet should still succeed
        resp = client.post(f'/api/study-session/{study_id}/reset-step/2')
        assert resp.status_code == 200
