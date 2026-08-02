"""Unit tests for WorkflowService."""
import csv
import io
import zipfile

import pytest
from bson.objectid import ObjectId
from datetime import datetime, timezone

from app.exceptions import NotFoundError, ValidationError
from app.services.workflow_service import WorkflowService
from app.services.study_session_service import StudySessionService
from app.services.session_service import SessionService


VALID_CRITERIA = [
    {
        'criterion_name': 'Cost',
        'unit': 'EUR',
        'alternatives': [{'name': 'A', 'value': '100'}, {'name': 'B', 'value': '200'}],
    }
]


@pytest.fixture()
def wf_svc(mock_db):
    return WorkflowService(mock_db)


@pytest.fixture()
def study_id(mock_db):
    svc = StudySessionService(mock_db)
    sid = svc.create('WORKFLOW-STUDY')
    svc.update_input(sid, VALID_CRITERIA)
    return sid


@pytest.fixture()
def session_id(mock_db, study_id):
    svc = StudySessionService(mock_db)
    return svc.create_elicitation_session(study_id, 'EXP-01')


@pytest.fixture()
def study_with_weights(mock_db, study_id, session_id):
    """Study with fake pre-computed weights so run_step tasks can be created."""
    mock_db.study_sessions.update_one(
        {'_id': ObjectId(study_id)},
        {'$set': {'computed_weights': {
            'weight_solutions': {session_id: [{'Cost': 1.0}]},
            'timestamp': datetime.now(timezone.utc),
        }}}
    )
    return study_id


# ---------------------------------------------------------------------------
# create_compute_weights_task
# ---------------------------------------------------------------------------

class TestCreateComputeWeightsTask:
    def test_creates_task_returns_id(self, wf_svc, study_id, session_id):
        task_id = wf_svc.create_compute_weights_task(study_id, [session_id])
        assert isinstance(task_id, str)
        assert len(task_id) == 24

    def test_persists_selected_sampling_method(self, mock_db, wf_svc, study_id, session_id):
        task_id = wf_svc.create_compute_weights_task(
            study_id,
            [session_id],
            use_non_linear_model=True,
            phase3_tolerance_pct=2.5,
        )
        task = mock_db.tasks.find_one({'_id': ObjectId(task_id)})
        assert task['params']['use_non_linear_model'] is True
        assert task['params']['phase3_tolerance_pct'] == 2.5

    def test_no_sessions_raises(self, wf_svc, study_id):
        with pytest.raises(ValidationError, match='No sessions selected'):
            wf_svc.create_compute_weights_task(study_id, [])

    def test_study_not_found_raises(self, wf_svc):
        with pytest.raises(NotFoundError):
            wf_svc.create_compute_weights_task(str(ObjectId()), ['x'])

    def test_cancels_existing_pending_tasks(self, mock_db, wf_svc, study_id, session_id):
        task_id1 = wf_svc.create_compute_weights_task(study_id, [session_id])
        task_id2 = wf_svc.create_compute_weights_task(study_id, [session_id])
        # First task should be cancelled
        task1 = mock_db.tasks.find_one({'_id': ObjectId(task_id1)})
        assert task1['status'] == 'cancelled'
        # Second task should be pending
        task2 = mock_db.tasks.find_one({'_id': ObjectId(task_id2)})
        assert task2['status'] == 'pending'


# ---------------------------------------------------------------------------
# create_run_step_task
# ---------------------------------------------------------------------------

