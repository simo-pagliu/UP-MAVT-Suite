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
from pathlib import Path
from datetime import datetime, timezone

from app.repositories import StudySessionRepository, SessionRepository, TaskRepository, InputRepository
from app.services.export_service import ExportService
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
        self._inputs = InputRepository(db)
        self._tasks = TaskRepository(db)
        self._session_svc = SessionService(db)

    def create_compute_weights_task(
        self,
        study_session_id,
        selected_session_ids,
        use_non_linear_model=True,
        phase3_tolerance_pct=1.0,
        weight_space_parameters=None,
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
            phase3_tolerance_pct (float): Phase 3 filtering tolerance percentage
                LIM used in z_cap = z_star + z_star*LIM.
            weight_space_parameters (dict): Optional runtime parameter overrides.

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
                'phase3_tolerance_pct': float(phase3_tolerance_pct),
                'weight_space_parameters': weight_space_parameters or {},
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
            mc_iterations = 10000 if step_number == 6 else 1000

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
                'use_non_linear_model': computed_weights.get('use_non_linear_model', True),
                'phase3_tolerance_pct': computed_weights.get('phase3_tolerance_pct', 1.0),
                'weight_space_parameters': computed_weights.get('weight_space_parameters', {}),
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
        workflow_preferences = study.get('workflow_preferences', {})
        if not isinstance(workflow_preferences, dict):
            workflow_preferences = {}
        run_page = workflow_preferences.get('run_page', {})
        if not isinstance(run_page, dict):
            run_page = {}

        return {
            'weights': weights_status,
            'steps': steps_status,
            'preferences': {
                'run_page': {
                    'use_non_linear_model': bool(run_page.get('use_non_linear_model', True)),
                    'selected_session_ids': [
                        str(session_id)
                        for session_id in run_page.get('selected_session_ids', [])
                        if session_id is not None
                    ],
                }
            },
        }

    def update_run_page_preferences(
        self,
        study_session_id,
        use_non_linear_model=None,
        selected_session_ids=None,
    ):
        """Persist run-page preferences to the study session document."""
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')

        updates = {}
        if use_non_linear_model is not None:
            updates['workflow_preferences.run_page.use_non_linear_model'] = bool(use_non_linear_model)

        if selected_session_ids is not None:
            if not isinstance(selected_session_ids, list):
                raise ValidationError('selected_session_ids must be a list')
            updates['workflow_preferences.run_page.selected_session_ids'] = [
                str(session_id)
                for session_id in selected_session_ids
                if session_id is not None
            ]

        if updates:
            self._studies.update(study_session_id, updates)

        return self.get_workflow_status(study_session_id)

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
            'use_non_linear_model': cw.get('use_non_linear_model', True),
            'phase3_tolerance_pct': cw.get('phase3_tolerance_pct', 1.0),
            'weight_space_parameters': cw.get('weight_space_parameters', {}),
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

    @staticmethod
    def _normalize_weight_export_rows(raw_rows):
        rows = []
        if not isinstance(raw_rows, list):
            return rows
        for row in raw_rows:
            if not isinstance(row, dict):
                continue
            weights = row.get('weights') if isinstance(row.get('weights'), dict) else row
            if not isinstance(weights, dict) or not weights:
                continue
            error = row.get('error', '') if isinstance(row.get('weights'), dict) else ''
            rows.append({'weights': weights, 'error': error})
        return rows

    @staticmethod
    def _legacy_weight_export_rows(cw, session_id):
        rows = []

        ws = cw.get('weight_solutions', {})
        if isinstance(ws, dict) and session_id in ws:
            rows.extend(WorkflowService._normalize_weight_export_rows(ws.get(session_id, [])))
        if rows:
            return rows

        weight_spaces = cw.get('weight_spaces', {})
        if isinstance(weight_spaces, dict) and session_id in weight_spaces:
            space_data = weight_spaces[session_id]
            # Keep stored key order for legacy dict-of-lists structures.
            criteria_names = list(space_data.keys())
            if criteria_names:
                count = len(space_data[criteria_names[0]]) if isinstance(space_data[criteria_names[0]], list) else 0
                for idx in range(count):
                    weights = {
                        criterion: space_data.get(criterion, [])[idx]
                        for criterion in criteria_names
                        if idx < len(space_data.get(criterion, []))
                    }
                    if weights:
                        rows.append({'weights': weights, 'error': ''})
        return rows

    @classmethod
    def _get_weight_export_rows(cls, cw, session_id):
        pre_threshold = cw.get('pre_threshold_weight_solutions', {})
        if isinstance(pre_threshold, dict) and session_id in pre_threshold:
            rows = cls._normalize_weight_export_rows(pre_threshold.get(session_id, []))
            if rows:
                return rows
        return cls._legacy_weight_export_rows(cw, session_id)

    def _session_criteria_order(self, session_id):
        """Return criterion names in input-defined order for one session."""
        session_doc = self._sessions.find_by_id(session_id)
        criteria = self._session_svc.resolve_session_criteria(session_doc)
        if not isinstance(criteria, list):
            return []
        names = []
        for criterion in criteria:
            if isinstance(criterion, dict):
                name = criterion.get('criterion_name')
                if isinstance(name, str) and name and name not in names:
                    names.append(name)
        return names

    @staticmethod
    def _apply_preferred_order(detected_names, preferred_names):
        """Order detected names by preferred order, then append remaining names."""
        preferred = [name for name in preferred_names if name in detected_names]
        remainder = [name for name in detected_names if name not in preferred]
        return [*preferred, *remainder]

    @staticmethod
    def _format_export_number(value, decimals):
        if value == '' or value is None:
            return ''
        try:
            return round(float(value), decimals)
        except (TypeError, ValueError):
            return value

    def export_weight_solutions_csv(self, study_session_id):
        """Export all weight solutions for a study session as a CSV file.

        The CSV has a column for each criterion plus ``SESSION_ID`` and
        ``SOLUTION_INDEX`` columns. When available, it prefers the stored
        pre-threshold decimal-filtered candidates and appends ``ERROR`` as the
        last column.

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
        session_ids = set()
        for key in ['pre_threshold_weight_solutions', 'weight_solutions', 'weight_spaces']:
            data = cw.get(key, {})
            if isinstance(data, dict):
                session_ids.update(str(session_id) for session_id in data.keys())
        if not session_ids:
            raise NotFoundError('No weight solutions found')
        non_empty = []
        for session_id in sorted(session_ids):
            rows = self._get_weight_export_rows(cw, session_id)
            if rows:
                non_empty.append((session_id, rows))
        if not non_empty:
            raise NotFoundError('No valid weight solutions found')
        # Preserve first-seen criterion order from rows, then align with input order.
        detected_names = []
        for _, rows in non_empty:
            for row in rows:
                for criterion in row['weights'].keys():
                    if criterion not in detected_names:
                        detected_names.append(criterion)

        preferred_names = self._session_criteria_order(non_empty[0][0])
        criteria_names = self._apply_preferred_order(detected_names, preferred_names)
        if not criteria_names:
            raise NotFoundError('No valid weight solutions found')
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['SESSION_ID', 'SOLUTION_INDEX', *criteria_names, 'ERROR'])
        for sid, rows in non_empty:
            for index, solution_row in enumerate(rows):
                row = [sid, index]
                for c in criteria_names:
                    row.append(self._format_export_number(solution_row['weights'].get(c, ''), 3))
                row.append(self._format_export_number(solution_row.get('error', ''), 6))
                writer.writerow(row)
        filename = f'weight_solutions_{study.get("code", study_session_id)}.csv'
        return ExportService._csv_bytes(output.getvalue()), filename, 'text/csv'

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
        solution_rows = self._get_weight_export_rows(cw, session_id)
        if not solution_rows:
            raise NotFoundError('No weight solutions found for this session')
        detected_names = []
        for row in solution_rows:
            for criterion in row['weights'].keys():
                if criterion not in detected_names:
                    detected_names.append(criterion)

        preferred_names = self._session_criteria_order(session_id)
        all_criteria = self._apply_preferred_order(detected_names, preferred_names)
        if not all_criteria:
            raise NotFoundError('No criteria found in weight solutions')
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['SOLUTION_INDEX', *all_criteria, 'ERROR'])
        for index, solution_row in enumerate(solution_rows):
            row = [index]
            for c in all_criteria:
                row.append(self._format_export_number(solution_row['weights'].get(c, ''), 3))
            row.append(self._format_export_number(solution_row.get('error', ''), 6))
            writer.writerow(row)
        session_doc = self._sessions.find_by_id(session_id)
        session_name = session_doc.get('name') if isinstance(session_doc, dict) else session_id
        return ExportService._csv_bytes(output.getvalue()), f'weight_solutions_{session_name}.csv', 'text/csv'

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
        return ExportService._csv_bytes(output.getvalue())

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

    def _write_strict_results_long_csv(self, zf, path, step_results):
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

    @staticmethod
    def _repo_root():
        return Path(__file__).resolve().parents[3]

    @staticmethod
    def _find_existing_path(relative_candidates):
        """Resolve first existing path from known project roots."""
        roots = [
            Path('/'),
            Path(__file__).resolve().parents[2],
            Path(__file__).resolve().parents[3],
        ]
        for root in roots:
            for rel in relative_candidates:
                candidate = root / rel
                if candidate.exists():
                    return candidate
        raise FileNotFoundError(f'Could not find any of: {relative_candidates}')

    @staticmethod
    def _read_text(path):
        return path.read_text(encoding='utf-8')

    @staticmethod
    def _build_local_input_csv(criteria):
        """Build data/input.csv expected by frontend/public/load_LOCAL.py."""
        criterion_names = [
            c.get('criterion_name')
            for c in criteria
            if isinstance(c, dict) and c.get('criterion_name')
        ]

        alternatives_order = []
        values_by_alt = {}

        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue
            crit_name = criterion.get('criterion_name')
            if not crit_name:
                continue
            for alt in criterion.get('alternatives', []):
                if not isinstance(alt, dict):
                    continue
                alt_name = alt.get('name')
                if not alt_name:
                    continue
                if alt_name not in values_by_alt:
                    values_by_alt[alt_name] = {}
                    alternatives_order.append(alt_name)
                values_by_alt[alt_name][crit_name] = alt.get('value', '')

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Alternative', *criterion_names])
        for alt_name in alternatives_order:
            row = [alt_name]
            for crit_name in criterion_names:
                row.append(values_by_alt.get(alt_name, {}).get(crit_name, ''))
            writer.writerow(row)
        return output.getvalue()

    def _get_study_criteria(self, study):
        input_id = self._studies._to_oid(study.get('input_id'))
        if not input_id:
            return []
        input_doc = self._inputs.find_by_id(input_id)
        if not isinstance(input_doc, dict):
            return []
        criteria = input_doc.get('criteria', [])
        return criteria if isinstance(criteria, list) else []

    def export_workflow_data_zip(self, study_session_id):
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')

        study_code = self._safe_filename(study.get('code', study_session_id))
        bundle_name = f'upmavt_data_{study_code}.zip'

        session_docs = self._sessions.find_by_study_session_id(study_session_id)
        criteria = self._get_study_criteria(study)
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

            # -----------------------------------------------------------------
            # Local runnable bundle (scripts + data)
            # -----------------------------------------------------------------
            main_path = self._find_existing_path([
                Path('frontend/public/main.py'),
                Path('public/main.py'),
            ])
            load_local_path = self._find_existing_path([
                Path('frontend/public/load_LOCAL.py'),
                Path('public/load_LOCAL.py'),
            ])
            readme_path = self._find_existing_path([
                Path('frontend/public/README.md'),
                Path('public/README.md'),
            ])
            weight_space_path = self._find_existing_path([
                Path('worker/scripts/weight_space_definition.py'),
                Path('scripts/weight_space_definition.py'),
            ])
            upmavt_path = self._find_existing_path([
                Path('worker/scripts/upmavt.py'),
                Path('scripts/upmavt.py'),
            ])

            main_template = self._read_text(main_path)
            # Run main from project root, import exact worker scripts as package modules.
            main_content = main_template.replace(
                'from weight_space_definition import compute_weights',
                'from scripts.weight_space_definition import compute_weights',
            ).replace(
                'from upmavt import run_upmavt',
                'from scripts.upmavt import run_upmavt',
            )

            zf.writestr('main.py', main_content)
            zf.writestr('load_LOCAL.py', self._read_text(load_local_path))
            zf.writestr('README.md', self._read_text(readme_path).replace('python scripts/main.py', 'python main.py'))
            zf.writestr('requirements.txt', 'numpy\nscipy\nmatplotlib\n')

            # Exact same implementation files used by backend/worker.
            zf.writestr('scripts/__init__.py', '')
            zf.writestr('scripts/weight_space_definition.py', self._read_text(weight_space_path))
            zf.writestr('scripts/upmavt.py', self._read_text(upmavt_path))

            # Local CSV data layout expected by load_LOCAL.py
            zf.writestr('data/input.csv', self._build_local_input_csv(criteria))
            for session_doc in session_docs:
                if not isinstance(session_doc, dict):
                    continue
                session_name = session_doc.get('name') or str(session_doc.get('_id'))
                safe_session_name = self._safe_filename(session_name)
                session_criteria = self._session_svc.resolve_session_criteria(session_doc)
                qualitative = session_doc.get('qualitative_indicators') or {}
                value_functions = session_doc.get('value_functions') or {}
                vf_criteria = value_functions.get('criteria', {}) if isinstance(value_functions, dict) else {}
                bwt = session_doc.get('bwt') or {}

                zf.writestr(
                    f'data/{safe_session_name}/value_functions.csv',
                    ExportService.build_value_functions_csv(session_criteria, vf_criteria, qualitative),
                )
                zf.writestr(
                    f'data/{safe_session_name}/qualitative_indicators.csv',
                    ExportService.build_qualitative_csv(session_criteria, qualitative),
                )
                zf.writestr(
                    f'data/{safe_session_name}/bwt_comparisons.csv',
                    ExportService.build_pile_bwt_csv(bwt),
                )

            computed_weights = study.get('computed_weights')
            if computed_weights:
                zf.writestr('weights/computed_weights.json', self._json_bytes(computed_weights))

            for step_number in [2, 3, 4, 5, 6]:
                step_results = study.get(f'step_{step_number}_results')
                if not step_results:
                    continue

                zf.writestr(f'steps/step_{step_number}_results.json', self._json_bytes(step_results))

                if step_number in [2, 5]:
                    self._write_strict_results_long_csv(
                        zf,
                        f'steps/step_{step_number}_strict_long.csv',
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
