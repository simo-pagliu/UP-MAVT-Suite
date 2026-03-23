"""Business logic for study sessions.

A *study session* represents a practitioner-level experiment that groups
multiple elicitation sessions (one per stakeholder) around shared input
criteria and feature settings.
"""

from datetime import datetime, timezone
import io
import json
import secrets
import string
import zipfile
from bson.objectid import ObjectId

from app.repositories import SessionRepository, StudySessionRepository, InputRepository
from app.exceptions import NotFoundError, ValidationError, ConflictError
from app.services.session_service import SessionService


class StudySessionService:
    """Service layer for study session operations."""

    def __init__(self, db):
        """Initialise the service with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._db = db
        self._studies = StudySessionRepository(db)
        self._sessions = SessionRepository(db)
        self._inputs = InputRepository(db)
        self._session_svc = SessionService(db)

    @staticmethod
    def _normalize_vf_method(vf_method):
        if vf_method in ('mid-splitting', 'free-edit'):
            return vf_method
        return None

    @staticmethod
    def _generate_code(length=8):
                alphabet = string.ascii_uppercase + string.digits
                return ''.join(secrets.choice(alphabet) for _ in range(length))

    def generate_unique_study_code(self, max_attempts=20):
        for _ in range(max_attempts):
            candidate = self._generate_code()
            if not self._studies.find_by_code(candidate):
                return candidate
        raise ConflictError('Failed to generate a unique study code')

    def generate_unique_session_code(self, max_attempts=20):
        for _ in range(max_attempts):
            candidate = self._generate_code()
            if not self._sessions.find_by_name(candidate):
                return candidate
        raise ConflictError('Failed to generate a unique session code')

    @staticmethod
    def _serialize_computed_weights(study):
        """Return the ``computed_weights`` sub-document with string-keyed solutions.

        ObjectId keys in ``weight_solutions`` are coerced to strings to ensure
        JSON serialisability.

        Args:
            study (dict): A raw study session document.

        Returns:
            dict: The serialised ``computed_weights`` dict, or an empty dict
            when absent.
        """
        cw = study.get('computed_weights', {})
        if not isinstance(cw, dict) or not cw:
            return {}
        serialized = dict(cw)
        if 'weight_solutions' in serialized:
            ws = serialized['weight_solutions']
            if isinstance(ws, dict):
                serialized['weight_solutions'] = {str(k): v for k, v in ws.items()}
        if 'pre_threshold_weight_solutions' in serialized:
            pre_threshold = serialized['pre_threshold_weight_solutions']
            if isinstance(pre_threshold, dict):
                serialized['pre_threshold_weight_solutions'] = {
                    str(k): v for k, v in pre_threshold.items()
                }
        return serialized

    @staticmethod
    def _to_backup_jsonable(value):
        """Convert DB values to JSON-safe backup representation."""
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, ObjectId):
            return str(value)
        if isinstance(value, dict):
            return {str(k): StudySessionService._to_backup_jsonable(v) for k, v in value.items()}
        if isinstance(value, list):
            return [StudySessionService._to_backup_jsonable(v) for v in value]
        return value

    @staticmethod
    def _parse_iso_datetime(value):
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    @classmethod
    def _export_computed_weights_for_backup(cls, computed_weights, session_id_to_name):
        if not isinstance(computed_weights, dict) or not computed_weights:
            return {}

        payload = cls._to_backup_jsonable(computed_weights)
        for key in ('weight_solutions', 'pre_threshold_weight_solutions', 'weight_spaces'):
            bucket = payload.get(key)
            if isinstance(bucket, dict):
                payload[key] = {
                    session_id_to_name.get(str(session_id), str(session_id)): rows
                    for session_id, rows in bucket.items()
                }
        return payload

    @classmethod
    def _import_computed_weights_from_backup(cls, payload, backup_name_to_new_session_id):
        if not isinstance(payload, dict) or not payload:
            return {}

        restored = dict(payload)
        ts = cls._parse_iso_datetime(restored.get('timestamp'))
        if ts is not None:
            restored['timestamp'] = ts

        for key in ('weight_solutions', 'pre_threshold_weight_solutions', 'weight_spaces'):
            bucket = restored.get(key)
            if isinstance(bucket, dict):
                remapped = {}
                for backup_session_name, rows in bucket.items():
                    new_session_id = backup_name_to_new_session_id.get(str(backup_session_name))
                    if new_session_id:
                        remapped[str(new_session_id)] = rows
                restored[key] = remapped

        return restored

    @classmethod
    def _import_step_results_from_backup(cls, payload):
        if not isinstance(payload, dict) or not payload:
            return None
        restored = dict(payload)
        ts = cls._parse_iso_datetime(restored.get('timestamp'))
        if ts is not None:
            restored['timestamp'] = ts
        return restored

    def _serialize_study(self, study, include_sessions=False):
        """Serialise a raw study session document for API consumption.

        Converts ObjectId fields to strings, resolves the linked input
        document's criteria, and optionally embeds the associated elicitation
        sessions.

        Args:
            study (dict): A raw MongoDB study session document.  Mutated
                in-place.
            include_sessions (bool): When ``True``, fetches and embeds the
                linked elicitation sessions under the ``'sessions'`` key.

        Returns:
            dict: The mutated study document.
        """
        study_id = study['_id']
        input_id = self._studies._to_oid(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = self._inputs.find_by_id(input_id)
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])
        study['_id'] = str(study_id)
        study['input_id'] = self._studies._str_id(study.get('input_id'))
        study['criteria'] = criteria
        study['title'] = study.get('title', '')
        study['description'] = study.get('description', '')
        study['creator_email'] = study.get('creator_email', '')
        if include_sessions:
            sessions = self._sessions.find_by_study_session_id(study_id)
            for s in sessions:
                s['_id'] = str(s['_id'])
                s['study_session_id'] = self._studies._str_id(s.get('study_session_id'))
                s['input_id'] = self._studies._str_id(s.get('input_id'))
                s['friendly_name'] = str(s.get('friendly_name') or '').strip()
                s['computed_weights'] = self._serialize_computed_weights(study)
            study['sessions'] = sessions
        return study

    def create(self, code, title='', description='', creator_email=''):
        """Create a new study session with the given practitioner code.

        Args:
            code (str): A unique identifier chosen by the practitioner.
            title (str): Optional display title.
            description (str): Optional description.
            creator_email (str): Optional practitioner email address stored
                for future notifications (e.g. inactivity warnings and
                elicitation-completion alerts).

        Returns:
            str: The ``_id`` of the newly created study session as a hex string.

        Raises:
            ValidationError: When *code* is empty or ``None``.
            ConflictError: When a study session with the same code already
                exists.
        """
        if not code:
            raise ValidationError('Study code is required')
        if self._studies.find_by_code(code):
            raise ConflictError('Study code already exists')
        now = datetime.now(timezone.utc)
        doc = {
            'code': code,
            'input_id': None,
            'features': {'qi': False, 'vf': False, 'bwt': False},
            'vf_method': 'mid-splitting',
            'title': str(title or '').strip(),
            'description': str(description or '').strip(),
            'creator_email': str(creator_email or '').strip(),
            'created_at': now,
            'last_modified_at': now,
        }
        inserted_id = self._studies.insert(doc)
        return str(inserted_id)

    def update_metadata(self, study_session_id, title=None, description=None):
        """Update the title/description metadata of a study session."""
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')

        update_doc = {}
        if title is not None:
            if not isinstance(title, str):
                raise ValidationError('Title must be a string')
            update_doc['title'] = title.strip()
        if description is not None:
            if not isinstance(description, str):
                raise ValidationError('Description must be a string')
            update_doc['description'] = description.strip()

        if update_doc:
            update_doc['last_modified_at'] = datetime.now(timezone.utc)
            self._studies.update(study_session_id, update_doc)

        updated = self._studies.find_by_id(study_session_id)
        if not updated:
            raise NotFoundError('Study session not found')
        updated['_id'] = str(updated['_id'])
        updated['input_id'] = self._studies._str_id(updated.get('input_id'))
        updated['title'] = updated.get('title', '')
        updated['description'] = updated.get('description', '')
        return updated

    def get_by_id(self, study_session_id):
        """Retrieve and serialise a study session by its identifier.

        Args:
            study_session_id: The study session's ``_id`` (string or ObjectId).

        Returns:
            dict: The serialised study session document.

        Raises:
            NotFoundError: When no study session with that ``_id`` exists.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        return self._serialize_study(study)

    def get_by_code(self, code):
        """Retrieve a study session by its practitioner code.

        Args:
            code (str): The session's unique practitioner code.

        Returns:
            dict: The serialised study session with ``'exists': True`` when
            found, or ``{'exists': False}`` when not found.
        """
        study = self._studies.find_by_code(code)
        if not study:
            return {'exists': False}
        self._serialize_study(study)
        study['exists'] = True
        return study

    def get_all(self):
        """Return all study sessions with embedded elicitation session lists.

        Returns:
            list[dict]: Serialised study session documents (newest first).
        """
        studies = self._studies.find_all()
        return [self._serialize_study(s, include_sessions=True) for s in studies]

    def update_features(self, study_session_id, features, vf_method=None):
        """Update the feature flags of a study session.

        Only the ``qi``, ``vf``, and ``bwt`` flags are accepted; all values
        are coerced to booleans.

        Args:
            study_session_id: The study session's ``_id``.
            features (dict | None): A dict with any combination of ``'qi'``,
                ``'vf'``, ``'bwt'`` keys and boolean-coercible values.
            vf_method (str | None): Optional value-function method.

        Returns:
            dict: The updated study session document (partially serialised).

        Raises:
            NotFoundError: When the study session does not exist.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        update_doc = {}
        if isinstance(features, dict):
            update_doc['features'] = {
                'qi': bool(features.get('qi', False)),
                'vf': bool(features.get('vf', False)),
                'bwt': bool(features.get('bwt', False)),
            }
        normalized_method = self._normalize_vf_method(vf_method)
        if normalized_method:
            update_doc['vf_method'] = normalized_method
        if update_doc:
            update_doc['last_modified_at'] = datetime.now(timezone.utc)
            self._studies.update(study_session_id, update_doc)
        updated = self._studies.find_by_id(study_session_id)
        if not updated:
            raise NotFoundError('Study session not found')
        updated['_id'] = str(updated['_id'])
        updated['input_id'] = self._studies._str_id(updated.get('input_id'))
        return updated

    def delete(self, study_session_id):
        """Delete a study session and its associated input document.

        The study session can only be deleted when it has no elicitation
        sessions; this prevents orphaned session data.

        Args:
            study_session_id: The study session's ``_id``.

        Raises:
            NotFoundError: When the study session does not exist.
            ValidationError: When the study session still has elicitation
                sessions attached to it.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        session_count = self._sessions.count_by_study_session_id(study_session_id)
        if session_count > 0:
            raise ValidationError('Cannot delete study session with elicitation sessions')
        input_id = self._studies._to_oid(study.get('input_id'))
        if input_id:
            self._inputs.delete(input_id)
        self._studies.delete(study_session_id)

    def update_input(self, study_session_id, criteria):
        """Set or replace the shared input criteria for a study session.

        Creates a new input document when none exists yet; otherwise updates
        the existing one in-place.

        Args:
            study_session_id: The study session's ``_id``.
            criteria (list[dict]): The criteria definitions.

        Raises:
            ValidationError: When *criteria* fails validation.
            NotFoundError: When the study session does not exist.
        """
        criteria = self._session_svc.validate_criteria(criteria)
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        input_id = self._studies._to_oid(study.get('input_id'))
        now = datetime.now(timezone.utc)
        if input_id:
            self._inputs.update_criteria(input_id, criteria)
        else:
            new_id = self._inputs.insert({'criteria': criteria, 'created_at': now, 'updated_at': now})
            self._studies.update(study_session_id, {'input_id': new_id})
        self._studies.update(study_session_id, {'last_modified_at': now})

    def get_input(self, study_session_id):
        """Return the criteria list for a study session's shared input document.

        Args:
            study_session_id: The study session's ``_id``.

        Returns:
            list[dict]: The criteria list, or an empty list when no input
            document has been defined yet.

        Raises:
            NotFoundError: When the study session does not exist.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        input_id = self._studies._to_oid(study.get('input_id'))
        if not input_id:
            return []
        input_doc = self._inputs.find_by_id(input_id)
        return input_doc.get('criteria', []) if isinstance(input_doc, dict) else []

    def reset_elicitation_sessions(self, study_session_id):
        """Delete all elicitation sessions belonging to a study session.

        Args:
            study_session_id: The study session's ``_id``.

        Returns:
            int: The number of elicitation sessions deleted.

        Raises:
            NotFoundError: When the study session does not exist.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        deleted = self._sessions.delete_many_by_study_session_id(study_session_id)
        return deleted

    def selective_reset_sessions(self, study_session_id, affected_criteria, affected_groups):
        """Selectively reset data for specific criteria and groups across all sessions.
        
        This removes:
        - VF data for affected criteria
        - BWT groups containing affected criteria
        - QI data for removed criteria
        
        Args:
            study_session_id: The study session's ``_id``.
            affected_criteria (list[str]): Criterion names whose data should be reset.
            affected_groups (list[str]): Group names whose BWT data should be reset.
            
        Returns:
            dict: Summary of reset operations including updated_sessions count.
            
        Raises:
            NotFoundError: When the study session does not exist.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        
        result = self._sessions.selective_reset_data(
            study_session_id, affected_criteria, affected_groups
        )
        return result

    def create_elicitation_session(self, study_session_id, name):
        """Create a new elicitation session linked to a study session.

        Validates that the study session has defined input criteria and that
        those criteria satisfy all enabled features before creating the session.

        Args:
            study_session_id: The parent study session's ``_id``.
            name (str): Unique stakeholder code for the new elicitation session.

        Returns:
            str: The ``_id`` of the newly created elicitation session.

        Raises:
            ValidationError: When *name* is empty, no input is defined, or the
                input does not satisfy the active features.
            NotFoundError: When the study session does not exist.
            ConflictError: When a session with the same name already exists.
        """
        if not name:
            raise ValidationError('Session code is required')
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        if self._sessions.find_by_name(name):
            raise ConflictError('Session code already exists')
        input_id = self._studies._to_oid(study.get('input_id'))
        if not input_id:
            raise ValidationError('Study input is not defined')
        input_doc = self._inputs.find_by_id(input_id)
        if not input_doc:
            raise ValidationError('Study input not found')
        criteria = input_doc.get('criteria', [])
        features = study.get('features', {'qi': False, 'vf': False, 'bwt': False})
        self._session_svc.validate_input_for_features(criteria, features)
        doc = {
            'name': name,
            'friendly_name': '',
            'input_id': input_id,
            'study_session_id': ObjectId(study_session_id),
            'qualitative_indicators': None,
            'value_functions': None,
            'bwt': None,
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        inserted_id = self._sessions.insert(doc)
        return str(inserted_id)

    def list_elicitation_sessions(self, study_session_id):
        """Return all elicitation sessions for a study session.

        The response includes the shared input criteria and each session's
        serialised weight data.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            dict: A summary dict with keys ``'study_session_id'``,
            ``'study_code'``, ``'criteria'``, and ``'sessions'``.

        Raises:
            NotFoundError: When the study session does not exist.
        """
        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')
        input_id = self._studies._to_oid(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = self._inputs.find_by_id(input_id)
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])
        sessions = self._sessions.find_by_study_session_id(study_session_id)
        for s in sessions:
            s['_id'] = str(s['_id'])
            s['study_session_id'] = self._studies._str_id(s.get('study_session_id'))
            s['input_id'] = self._studies._str_id(s.get('input_id'))
            s['friendly_name'] = str(s.get('friendly_name') or '').strip()
            s['computed_weights'] = self._serialize_computed_weights(study)
        return {
            'study_session_id': str(study['_id']) if isinstance(study.get('_id'), ObjectId) else study.get('_id'),
            'study_code': study.get('code'),
            'criteria': criteria,
            'sessions': sessions,
        }

    def export_backup_zip(self, study_session_id):
        from app.services.export_service import ExportService

        study = self._studies.find_by_id(study_session_id)
        if not study:
            raise NotFoundError('Study session not found')

        input_id = self._studies._to_oid(study.get('input_id'))
        criteria = []
        if input_id:
            input_doc = self._inputs.find_by_id(input_id)
            if isinstance(input_doc, dict):
                criteria = input_doc.get('criteria', [])

        sessions = self._sessions.find_by_study_session_id(study_session_id)
        session_id_to_name = {
            str(session.get('_id')): session.get('name', str(session.get('_id')))
            for session in sessions
        }

        metadata = {
            'version': 2,
            'exported_at': datetime.now(timezone.utc).isoformat(),
            'study': {
                'code': study.get('code'),
                'title': study.get('title', ''),
                'description': study.get('description', ''),
                'features': study.get('features', {'qi': False, 'vf': False, 'bwt': False}),
                'vf_method': study.get('vf_method', 'mid-splitting'),
                'created_at': study.get('created_at').isoformat() if study.get('created_at') else None,
            },
            'sessions': [
                {
                    'name': s.get('name'),
                    'friendly_name': s.get('friendly_name', ''),
                    'created_at': s.get('created_at').isoformat() if s.get('created_at') else None,
                }
                for s in sessions
            ],
            'workflow': {
                'workflow_preferences': self._to_backup_jsonable(study.get('workflow_preferences', {})),
                'computed_weights': self._export_computed_weights_for_backup(
                    study.get('computed_weights', {}),
                    session_id_to_name,
                ),
                'step_2_results': self._to_backup_jsonable(study.get('step_2_results')),
                'step_3_results': self._to_backup_jsonable(study.get('step_3_results')),
                'step_4_results': self._to_backup_jsonable(study.get('step_4_results')),
                'step_5_results': self._to_backup_jsonable(study.get('step_5_results')),
                'step_6_results': self._to_backup_jsonable(study.get('step_6_results')),
            },
        }

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('metadata.json', json.dumps(metadata, ensure_ascii=False, indent=2))
            zf.writestr('input/input.json', json.dumps({'criteria': criteria}, ensure_ascii=False, indent=2))

            for session in sessions:
                session_name = session.get('name', str(session.get('_id')))
                qualitative = session.get('qualitative_indicators') or {}
                value_functions = session.get('value_functions') or {}
                vf_criteria = value_functions.get('criteria', {}) if isinstance(value_functions, dict) else {}
                bwt = session.get('bwt') or {}

                session_payload = {
                    'name': session_name,
                    'friendly_name': s.get('friendly_name', ''),
                    'qualitative_indicators': session.get('qualitative_indicators'),
                    'value_functions': session.get('value_functions'),
                    'bwt': session.get('bwt'),
                    'locked': bool(session.get('locked', False)),
                    'session_locked': bool(session.get('session_locked', False)),
                }
                zf.writestr(
                    f'sessions/{session_name}.json',
                    json.dumps(session_payload, ensure_ascii=False, indent=2),
                )

                zf.writestr(
                    f'csv/{session_name}/input_raw_{session_name}.csv',
                    ExportService.build_input_raw_csv(criteria),
                )
                zf.writestr(
                    f'csv/{session_name}/qualitative_{session_name}.csv',
                    ExportService.build_qualitative_csv(criteria, qualitative),
                )
                zf.writestr(
                    f'csv/{session_name}/value_functions_{session_name}.csv',
                    ExportService.build_value_functions_csv(criteria, vf_criteria, qualitative),
                )
                zf.writestr(
                    f'csv/{session_name}/pile_bwt_{session_name}.csv',
                    ExportService.build_pile_bwt_csv(bwt),
                )

        buf.seek(0)
        return buf, f'backup_{study.get("code", study_session_id)}.zip', 'application/zip'

    def import_backup_zip(self, zip_bytes, on_conflict='abort', contact_email=''):
        if on_conflict not in ('abort', 'regenerate'):
            raise ValidationError('Invalid on_conflict value')

        try:
            zip_buf = io.BytesIO(zip_bytes)
            with zipfile.ZipFile(zip_buf, 'r') as zf:
                metadata = json.loads(zf.read('metadata.json').decode('utf-8'))
                input_payload = json.loads(zf.read('input/input.json').decode('utf-8'))
                session_files = [name for name in zf.namelist() if name.startswith('sessions/') and name.endswith('.json')]
                session_payloads = [json.loads(zf.read(path).decode('utf-8')) for path in session_files]
        except KeyError as exc:
            raise ValidationError(f'Invalid backup ZIP format: missing {exc}') from exc
        except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValidationError('Invalid backup ZIP file') from exc

        requested_study_code = ((metadata.get('study') or {}).get('code') or '').strip()
        if not requested_study_code:
            raise ValidationError('Backup metadata missing study code')

        if self._studies.find_by_code(requested_study_code):
            if on_conflict == 'abort':
                raise ConflictError('Study code conflict')
            requested_study_code = self.generate_unique_study_code()

        study_meta = metadata.get('study') or {}
        study_session_id = self.create(
            requested_study_code,
            title=study_meta.get('title', ''),
            description=study_meta.get('description', ''),
            contact_email=contact_email,
        )

        self.update_features(
            study_session_id,
            study_meta.get('features') or {'qi': False, 'vf': False, 'bwt': False},
            study_meta.get('vf_method'),
        )
        self.update_input(study_session_id, input_payload.get('criteria') or [])

        imported_sessions = []
        backup_name_to_new_session_id = {}
        for payload in session_payloads:
            backup_session_name = (payload.get('name') or '').strip()
            requested_name = backup_session_name
            if not requested_name:
                requested_name = self.generate_unique_session_code()

            if self._sessions.find_by_name(requested_name):
                if on_conflict == 'abort':
                    raise ConflictError(f'Session code conflict: {requested_name}')
                requested_name = self.generate_unique_session_code()

            created_session_id = self.create_elicitation_session(study_session_id, requested_name)
            self._sessions.update(created_session_id, {
                'friendly_name': str(payload.get('friendly_name') or '').strip(),
                'qualitative_indicators': payload.get('qualitative_indicators'),
                'value_functions': payload.get('value_functions'),
                'bwt': payload.get('bwt'),
                'locked': bool(payload.get('locked', False)),
                'session_locked': bool(payload.get('session_locked', False)),
            })
            if backup_session_name:
                backup_name_to_new_session_id[backup_session_name] = created_session_id
            imported_sessions.append(requested_name)

        workflow_payload = metadata.get('workflow') or {}
        study_updates = {}

        workflow_preferences = workflow_payload.get('workflow_preferences')
        if isinstance(workflow_preferences, dict):
            study_updates['workflow_preferences'] = workflow_preferences

        computed_weights = self._import_computed_weights_from_backup(
            workflow_payload.get('computed_weights'),
            backup_name_to_new_session_id,
        )
        if computed_weights:
            study_updates['computed_weights'] = computed_weights

        for step_field in ('step_2_results', 'step_3_results', 'step_4_results', 'step_5_results', 'step_6_results'):
            restored_step = self._import_step_results_from_backup(workflow_payload.get(step_field))
            if restored_step is not None:
                study_updates[step_field] = restored_step

        if study_updates:
            self._studies.update(study_session_id, study_updates)

        return {
            'study_session_id': study_session_id,
            'code': requested_study_code,
            'imported_sessions': imported_sessions,
        }

    # ------------------------------------------------------------------
    # Email-notification helpers
    # ------------------------------------------------------------------

    def complete_elicitation_session(self, session_id):
        """Mark an elicitation session as complete and return relevant context.

        Sets ``session_locked = True`` on the session document so the
        stakeholder can no longer submit changes.  Returns the session and its
        parent study session so the caller can send an email notification.

        Args:
            session_id: The elicitation session's ``_id`` (string or ObjectId).

        Returns:
            dict: A dict with keys ``'session'`` (the updated elicitation
            session) and ``'study'`` (the parent study session, or ``None``
            when the session is not linked to a study).

        Raises:
            NotFoundError: When the elicitation session does not exist.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        self._sessions.update(session_id, {'session_locked': True})
        session['session_locked'] = True
        session['_id'] = str(session['_id'])

        study = None
        study_session_id = session.get('study_session_id')
        if study_session_id:
            study = self._studies.find_by_id(str(study_session_id))
            if study:
                study['_id'] = str(study['_id'])

        return {'session': session, 'study': study}

    def get_inactive_study_sessions(self, months=12):
        """Return study sessions that have been inactive for *months* or more.

        A session is considered inactive when its ``last_modified_at``
        timestamp is more than *months* months in the past.  Sessions created
        before ``last_modified_at`` was tracked fall back to ``created_at``.

        Args:
            months (int): Inactivity threshold in months (default: ``12``).

        Returns:
            list[dict]: Serialised study session documents with an extra
            ``'months_inactive'`` key.
        """
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=months * 30)
        studies = self._studies.find_all()
        inactive = []
        for study in studies:
            last_activity = study.get('last_modified_at') or study.get('created_at')
            if last_activity is None:
                continue
            if last_activity.tzinfo is None:
                last_activity = last_activity.replace(tzinfo=timezone.utc)
            if last_activity <= cutoff:
                delta_days = (datetime.now(timezone.utc) - last_activity).days
                months_inactive = delta_days / 30.0
                serialised = self._serialize_study(study)
                serialised['months_inactive'] = months_inactive
                inactive.append(serialised)
        return inactive
