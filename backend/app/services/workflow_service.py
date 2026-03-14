"""Business logic for the UP-MAVT workflow.

This module provides :class:`WorkflowService`, which manages background tasks
for weight computation and step execution, and exposes helpers for querying
task state and exporting results.
"""

import csv
import io
import json
import re
import zipfile
from datetime import datetime, timezone

from app.repositories import StudySessionRepository, SessionRepository, TaskRepository
from app.services.session_service import SessionService
from app.exceptions import NotFoundError, ValidationError


class WorkflowService:
    """Service layer for the UP-MAVT workflow task management."""

    def __init__(self, db):
        """Initialise the service with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._studies = StudySessionRepository(db)
        self._sessions = SessionRepository(db)
        self._tasks = TaskRepository(db)
        self._session_svc = SessionService(db)

    def create_compute_weights_task(
        self,
        study_session_id,
        selected_session_ids,
        use_non_linear_model=True,
        phase1_method='constraint_dominated_ea',
        weight_sampling_method='lhs_simplex',
        phase3_tolerance_pct=1.0,
    ):
        """Enqueue a background task to compute weights for the selected sessions.

        Any existing pending or running ``compute_weights`` tasks for the same
        study session are cancelled before the new task is created.

        Args:
            study_session_id: The parent study session's ``_id``.
            selected_session_ids (list): The ``_id`` values of the elicitation
                sessions to include.
            use_non_linear_model (bool): Whether to use the non-linear
                weight model for constraint violation.
            phase1_method (str): Phase 1 method used to compute the
                minimum violation bound.
            weight_sampling_method (str): Phase 2 candidate generation method
                used by the worker.
            phase3_tolerance_pct (float): Phase 3 filtering tolerance percentage
                LIM used in z_cap = z_star + z_star*LIM.

        Returns:
            str: The ``_id`` of the newly created task as a hex string.

        Raises:
            ValidationError: When *selected_session_ids* is empty.
            NotFoundError: When the study session does not exist.
        """
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
                'use_non_linear_model': bool(use_non_linear_model),
                'phase1_method': phase1_method,
                'weight_sampling_method': weight_sampling_method,
                'phase3_tolerance_pct': float(phase3_tolerance_pct),
            },
            'console_output': '',
            'created_at': datetime.now(timezone.utc),
        }
        return str(self._tasks.insert(doc))

    def create_run_step_task(self, study_session_id, step_number, selected_session_ids,
                             mc_iterations, aggregation_method, mc_mode, use_random_weights):
        """Enqueue a background task to execute a UP-MAVT analysis step.

        Validates preconditions, normalises qualitative indicators for the
        selected sessions, and cancels any existing pending tasks for the same
        step before creating the new task.

        Args:
            study_session_id: The parent study session's ``_id``.
            step_number (int): The UP-MAVT step to run (2–6).
            selected_session_ids (list): The elicitation session IDs to include.
            mc_iterations (int): Number of Monte-Carlo iterations (clamped to
                [100, 5000] for steps 2-5, [100, 10000] for step 6).
            aggregation_method (str): Aggregation method shortcode or full
                name (``'SUM'``/``'weighted_sum'``, ``'GEO'``/``'geometric_mean'``,
                ``'HAR'``/``'harmonic_mean'``).
            mc_mode (str): Monte-Carlo mode string passed directly to the
                worker (e.g. ``'non_strict'``).
            use_random_weights (bool): Whether to use random weights in the
                computation.

        Returns:
            str: The ``_id`` of the newly created task as a hex string.

        Raises:
            ValidationError: When *step_number* is not in [2, 6],
                *selected_session_ids* is empty, or weights have not been
                computed yet.
            NotFoundError: When the study session does not exist.
        """
        if step_number not in [2, 3, 4, 5, 6]:
            raise ValidationError('Invalid step number (must be 2-6)')
        if not selected_session_ids:
            raise ValidationError('No sessions selected')

        try:
            upper = 10000 if step_number == 6 else 5000
            mc_iterations = max(100, min(upper, int(mc_iterations)))
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
        """Return the current status and metadata of a task.

        Args:
            task_id: The task's ``_id`` (string or ObjectId).

        Returns:
            dict: A dict with keys ``task_id``, ``type``, ``status``,
            ``console_output``, ``error``, ``created_at``, ``started_at``,
            and ``completed_at`` (ISO-8601 strings where applicable).

        Raises:
            NotFoundError: When no task with that ``_id`` exists.
        """
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
        """Cancel a pending or running task.

        Args:
            task_id: The task's ``_id`` (string or ObjectId).

        Raises:
            NotFoundError: When no task with that ``_id`` exists, or when the
                task is already in a terminal state.
        """
        modified = self._tasks.cancel_task(task_id)
        if modified == 0:
            raise NotFoundError('Task not found or already completed')

    def get_active_task(self, study_session_id):
        """Return the currently pending or running task for a study session.

        Args:
            study_session_id: The study session's ``_id``.

        Returns:
            dict | None: A partial task status dict (``task_id``, ``type``,
            ``status``, ``console_output``, ``params``, ``created_at``), or
            ``None`` when there is no active task.
        """
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
        """Remove computed weights and all step results from a study session.

        Args:
            study_session_id: The study session's ``_id``.

        Raises:
            NotFoundError: When the study session does not exist.
        """
        fields = ['computed_weights', 'step_2_results', 'step_3_results', 'step_4_results', 'step_5_results', 'step_6_results']
        matched = self._studies.unset_fields(study_session_id, fields)
        if matched == 0:
            raise NotFoundError('Study session not found')

    def reset_step(self, study_session_id, step_number):
        """Remove the results for a specific UP-MAVT step.

        Args:
            study_session_id: The study session's ``_id``.
            step_number (int): The step whose results should be cleared (2–6).

        Raises:
            ValidationError: When *step_number* is not in [2, 6].
            NotFoundError: When the study session does not exist.
        """
        if step_number not in [2, 3, 4, 5, 6]:
            raise ValidationError('Invalid step number')
        matched = self._studies.unset_fields(study_session_id, [f'step_{step_number}_results'])
        if matched == 0:
            raise NotFoundError('Study session not found')

    def get_workflow_status(self, study_session_id):
        """Return a summary of computed weights and step results for a study session.

        Args:
            study_session_id: The study session's ``_id``.

        Returns:
            dict: A dict with two keys:

            * ``'weights'`` – either ``None`` (not computed) or a dict with
              ``'computed'``, ``'timestamp'``, and ``'session_count'``.
            * ``'steps'`` – a dict mapping step numbers (``'2'``–``'6'``) to
              step-status dicts.  Each step-status dict contains at least
              ``'completed'`` (bool).  Completed steps also include
              ``'timestamp'``, ``'mc_iterations'``, ``'mc_mode'``, and
              ``'aggregation_method'`` (or ``'aggregation_methods'`` for
              step 4).

        Raises:
            NotFoundError: When the study session does not exist.
        """
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
                'phase1_method': computed_weights.get('phase1_method', 'constraint_dominated_ea'),
                'method': computed_weights.get('method', 'lhs_simplex'),
                'use_non_linear_model': computed_weights.get('use_non_linear_model', True),
                'phase3_tolerance_pct': computed_weights.get('phase3_tolerance_pct', 1.0),
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
        """Return the weight-space data for a specific elicitation session.

        Args:
            study_session_id: The study session's ``_id``.
            session_id (str): The elicitation session's ``_id`` string.

        Returns:
            list[dict]: The list of weight solution dicts for the session.

        Raises:
            NotFoundError: When the study session does not exist, weights have
                not been computed, or no data is available for *session_id*.
        """
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
        return {
            'weight_space': data,
            'phase1_method': cw.get('phase1_method', 'constraint_dominated_ea'),
            'method': cw.get('method', 'lhs_simplex'),
            'use_non_linear_model': cw.get('use_non_linear_model', True),
            'phase3_tolerance_pct': cw.get('phase3_tolerance_pct', 1.0),
        }

    def get_step_results(self, study_session_id, step_number):
        """Return the stored results for a specific UP-MAVT step.

        Timestamps within the result document are converted to ISO-8601
        strings for JSON serialisability.

        Args:
            study_session_id: The study session's ``_id``.
            step_number (int): The step number (2–6).

        Returns:
            dict: The step results document.

        Raises:
            ValidationError: When *step_number* is not in [2, 6].
            NotFoundError: When the study session or its step results do not
                exist.
        """
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
        """Export all weight solutions for a study session as a CSV file.

        The CSV has a column for each criterion plus ``SESSION_ID`` and
        ``SOLUTION_INDEX`` columns.

        Args:
            study_session_id: The study session's ``_id``.

        Returns:
            tuple[bytes, str, str]: A 3-tuple of (content, filename, mimetype).

        Raises:
            NotFoundError: When the study session, its weight solutions, or
                any non-empty solution set is not found.
        """
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
        """Export weight solutions for a single elicitation session as a CSV file.

        Falls back to ``weight_spaces`` format when ``weight_solutions`` is
        not available for the requested session.

        Args:
            study_session_id: The study session's ``_id``.
            session_id (str): The elicitation session's ``_id`` string.

        Returns:
            tuple[bytes, str, str]: A 3-tuple of (content, filename, mimetype).

        Raises:
            NotFoundError: When the study session, its weights, or the
                session's solutions are not found.
        """
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

    @staticmethod
    def _safe_filename(value):
        sanitized = re.sub(r'[^a-zA-Z0-9._-]+', '_', str(value or '')).strip('._')
        return sanitized or 'unnamed'

    @staticmethod
    def _json_bytes(data):
        return json.dumps(data, ensure_ascii=False, indent=2, default=str).encode('utf-8')

    @staticmethod
    def _rows_to_csv(headers, rows):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        for row in rows:
            writer.writerow(row)
        return output.getvalue()

    @staticmethod
    def _build_rank_probability_matrix(results):
        alternatives = results.get('alternative_names') if isinstance(results, dict) else None
        rows = results.get('aggregated_results') if isinstance(results, dict) else None
        if not isinstance(alternatives, list) or not alternatives or not isinstance(rows, list) or not rows:
            return None

        alt_count = len(alternatives)
        rank_counts = [[0 for _ in range(alt_count)] for _ in range(alt_count)]

        for score_row in rows:
            if not isinstance(score_row, list) or len(score_row) < alt_count:
                continue
            ranked = sorted(
                [{
                    'alt_index': idx,
                    'score': float(score_row[idx]) if score_row[idx] is not None else 0.0,
                } for idx in range(alt_count)],
                key=lambda item: (-item['score'], item['alt_index'])
            )
            for rank_idx, entry in enumerate(ranked):
                rank_counts[rank_idx][entry['alt_index']] += 1

        total_iterations = len(rows)
        if total_iterations <= 0:
            return None

        probabilities = [
            [count / total_iterations for count in rank_row]
            for rank_row in rank_counts
        ]

        return {
            'alternatives': alternatives,
            'probabilities': probabilities,
            'iterations': total_iterations,
        }

    def _write_rank_probability_csv(self, zf, path, matrix):
        headers = ['rank', *matrix['alternatives']]
        rows = []
        for rank_idx, rank_row in enumerate(matrix['probabilities']):
            rows.append([rank_idx + 1, *[round(float(prob), 6) for prob in rank_row]])
        zf.writestr(path, self._rows_to_csv(headers, rows))

    def _write_strict_results_full_csv(self, zf, path, step_results):
        alternatives = step_results.get('alternative_names') if isinstance(step_results, dict) else None
        by_elicitation = step_results.get('results_by_elicitation') if isinstance(step_results, dict) else None
        if not isinstance(alternatives, list) or not alternatives or not isinstance(by_elicitation, dict):
            return

        headers = ['elicitation', 'iteration', 'alternative', 'score']
        rows = []
        for elicitation_key, iteration_rows in sorted(by_elicitation.items(), key=lambda item: str(item[0])):
            if not isinstance(iteration_rows, list):
                continue
            for iteration_idx, score_row in enumerate(iteration_rows):
                if not isinstance(score_row, list):
                    continue
                for alt_idx, alt_name in enumerate(alternatives):
                    if alt_idx >= len(score_row):
                        continue
                    rows.append([elicitation_key, iteration_idx, alt_name, score_row[alt_idx]])

        if rows:
            zf.writestr(path, self._rows_to_csv(headers, rows))

    def export_workflow_data_zip(self, study_session_id):
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')

        study_code = self._safe_filename(study.get('code', study_session_id))
        bundle_name = f'upmavt_data_{study_code}.zip'

        session_docs = self._sessions.find_by_study_session_id(study_session_id)
        session_map = {
            str(doc.get('_id')): {
                'id': str(doc.get('_id')),
                'name': doc.get('name'),
                'session_locked': bool(doc.get('session_locked')),
            }
            for doc in session_docs if isinstance(doc, dict)
        }

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            metadata = {
                'study_session_id': str(study.get('_id')),
                'study_code': study.get('code'),
                'exported_at': datetime.now(timezone.utc).isoformat(),
                'session_count': len(session_map),
                'sessions': list(session_map.values()),
            }
            zf.writestr('metadata.json', self._json_bytes(metadata))

            computed_weights = study.get('computed_weights')
            if computed_weights:
                zf.writestr('weights/computed_weights.json', self._json_bytes(computed_weights))

            for step_number in [2, 3, 4, 5, 6]:
                step_results = study.get(f'step_{step_number}_results')
                if not step_results:
                    continue

                zf.writestr(f'steps/step_{step_number}_results.json', self._json_bytes(step_results))

                if step_number in [2, 5]:
                    self._write_strict_results_full_csv(
                        zf,
                        f'steps/step_{step_number}_strict_full.csv',
                        step_results,
                    )
                elif step_number in [3, 6]:
                    matrix = self._build_rank_probability_matrix(step_results)
                    if matrix:
                        self._write_rank_probability_csv(
                            zf,
                            f'steps/step_{step_number}_rank_probabilities.csv',
                            matrix,
                        )
                elif step_number == 4 and isinstance(step_results.get('results_by_aggregation'), dict):
                    for agg_name, agg_results in step_results['results_by_aggregation'].items():
                        matrix = self._build_rank_probability_matrix(agg_results if isinstance(agg_results, dict) else {})
                        if matrix:
                            safe_agg = self._safe_filename(agg_name)
                            self._write_rank_probability_csv(
                                zf,
                                f'steps/step_4_rank_probabilities_{safe_agg}.csv',
                                matrix,
                            )

        buf.seek(0)
        return buf, bundle_name, 'application/zip'
