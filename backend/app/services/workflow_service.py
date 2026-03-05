import csv
import io
from datetime import datetime, timezone

from app.repositories import StudySessionRepository, SessionRepository, TaskRepository
from app.services.session_service import SessionService
from app.exceptions import NotFoundError, ValidationError


class WorkflowService:
    def __init__(self, db):
        self._studies = StudySessionRepository(db)
        self._sessions = SessionRepository(db)
        self._tasks = TaskRepository(db)
        self._session_svc = SessionService(db)

    def create_compute_weights_task(self, study_session_id, selected_session_ids):
        if not selected_session_ids:
            raise ValidationError('No sessions selected')
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        self._tasks.cancel_pending_for_study(study_session_id, 'compute_weights')
        doc = {
            'type': 'compute_weights',
            'status': 'pending',
            'params': {
                'study_session_id': study_session_id,
                'selected_session_ids': selected_session_ids,
            },
            'console_output': '',
            'created_at': datetime.now(timezone.utc),
        }
        return str(self._tasks.insert(doc))

    def create_run_step_task(self, study_session_id, step_number, selected_session_ids,
                             mc_iterations, aggregation_method, mc_mode, use_random_weights):
        if step_number not in [2, 3, 4, 5, 6]:
            raise ValidationError('Invalid step number (must be 2-6)')
        if not selected_session_ids:
            raise ValidationError('No sessions selected')

        try:
            mc_iterations = max(100, min(5000, int(mc_iterations)))
        except (TypeError, ValueError):
            mc_iterations = 1000

        agg_map = {
            'SUM': 'weighted_sum', 'GEO': 'geometric_mean', 'HAR': 'harmonic_mean',
            'weighted_sum': 'weighted_sum', 'geometric_mean': 'geometric_mean', 'harmonic_mean': 'harmonic_mean',
        }
        aggregation_method = agg_map.get(aggregation_method, 'weighted_sum')

        step_names = {
            2: 'Consensus Analysis (SMC)',
            3: 'Dominance Analysis (NSMC + Random Weights)',
            4: 'Compensation Analysis (NSMC + All Aggregations)',
            5: 'Uncertainty Analysis (SMC)',
            6: 'Final Results (NSMC)',
        }

        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')

        # Normalize qualitative indicators for selected sessions
        selected_oids = [oid for sid in selected_session_ids if (oid := self._sessions._to_oid(sid)) is not None]
        if not selected_oids:
            raise ValidationError('No valid session IDs selected')

        session_docs = self._sessions.find_by_ids(selected_session_ids)
        for session_doc in session_docs:
            session_study_id = self._sessions._to_oid(session_doc.get('study_session_id'))
            if session_study_id != self._studies._to_oid(study_session_id):
                continue
            criteria = self._session_svc.resolve_session_criteria(session_doc)
            current_qi = session_doc.get('qualitative_indicators')
            current_qi = current_qi if isinstance(current_qi, dict) else {}
            normalized_qi = self._session_svc.normalize_qualitative_indicators(criteria, current_qi)
            if normalized_qi != current_qi:
                self._sessions.update(session_doc['_id'], {'qualitative_indicators': normalized_qi})

        if not study.get('computed_weights'):
            raise ValidationError('Compute weights first (Step 1)')

        self._tasks.cancel_pending_for_study(study_session_id, 'run_step', step_number)

        doc = {
            'type': 'run_step',
            'status': 'pending',
            'params': {
                'study_session_id': study_session_id,
                'selected_session_ids': selected_session_ids,
                'step_number': step_number,
                'step_name': step_names.get(step_number, f'Step {step_number}'),
                'mc_iterations': mc_iterations,
                'aggregation_method': aggregation_method,
                'mc_mode': mc_mode,
                'use_random_weights': use_random_weights,
                'opinion_weights': None,
            },
            'console_output': '',
            'created_at': datetime.now(timezone.utc),
        }
        return str(self._tasks.insert(doc))

    def get_task_status(self, task_id):
        task = self._tasks.find_by_id(task_id)
        if not task:
            raise NotFoundError('Task not found')
        return {
            'task_id': str(task['_id']),
            'type': task.get('type'),
            'status': task.get('status'),
            'console_output': task.get('console_output', ''),
            'error': task.get('error'),
            'created_at': task.get('created_at', '').isoformat() if task.get('created_at') else None,
            'started_at': task.get('started_at', '').isoformat() if task.get('started_at') else None,
            'completed_at': task.get('completed_at', '').isoformat() if task.get('completed_at') else None,
        }

    def cancel_task(self, task_id):
        modified = self._tasks.cancel_task(task_id)
        if modified == 0:
            raise NotFoundError('Task not found or already completed')

    def get_active_task(self, study_session_id):
        task = self._tasks.find_active_for_study(study_session_id)
        if not task:
            return None
        return {
            'task_id': str(task['_id']),
            'type': task.get('type'),
            'status': task.get('status'),
            'console_output': task.get('console_output', ''),
            'params': task.get('params', {}),
            'created_at': task.get('created_at', '').isoformat() if task.get('created_at') else None,
        }

    def reset_weights(self, study_session_id):
        fields = ['computed_weights', 'step_2_results', 'step_3_results', 'step_4_results', 'step_5_results', 'step_6_results']
        matched = self._studies.unset_fields(study_session_id, fields)
        if matched == 0:
            raise NotFoundError('Study session not found')

    def reset_step(self, study_session_id, step_number):
        if step_number not in [2, 3, 4, 5, 6]:
            raise ValidationError('Invalid step number')
        matched = self._studies.unset_fields(study_session_id, [f'step_{step_number}_results'])
        if matched == 0:
            raise NotFoundError('Study session not found')

    def get_workflow_status(self, study_session_id):
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        computed_weights = study.get('computed_weights')
        weights_status = None
        if computed_weights:
            ts = computed_weights.get('timestamp')
            ws = computed_weights.get('weight_solutions', {})
            if not isinstance(ws, dict) or not ws:
                ws = computed_weights.get('weight_spaces', {})
            weights_status = {
                'computed': True,
                'timestamp': ts.isoformat() if ts else None,
                'session_count': len(ws) if isinstance(ws, dict) else 0,
            }
        steps_status = {}
        for step_num in [2, 3, 4, 5, 6]:
            step_data = study.get(f'step_{step_num}_results')
            if step_data:
                ts = step_data.get('timestamp')
                step_info = {
                    'completed': True,
                    'timestamp': ts.isoformat() if ts else None,
                    'mc_iterations': step_data.get('mc_iterations'),
                    'mc_mode': step_data.get('mc_mode'),
                }
                if step_num == 4:
                    step_info['aggregation_methods'] = list(step_data.get('results_by_aggregation', {}).keys())
                else:
                    step_info['aggregation_method'] = step_data.get('aggregation_method')
                steps_status[str(step_num)] = step_info
            else:
                steps_status[str(step_num)] = {'completed': False}
        return {'weights': weights_status, 'steps': steps_status}

    def get_weight_space(self, study_session_id, session_id):
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        cw = study.get('computed_weights')
        if not cw:
            raise NotFoundError('Weights not computed yet')
        ws = cw.get('weight_solutions', {})
        if not isinstance(ws, dict) or not ws:
            ws = cw.get('weight_spaces', {})
        data = ws.get(session_id, [])
        if not data:
            raise NotFoundError('Weight space not found for this session')
        return data

    def get_step_results(self, study_session_id, step_number):
        if step_number not in [2, 3, 4, 5, 6]:
            raise ValidationError('Invalid step number')
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        step_data = study.get(f'step_{step_number}_results')
        if not step_data:
            raise NotFoundError(f'Step {step_number} results not found')
        if 'timestamp' in step_data and step_data['timestamp']:
            step_data['timestamp'] = step_data['timestamp'].isoformat()
        if step_number == 4 and 'results_by_aggregation' in step_data:
            for agg_data in step_data['results_by_aggregation'].values():
                if isinstance(agg_data, dict) and agg_data.get('timestamp'):
                    agg_data['timestamp'] = agg_data['timestamp'].isoformat()
        return step_data

    def export_weight_solutions_csv(self, study_session_id):
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        cw = study.get('computed_weights')
        if not cw:
            raise NotFoundError('Weights not computed yet')
        ws = cw.get('weight_solutions', {})
        if not isinstance(ws, dict) or not ws:
            raise NotFoundError('No weight solutions found')
        non_empty = [(sid, sols) for sid, sols in ws.items() if isinstance(sols, list) and sols]
        if not non_empty:
            raise NotFoundError('No valid weight solutions found')
        first_solution = next((sols[0] for _, sols in non_empty if isinstance(sols[0], dict) and sols[0]), None)
        if not first_solution:
            raise NotFoundError('No valid weight solutions found')
        criteria_names = sorted(first_solution.keys())
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['SESSION_ID', 'SOLUTION_INDEX', *criteria_names])
        for sid, solutions in sorted(non_empty, key=lambda x: str(x[0])):
            for index, solution in enumerate(solutions):
                if not isinstance(solution, dict):
                    continue
                row = [sid, index]
                for c in criteria_names:
                    v = solution.get(c, '')
                    if v != '' and v is not None:
                        try:
                            v = round(float(v), 3)
                        except (TypeError, ValueError):
                            pass
                    row.append(v)
                writer.writerow(row)
        filename = f'weight_solutions_{study.get("code", study_session_id)}.csv'
        return output.getvalue().encode(), filename, 'text/csv'

    def export_weight_solutions_single_csv(self, study_session_id, session_id):
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        cw = study.get('computed_weights')
        if not cw:
            raise NotFoundError('Weights not computed yet')
        ws = cw.get('weight_solutions', {})
        solutions = []
        if isinstance(ws, dict) and session_id in ws:
            solutions = ws.get(session_id, [])
        if not solutions:
            weight_spaces = cw.get('weight_spaces', {})
            if isinstance(weight_spaces, dict) and session_id in weight_spaces:
                space_data = weight_spaces[session_id]
                if isinstance(space_data, dict) and space_data:
                    criteria_names = sorted(space_data.keys())
                    if criteria_names:
                        num_solutions = len(space_data[criteria_names[0]]) if isinstance(space_data[criteria_names[0]], list) else 0
                        for idx in range(num_solutions):
                            sol = {c: space_data.get(c, [])[idx] for c in criteria_names if idx < len(space_data.get(c, []))}
                            if sol:
                                solutions.append(sol)
        if not solutions:
            raise NotFoundError('No weight solutions found for this session')
        all_criteria = sorted({k for sol in solutions if isinstance(sol, dict) for k in sol.keys()})
        if not all_criteria:
            raise NotFoundError('No criteria found in weight solutions')
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['SOLUTION_INDEX', *all_criteria])
        for index, sol in enumerate(solutions):
            if not isinstance(sol, dict):
                continue
            row = [index]
            for c in all_criteria:
                v = sol.get(c, '')
                if v != '' and v is not None:
                    try:
                        v = round(float(v), 3)
                    except (TypeError, ValueError):
                        pass
                row.append(v)
            writer.writerow(row)
        session_doc = self._sessions.find_by_id(session_id)
        session_name = session_doc.get('name') if isinstance(session_doc, dict) else session_id
        return output.getvalue().encode(), f'weight_solutions_{session_name}.csv', 'text/csv'
