"""Business logic for study sessions.

A *study session* represents a practitioner-level experiment that groups
multiple elicitation sessions (one per stakeholder) around shared input
criteria and feature settings.
"""

from datetime import datetime, timezone
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
        return serialized

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
        if include_sessions:
            sessions = self._sessions.find_by_study_session_id(study_id)
            for s in sessions:
                s['_id'] = str(s['_id'])
                s['study_session_id'] = self._studies._str_id(s.get('study_session_id'))
                s['input_id'] = self._studies._str_id(s.get('input_id'))
                s['computed_weights'] = self._serialize_computed_weights(study)
            study['sessions'] = sessions
        return study

    def create(self, code):
        """Create a new study session with the given practitioner code.

        Args:
            code (str): A unique identifier chosen by the practitioner.

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
        doc = {
            'code': code,
            'input_id': None,
            'features': {'qi': False, 'vf': False, 'bwt': False},
            'created_at': datetime.now(timezone.utc),
        }
        inserted_id = self._studies.insert(doc)
        return str(inserted_id)

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

    def update_features(self, study_session_id, features):
        """Update the feature flags of a study session.

        Only the ``qi``, ``vf``, and ``bwt`` flags are accepted; all values
        are coerced to booleans.

        Args:
            study_session_id: The study session's ``_id``.
            features (dict | None): A dict with any combination of ``'qi'``,
                ``'vf'``, ``'bwt'`` keys and boolean-coercible values.

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
        if update_doc:
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
            s['computed_weights'] = self._serialize_computed_weights(study)
        return {
            'study_session_id': str(study['_id']) if isinstance(study.get('_id'), ObjectId) else study.get('_id'),
            'study_code': study.get('code'),
            'criteria': criteria,
            'sessions': sessions,
        }