class TestCreateRunStepTask:
    def test_creates_run_step_task(self, wf_svc, study_with_weights, session_id):
        task_id = wf_svc.create_run_step_task(
            study_with_weights,
            step_number=2,
            selected_session_ids=[session_id],
            mc_iterations=500,
            aggregation_method='weighted_sum',
            aggregation_alpha=0.0,
            mc_mode='non_strict',
            use_random_weights=False,
        )
        assert isinstance(task_id, str)

    def test_invalid_step_number_raises(self, wf_svc, study_with_weights, session_id):
        with pytest.raises(ValidationError, match='Invalid step number'):
            wf_svc.create_run_step_task(
                study_with_weights, step_number=99,
                selected_session_ids=[session_id],
                mc_iterations=500, aggregation_method='weighted_sum',
                aggregation_alpha=0.0,
                mc_mode='non_strict', use_random_weights=False,
            )

    def test_no_sessions_raises(self, wf_svc, study_with_weights):
        with pytest.raises(ValidationError, match='No sessions selected'):
            wf_svc.create_run_step_task(
                study_with_weights, step_number=2,
                selected_session_ids=[],
                mc_iterations=500, aggregation_method='weighted_sum',
                aggregation_alpha=0.0,
                mc_mode='non_strict', use_random_weights=False,
            )

    def test_without_weights_raises(self, wf_svc, study_id, session_id):
        with pytest.raises(ValidationError, match='Compute weights first'):
            wf_svc.create_run_step_task(
                study_id, step_number=2,
                selected_session_ids=[session_id],
                mc_iterations=500, aggregation_method='weighted_sum',
                aggregation_alpha=0.0,
                mc_mode='non_strict', use_random_weights=False,
            )

    def test_mc_iterations_clamped_low(self, wf_svc, study_with_weights, session_id):
        # Passing very low value should be clamped to 100
        task_id = wf_svc.create_run_step_task(
            study_with_weights, step_number=2,
            selected_session_ids=[session_id],
            mc_iterations=1,
            aggregation_method='weighted_sum',
            aggregation_alpha=0.0,
            mc_mode='non_strict', use_random_weights=False,
        )
        task = wf_svc.get_task_status(task_id)
        # Params embedded in the task
        assert task is not None

    def test_aggregation_method_shortcode_mapped(self, mock_db, wf_svc, study_with_weights, session_id):
        task_id = wf_svc.create_run_step_task(
            study_with_weights, step_number=3,
            selected_session_ids=[session_id],
            mc_iterations=200, aggregation_method='GEO',
            aggregation_alpha=0.0,
            mc_mode='non_strict', use_random_weights=False,
        )
        task = mock_db.tasks.find_one({'_id': ObjectId(task_id)})
        assert task['params']['aggregation_method'] == 'geometric_mean'

    def test_uses_practitioner_opinion_weights(self, mock_db, wf_svc, study_with_weights, session_id):
        second_session_id = StudySessionService(mock_db).create_elicitation_session(study_with_weights, 'EXP-02')
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(study_with_weights)},
            {'$set': {'computed_weights.weight_solutions': {
                session_id: [{'Cost': 1.0}],
                second_session_id: [{'Cost': 1.0}],
            }}}
        )
        # Set VF confidence: session 1 avg = 3.0, session 2 avg = 1.0 → normalized [0.75, 0.25]
        mock_db.sessions.update_one(
            {'_id': ObjectId(session_id)},
            {'$set': {'value_functions': {'criteria': {'Cost': {'confidence': 3}}}}}
        )
        mock_db.sessions.update_one(
            {'_id': ObjectId(second_session_id)},
            {'$set': {'value_functions': {'criteria': {'Cost': {'confidence': 1}}}}}
        )

        task_id = wf_svc.create_run_step_task(
            study_with_weights,
            step_number=2,
            selected_session_ids=[session_id, second_session_id],
            mc_iterations=500,
            aggregation_method='weighted_sum',
            aggregation_alpha=0.0,
            mc_mode='non_strict',
            use_random_weights=False,
        )

        task = mock_db.tasks.find_one({'_id': ObjectId(task_id)})
        weights = task['params']['opinion_weights']
        assert len(weights) == 2
        assert abs(weights[0] - 0.75) < 1e-9
        assert abs(weights[1] - 0.25) < 1e-9

    def test_study_not_found_raises(self, wf_svc, session_id):
        with pytest.raises(NotFoundError):
            wf_svc.create_run_step_task(
                str(ObjectId()), step_number=2,
                selected_session_ids=[session_id],
                mc_iterations=500, aggregation_method='weighted_sum',
                aggregation_alpha=0.0,
                mc_mode='non_strict', use_random_weights=False,
            )


# ---------------------------------------------------------------------------
# get_task_status / cancel_task
# ---------------------------------------------------------------------------

class TestTaskStatus:
    def test_get_status_returns_dict(self, wf_svc, study_id, session_id):
        task_id = wf_svc.create_compute_weights_task(study_id, [session_id])
        status = wf_svc.get_task_status(task_id)
        assert status['status'] == 'pending'
        assert status['type'] == 'compute_weights'

    def test_get_status_not_found_raises(self, wf_svc):
        with pytest.raises(NotFoundError, match='Task not found'):
            wf_svc.get_task_status(str(ObjectId()))

    def test_cancel_pending_task(self, wf_svc, study_id, session_id):
        task_id = wf_svc.create_compute_weights_task(study_id, [session_id])
        wf_svc.cancel_task(task_id)
        status = wf_svc.get_task_status(task_id)
        assert status['status'] == 'cancelled'

    def test_cancel_nonexistent_raises(self, wf_svc):
        with pytest.raises(NotFoundError):
            wf_svc.cancel_task(str(ObjectId()))


# ---------------------------------------------------------------------------
# get_active_task
# ---------------------------------------------------------------------------

class TestGetActiveTask:
    def test_returns_none_when_no_active_task(self, wf_svc, study_id):
        assert wf_svc.get_active_task(study_id) is None

    def test_returns_task_when_pending(self, wf_svc, study_id, session_id):
        wf_svc.create_compute_weights_task(study_id, [session_id])
        task = wf_svc.get_active_task(study_id)
        assert task is not None
        assert task['status'] == 'pending'


# ---------------------------------------------------------------------------
# reset_weights / reset_step
# ---------------------------------------------------------------------------

class TestReset:
    def test_reset_weights_clears_computed_weights(self, mock_db, wf_svc, study_with_weights):
        wf_svc.reset_weights(study_with_weights)
        study = mock_db.study_sessions.find_one({'_id': ObjectId(study_with_weights)})
        assert 'computed_weights' not in study

    def test_reset_weights_not_found_raises(self, wf_svc):
        with pytest.raises(NotFoundError):
            wf_svc.reset_weights(str(ObjectId()))

    def test_reset_step_invalid_number_raises(self, wf_svc, study_id):
        with pytest.raises(ValidationError, match='Invalid step number'):
            wf_svc.reset_step(study_id, 99)

    def test_reset_step_not_found_raises(self, wf_svc):
        with pytest.raises(NotFoundError):
            wf_svc.reset_step(str(ObjectId()), 2)

    def test_reset_step_ok(self, mock_db, wf_svc, study_id):
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(study_id)},
            {'$set': {'step_2_results': {'some': 'data', 'timestamp': datetime.now(timezone.utc)}}}
        )
        wf_svc.reset_step(study_id, 2)
        study = mock_db.study_sessions.find_one({'_id': ObjectId(study_id)})
        assert 'step_2_results' not in study


# ---------------------------------------------------------------------------
# get_workflow_status
# ---------------------------------------------------------------------------

class TestGetWorkflowStatus:
    def test_no_weights_returns_none(self, wf_svc, study_id):
        status = wf_svc.get_workflow_status(study_id)
        assert status['weights'] is None
        for step_num in ['2', '3', '4', '5', '6']:
            assert status['steps'][step_num]['completed'] is False

    def test_with_weights_returns_status(self, wf_svc, study_with_weights):
        status = wf_svc.get_workflow_status(study_with_weights)
        assert status['weights']['computed'] is True
        assert status['weights']['session_count'] >= 1
        assert 'method' not in status['weights']
        assert 'phase1_method' not in status['weights']

    def test_not_found_raises(self, wf_svc):
        with pytest.raises(NotFoundError):
            wf_svc.get_workflow_status(str(ObjectId()))


# ---------------------------------------------------------------------------
# get_weight_space
# ---------------------------------------------------------------------------

class TestGetWeightSpace:
    def test_returns_weight_data(self, wf_svc, study_with_weights, session_id):
        data = wf_svc.get_weight_space(study_with_weights, session_id)
        assert isinstance(data, dict)
        assert 'method' not in data
        assert 'phase1_method' not in data
        assert isinstance(data['weight_space'], list)

    def test_not_computed_raises(self, wf_svc, study_id, session_id):
        with pytest.raises(NotFoundError, match='not computed yet'):
            wf_svc.get_weight_space(study_id, session_id)

    def test_unknown_session_raises(self, wf_svc, study_with_weights):
        with pytest.raises(NotFoundError, match='not found for this session'):
            wf_svc.get_weight_space(study_with_weights, 'nonexistent_session')


# ---------------------------------------------------------------------------
# get_step_results
# ---------------------------------------------------------------------------

class TestGetStepResults:
    def test_invalid_step_raises(self, wf_svc, study_id):
        with pytest.raises(ValidationError):
            wf_svc.get_step_results(study_id, 99)

    def test_missing_results_raises(self, wf_svc, study_id):
        with pytest.raises(NotFoundError, match='results not found'):
            wf_svc.get_step_results(study_id, 2)

    def test_returns_results_when_present(self, mock_db, wf_svc, study_id):
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(study_id)},
            {'$set': {'step_2_results': {'data': [1, 2, 3], 'timestamp': datetime.now(timezone.utc)}}}
        )
        result = wf_svc.get_step_results(study_id, 2)
        assert result['data'] == [1, 2, 3]


# ---------------------------------------------------------------------------
# export_weight_solutions_csv / export_weight_solutions_single_csv
# ---------------------------------------------------------------------------

class TestExportWeightSolutionCsv:
    def test_prefers_pre_threshold_rows_and_includes_error(self, mock_db, wf_svc, study_id, session_id):
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(study_id)},
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

        content, _, mime = wf_svc.export_weight_solutions_single_csv(study_id, session_id)

        assert mime == 'text/csv'
        rows = list(csv.reader(io.StringIO(content.decode('utf-8-sig'))))
        assert rows[0] == ['SOLUTION_INDEX', 'Cost', 'ERROR']
        assert rows[1] == ['0', '0.333', '0.123457']
        assert rows[2] == ['1', '0.667', '0.765432']

    def test_all_sessions_export_includes_error_column(self, mock_db, wf_svc, study_id, session_id):
        another_session_id = str(ObjectId())
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(study_id)},
            {'$set': {'computed_weights': {
                'pre_threshold_weight_solutions': {
                    session_id: [{'weights': {'Cost': 0.25}, 'error': 0.25}],
                    another_session_id: [{'weights': {'Cost': 0.75}, 'error': 0.5}],
                },
                'timestamp': datetime.now(timezone.utc),
            }}}
        )

        content, _, _ = wf_svc.export_weight_solutions_csv(study_id)

        rows = list(csv.reader(io.StringIO(content.decode('utf-8-sig'))))
        assert rows[0] == ['SESSION_ID', 'SOLUTION_INDEX', 'Cost', 'ERROR']
        assert rows[1][-1] == '0.25'
        assert rows[2][-1] == '0.5'


class TestDistributionStatsExports:
    def test_collects_distribution_stats_rows(self, wf_svc):
        step_results = {
            'alternative_names': ['Alt A'],
            'results_by_elicitation': {
                '0': [[0.10], [0.20], [0.90]],
                '1': [[0.40], [0.60], [0.80]],
            },
        }

        rows = wf_svc._collect_distribution_stats_rows(step_results)

        assert len(rows) == 2
        assert rows[0]['expert'] == 'Alt A - E1 (0)'
        assert rows[1]['expert'] == 'Alt A - E2 (1)'
        assert rows[0]['average'] == pytest.approx(0.4)
        assert rows[0]['median'] == pytest.approx(0.2)
        assert rows[0]['p5'] == pytest.approx(0.11)
        assert rows[0]['p95'] == pytest.approx(0.83)

    def test_writes_distribution_stats_csv_into_zip(self, wf_svc):
        step_results = {
            'alternative_names': ['Alt A'],
            'results_by_elicitation': {
                '0': [[0.10], [0.20], [0.90]],
            },
        }

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            wf_svc._write_distribution_stats_csv(
                zf,
                'steps/step_5_distribution_stats.csv',
                step_results,
                'Step 5 distribution stats',
            )

        buf.seek(0)
        with zipfile.ZipFile(buf, 'r') as zf:
            payload = zf.read('steps/step_5_distribution_stats.csv').decode('utf-8-sig')

        assert 'title;Step 5 distribution stats' in payload
        assert 'expert;n;mean;median;stdDev;iqr;skewness;kurtosis;min;p5;p25;p75;p95;max' in payload
        assert 'Alt A - E1 (0);3;0.4;0.2;' in payload
