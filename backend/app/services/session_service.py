"""Business logic for elicitation sessions.

This module provides :class:`SessionService`, which handles creation,
retrieval, validation, locking, and data updates for individual elicitation
sessions.
"""

import logging
from datetime import datetime, timezone
from bson.objectid import ObjectId

from app.repositories import SessionRepository, InputRepository
from app.exceptions import NotFoundError, ValidationError, ConflictError, LockedError

logger = logging.getLogger(__name__)


class SessionService:
    """Service layer for elicitation session operations."""

    DEFAULT_PRACTITIONER_SETTINGS = {
        'notes': '',
        'overall_weight': 1.0,
        'confidence_adjustments': {
            'overall': 0.0,
            'qi': 0.0,
            'vf': 0.0,
            'qi_criteria': {},
            'vf_criteria': {},
        },
    }

    def __init__(self, db):
        """Initialise the service with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._db = db
        self._sessions = SessionRepository(db)
        self._inputs = InputRepository(db)

    # ------------------------------------------------------------------ #
    # Internal normalization helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _normalize_rank_key(value):
        """Convert a rank value to an integer when possible.

        Args:
            value: A rank value (typically an int or numeric string).

        Returns:
            int | value: The integer rank, or the original value if
            conversion fails.
        """
        try:
            return int(value)
        except (TypeError, ValueError):
            return value

    @staticmethod
    def _normalize_confidence_value(value, default=4):
        """Clamp a confidence value to the valid range [0, 4].

        Args:
            value: The raw confidence value.
            default (int): Fallback value used when *value* cannot be parsed
                as an integer.  Defaults to ``4``.

        Returns:
            int: The clamped confidence in the range [0, 4].
        """
        try:
            confidence = int(value)
        except (TypeError, ValueError):
            confidence = default
        return max(0, min(4, confidence))

    @staticmethod
    def _normalize_adjustment_value(value, default=0.0):
        """Clamp a confidence adjustment to the valid range [-4.0, 4.0]."""
        try:
            adjustment = float(value)
        except (TypeError, ValueError):
            adjustment = default
        if adjustment < -4.0 or adjustment > 4.0:
            return float(default)
        return round(adjustment, 1)

    @staticmethod
    def _normalize_weight_value(value, default=1.0):
        """Normalize a practitioner opinion weight to a non-negative float."""
        try:
            weight = float(value)
        except (TypeError, ValueError):
            return float(default)
        if weight < 0:
            return float(default)
        return weight

    @classmethod
    def _build_rank_confidences_from_alternatives(cls, ranking, confidences_alternatives):
        """Build a rank → confidence mapping from per-alternative confidence data.

        This supports a legacy input format where confidences are keyed by
        alternative name rather than by rank.  When multiple alternatives share
        the same rank their confidences are averaged.

        Args:
            ranking (dict): Mapping of alternative name → rank.
            confidences_alternatives (dict): Mapping of alternative name →
                raw confidence value.

        Returns:
            dict: Mapping of rank (int) → averaged confidence (int).  Returns
            an empty dict if either argument is not a dict.
        """
        if not isinstance(ranking, dict) or not isinstance(confidences_alternatives, dict):
            return {}
        confidence_by_rank = {}
        for alt_name, rank in ranking.items():
            rank_key = cls._normalize_rank_key(rank)
            conf_raw = confidences_alternatives.get(alt_name)
            if conf_raw is None:
                continue
            confidence_by_rank.setdefault(rank_key, []).append(
                cls._normalize_confidence_value(conf_raw, default=4)
            )
        return {
            rank_key: int(round(sum(values) / len(values)))
            for rank_key, values in confidence_by_rank.items()
            if values
        }

    @classmethod
    def _normalize_qualitative_confidences(cls, ranking, confidences, confidences_alternatives=None):
        """Build a normalised rank → confidence mapping for a single qualitative criterion.

        Merges confidence data from two possible sources:

        * *confidences* – a dict keyed by rank (preferred).
        * *confidences_alternatives* – a legacy dict keyed by alternative name.

        Args:
            ranking (dict): Mapping of alternative name → rank.
            confidences (dict | None): Mapping of rank → raw confidence value.
            confidences_alternatives (dict | None): Legacy mapping of
                alternative name → raw confidence value.

        Returns:
            dict: Mapping of str(rank) → clamped confidence int [0, 4].  Returns
            an empty dict when *ranking* is not a dict.
        """
        if not isinstance(ranking, dict):
            return {}
        legacy = cls._build_rank_confidences_from_alternatives(ranking, confidences_alternatives)
        normalized = {}
        unique_ranks = {cls._normalize_rank_key(r) for r in ranking.values()}
        for rank in unique_ranks:
            conf_raw = None
            if isinstance(confidences, dict):
                conf_raw = confidences.get(rank)
                if conf_raw is None:
                    conf_raw = confidences.get(str(rank))
            if conf_raw is None:
                conf_raw = legacy.get(rank)
            normalized[str(rank)] = cls._normalize_confidence_value(conf_raw, default=4)
        return normalized

    @classmethod
    def normalize_qualitative_indicators(cls, criteria, qualitative_indicators):
        """Normalise all qualitative indicator entries in a session document.

        For each qualitative criterion the method:

        * Ensures ``ranking`` and ``values`` are dicts (substituting empty
          dicts when absent).
        * Normalises ``confidences`` via
          :meth:`_normalize_qualitative_confidences` so that every rank has a
          valid, clamped confidence value and all keys are strings.
        * Passes through entries for non-qualitative criteria unchanged.

        Args:
            criteria (list[dict]): The session's criteria list (used to
                identify which criteria are qualitative).
            qualitative_indicators (dict): Raw ``qualitative_indicators`` value
                from a session document.

        Returns:
            dict: A normalised copy of *qualitative_indicators*.  Returns an
            empty dict when *qualitative_indicators* is not a dict.
        """
        if not isinstance(qualitative_indicators, dict):
            return {}
        qualitative_names = set()
        if isinstance(criteria, list):
            qualitative_names = {
                c.get('criterion_name')
                for c in criteria
                if isinstance(c, dict) and c.get('is_qualitative') and c.get('criterion_name')
            }
        normalized = {}
        for criterion_name, raw_data in qualitative_indicators.items():
            if qualitative_names and criterion_name not in qualitative_names:
                normalized[criterion_name] = raw_data
                continue
            if not isinstance(raw_data, dict):
                normalized[criterion_name] = raw_data
                continue
            ranking = raw_data.get('ranking') if isinstance(raw_data.get('ranking'), dict) else {}
            values = raw_data.get('values') if isinstance(raw_data.get('values'), dict) else {}
            confidences = cls._normalize_qualitative_confidences(
                ranking,
                raw_data.get('confidences'),
                raw_data.get('confidences_alternatives'),
            )
            normalized[criterion_name] = {
                **raw_data,
                'ranking': ranking,
                'values': values,
                'confidences': confidences,
            }
        return normalized

    # ------------------------------------------------------------------ #
    # Validation
    # ------------------------------------------------------------------ #
    @staticmethod
    def validate_criteria(criteria):
        """Validate and normalise a list of criterion definitions.

        Required fields per criterion: ``criterion_name``, ``unit``,
        ``alternatives``.  Optional fields ``group`` and ``description`` are
        defaulted to empty strings when absent.

        Args:
            criteria (list[dict]): The raw criteria data supplied by the
                caller.

        Returns:
            list[dict]: The normalised criteria list.

        Raises:
            ValidationError: When *criteria* is empty, contains non-dict
                items, is missing required fields, or has invalid alternatives.
        """
        if not isinstance(criteria, list) or len(criteria) == 0:
            raise ValidationError('At least one criterion is required')
        required_fields = {'criterion_name', 'unit', 'alternatives'}
        normalized = []
        for idx, criterion in enumerate(criteria):
            if not isinstance(criterion, dict):
                raise ValidationError(f'Criterion {idx + 1} is not valid')
            if not required_fields.issubset(criterion.keys()):
                raise ValidationError(f'Criterion {idx + 1} is missing required fields')
            nc = dict(criterion)
            if 'group' not in nc:
                nc['group'] = ''
            if not isinstance(nc.get('group'), str):
                raise ValidationError(f'Criterion {idx + 1} group must be a string')
            if 'description' not in nc:
                nc['description'] = ''
            if not isinstance(nc.get('description'), str):
                raise ValidationError(f'Criterion {idx + 1} description must be a string')
            alternatives = nc.get('alternatives')
            if not isinstance(alternatives, list):
                raise ValidationError(f'Criterion {idx + 1} alternatives must be a list')
            for alt_idx, alt in enumerate(alternatives):
                if not isinstance(alt, dict) or 'name' not in alt or 'value' not in alt:
                    raise ValidationError(f'Criterion {idx + 1}, alternative {alt_idx + 1} is invalid')
            normalized.append(nc)
        return normalized

    @staticmethod
    def validate_input_for_features(criteria):
        """Validate that the criteria list satisfies the always-on workflow.

        Every criterion must have a name and at least one alternative.

        Args:
            criteria (list[dict]): The criteria to validate.

        Raises:
            ValidationError: When a feature constraint is violated.
        """
        if not isinstance(criteria, list) or len(criteria) == 0:
            raise ValidationError('At least one criterion is required')
        for idx, criterion in enumerate(criteria):
            alternatives = criterion.get('alternatives', [])
            if not isinstance(alternatives, list) or len(alternatives) == 0:
                raise ValidationError(
                    f'All criteria require at least one alternative. Criterion "{criterion.get("criterion_name")}" at position {idx + 1} is missing alternatives'
                )
            if not criterion.get('criterion_name'):
                raise ValidationError(f'Criterion {idx + 1} must have a name')

    # ------------------------------------------------------------------ #
    # Criteria resolution
    # ------------------------------------------------------------------ #
    def resolve_session_criteria(self, session):
        """Return the criteria list for a session.

        Fetches criteria from the linked input document when the session has an
        ``input_id``; otherwise returns the criteria embedded directly in the
        session document.

        Args:
            session (dict): A session document.

        Returns:
            list[dict]: The criteria list, or an empty list when none is found.
        """
        if not isinstance(session, dict):
            return []
        input_id = self._sessions._to_oid(session.get('input_id'))
        if input_id:
            try:
                input_doc = self._inputs.find_by_id(input_id)
                if isinstance(input_doc, dict):
                    criteria = input_doc.get('criteria')
                    if isinstance(criteria, list):
                        return criteria
            except Exception as e:
                logger.warning("Could not fetch input document %s: %s", input_id, e)
        return session.get('criteria', [])

    def _serialize_session(self, session):
        """Serialize ObjectId fields and attach resolved criteria to a session dict.

        Mutates *session* in-place and returns it.

        Args:
            session (dict): A raw MongoDB session document.

        Returns:
            dict: The same document with ``_id``, ``input_id``, and
            ``study_session_id`` converted to strings and ``criteria``
            populated.
        """
        session['_id'] = str(session['_id'])
        if 'input_id' in session:
            session['input_id'] = self._sessions._str_id(session.get('input_id'))
        if 'study_session_id' in session:
            session['study_session_id'] = self._sessions._str_id(session.get('study_session_id'))
        session['friendly_name'] = str(session.get('friendly_name') or '').strip()
        session['criteria'] = self.resolve_session_criteria(session)
        session['practitioner_settings'] = self.normalize_practitioner_settings(
            session['criteria'],
            session.get('practitioner_settings'),
        )
        return session

    @classmethod
    def normalize_practitioner_settings(cls, criteria, practitioner_settings):
        """Normalize practitioner-side notes, weight, and confidence adjustments."""
        settings = practitioner_settings if isinstance(practitioner_settings, dict) else {}
        confidence = settings.get('confidence_adjustments')
        confidence = confidence if isinstance(confidence, dict) else {}

        qi_names = []
        vf_names = []
        for criterion in criteria if isinstance(criteria, list) else []:
            if not isinstance(criterion, dict):
                continue
            name = criterion.get('criterion_name')
            if not name:
                continue
            if criterion.get('is_qualitative'):
                qi_names.append(name)
            else:
                vf_names.append(name)

        raw_qi_criteria = confidence.get('qi_criteria')
        raw_qi_criteria = raw_qi_criteria if isinstance(raw_qi_criteria, dict) else {}
        raw_vf_criteria = confidence.get('vf_criteria')
        raw_vf_criteria = raw_vf_criteria if isinstance(raw_vf_criteria, dict) else {}

        return {
            'notes': str(settings.get('notes') or '').strip(),
            'overall_weight': cls._normalize_weight_value(settings.get('overall_weight'), default=1.0),
            'confidence_adjustments': {
                'overall': cls._normalize_adjustment_value(confidence.get('overall'), default=0.0),
                'qi': cls._normalize_adjustment_value(confidence.get('qi'), default=0.0),
                'vf': cls._normalize_adjustment_value(confidence.get('vf'), default=0.0),
                'qi_criteria': {
                    name: cls._normalize_adjustment_value(raw_qi_criteria.get(name), default=0.0)
                    for name in qi_names
                },
                'vf_criteria': {
                    name: cls._normalize_adjustment_value(raw_vf_criteria.get(name), default=0.0)
                    for name in vf_names
                },
            },
        }

    # ------------------------------------------------------------------ #
    # Completeness checks
    # ------------------------------------------------------------------ #
    @staticmethod
    def is_qualitative_complete(criteria, qualitative_indicators):
        """Check whether all qualitative criteria have filled-in indicator data.

        A qualitative criterion is considered complete when its entry in
        *qualitative_indicators* contains non-empty ``ranking`` and ``values``
        dicts.

        Args:
            criteria (list[dict]): The session's criteria list.
            qualitative_indicators (dict): The session's qualitative indicator
                data.

        Returns:
            bool: ``True`` when every qualitative criterion has complete data;
            ``False`` otherwise.
        """
        if not isinstance(criteria, list):
            return False
        if not isinstance(qualitative_indicators, dict):
            return False
        for criterion in criteria:
            if not isinstance(criterion, dict) or not criterion.get('is_qualitative'):
                continue
            name = criterion.get('criterion_name')
            data = qualitative_indicators.get(name) if name else None
            if not isinstance(data, dict):
                return False
            ranking = data.get('ranking')
            values = data.get('values')
            if not isinstance(ranking, dict) or not isinstance(values, dict):
                return False
            if len(ranking) == 0 or len(values) == 0:
                return False
        return True

    @staticmethod
    def is_value_functions_complete(criteria, value_functions):
        """Check whether all non-qualitative criteria have defined value functions.

        A criterion's value function is considered complete when its entry in
        ``value_functions['criteria']`` contains a non-empty ``points`` list.
        Qualitative criteria are skipped (their value functions are generated
        automatically from the ranking data).

        Args:
            criteria (list[dict]): The session's criteria list.
            value_functions (dict): The session's value functions object,
                expected to contain a ``'criteria'`` sub-dict.

        Returns:
            bool: ``True`` when every non-qualitative criterion has at least
            one value function point; ``False`` otherwise.
        """
        if not isinstance(criteria, list):
            return False
        criteria_map = value_functions.get('criteria') if isinstance(value_functions, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}
        for criterion in criteria:
            if not isinstance(criterion, dict) or criterion.get('is_qualitative'):
                continue
            name = criterion.get('criterion_name')
            cfg = criteria_map.get(name) if name else None
            points = cfg.get('points') if isinstance(cfg, dict) else None
            if not isinstance(points, list) or len(points) == 0:
                return False
        return True

    # ------------------------------------------------------------------ #
    # CRUD
    # ------------------------------------------------------------------ #
    def create(self, name, criteria):
        """Create a new standalone elicitation session.

        Args:
            name (str): Unique session name (used as the stakeholder code).
            criteria (list[dict]): The criteria definitions for this session.

        Returns:
            str: The ``_id`` of the newly created session as a hex string.

        Raises:
            ValidationError: When *criteria* fails validation.
        """
        criteria = self.validate_criteria(criteria)
        doc = {
            'name': name,
            'friendly_name': '',
            'criteria': criteria,
            'qualitative_indicators': None,
            'value_functions': None,
            'bwt': None,
            'practitioner_settings': self.normalize_practitioner_settings(criteria, None),
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        inserted_id = self._sessions.insert(doc)
        return str(inserted_id)

    def get_by_id(self, session_id):
        """Retrieve and serialise a session by its identifier.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).

        Returns:
            dict: The serialised session document (all ObjectId fields are
            strings and ``criteria`` is populated).

        Raises:
            NotFoundError: When no session with that ``_id`` exists.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        return self._serialize_session(session)

    def get_by_name(self, name):
        """Retrieve a session by name, returning ``None`` when not found.

        Args:
            name (str): The session's unique name / stakeholder code.

        Returns:
            dict | None: The serialised session document (with ``exists=True``
            added) when found, or ``None`` when not found.
        """
        session = self._sessions.find_by_name(name)
        if not session:
            return None
        self._serialize_session(session)
        session['exists'] = True
        return session

    def get_all(self):
        """Return all elicitation sessions, newest first.

        Returns:
            list[dict]: Serialised session documents.
        """
        sessions = self._sessions.find_all()
        for s in sessions:
            s['_id'] = str(s['_id'])
            self._serialize_session(s)
        return sessions

    def detect_type(self, session_id):
        """Determine whether an ID belongs to a stakeholder or practitioner session.

        Searches in this order:

        1. Sessions collection by ``_id`` (ObjectId direct lookup).
        2. Study-sessions collection by ``_id`` (ObjectId direct lookup).

        Args:
            session_id (str): The session/study-session ID (24-char hex ObjectId) to look up.

        Returns:
            dict: A result dict with the following keys:

            * ``'exists'`` (bool) – whether the code was found.
            * ``'type'`` (str) – ``'stakeholder'`` or ``'practitioner'``
              (only present when ``exists`` is ``True``).
            * ``'_id'`` (str) – the document's ``_id`` as a hex string
              (only present when ``exists`` is ``True``).
            * ``'code'`` (str) – the session/study code for display
              (only present when ``exists`` is ``True``).
        """
        from app.repositories import StudySessionRepository
        study_repo = StudySessionRepository(self._db)
        stakeholder_by_id = self._sessions.find_by_id(session_id)
        if stakeholder_by_id:
            return {
                'exists': True,
                'type': 'stakeholder',
                '_id': str(stakeholder_by_id['_id']),
                'code': stakeholder_by_id.get('name', session_id),
            }
        practitioner_by_id = study_repo.find_by_id(session_id)
        if practitioner_by_id:
            return {
                'exists': True,
                'type': 'practitioner',
                '_id': str(practitioner_by_id['_id']),
                'code': practitioner_by_id.get('code', session_id),
            }
        return {'exists': False}

    def delete(self, session_id):
        """Delete an elicitation session by its identifier.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).

        Raises:
            NotFoundError: When no session with that ``_id`` exists.
        """
        deleted = self._sessions.delete(session_id)
        if deleted == 0:
            raise NotFoundError('Session not found')

    def update_criteria(self, session_id, criteria):
        """Update the criteria list for a session.

        Automatically reconciles dependent data:

        * Criteria that become qualitative have their value function entries
          removed.
        * Criteria that become non-qualitative have their qualitative indicator
          entries removed.

        When the session is linked to a shared input document the update is
        written to that document; otherwise it is written directly to the
        session.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).
            criteria (list[dict]): The new criteria definitions.

        Raises:
            ValidationError: When *criteria* fails validation.
            NotFoundError: When the session does not exist.
            LockedError: When the session or its input is locked.
        """
        criteria = self.validate_criteria(criteria)
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        if session.get('locked', False):
            raise LockedError('Input is locked')

        old_criteria = self.resolve_session_criteria(session)
        value_functions = session.get('value_functions') or {}
        qualitative_indicators = session.get('qualitative_indicators') or {}

        old_qual_map = {c.get('criterion_name'): c.get('is_qualitative', False) for c in old_criteria}
        new_qual_map = {c.get('criterion_name'): c.get('is_qualitative', False) for c in criteria}

        became_qualitative = []
        became_non_qualitative = []
        for cname, was_qual in old_qual_map.items():
            is_now_qual = new_qual_map.get(cname, False)
            if not was_qual and is_now_qual:
                became_qualitative.append(cname)
            elif was_qual and not is_now_qual:
                became_non_qualitative.append(cname)

        if became_qualitative and isinstance(value_functions, dict):
            cmap = value_functions.get('criteria', {})
            if isinstance(cmap, dict):
                for cname in became_qualitative:
                    cmap.pop(cname, None)
                value_functions['criteria'] = cmap

        if became_non_qualitative and isinstance(qualitative_indicators, dict):
            for cname in became_non_qualitative:
                qualitative_indicators.pop(cname, None)

        input_id = self._sessions._to_oid(session.get('input_id'))
        if input_id:
            self._inputs.update_criteria(input_id, criteria)
            payload = {'value_functions': value_functions, 'qualitative_indicators': qualitative_indicators}
        else:
            payload = {'criteria': criteria, 'value_functions': value_functions, 'qualitative_indicators': qualitative_indicators}

        self._sessions.update(session_id, payload)

    def update_friendly_name(self, session_id, friendly_name):
        """Update the practitioner-facing friendly name of a session.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).
            friendly_name (str): Friendly label shown in practitioner/admin UIs.

        Returns:
            dict: Updated serialized session document.

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When *friendly_name* is not a string.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        if not isinstance(friendly_name, str):
            raise ValidationError('Friendly name must be a string')

        self._sessions.update(session_id, {'friendly_name': friendly_name.strip()})
        updated = self._sessions.find_by_id(session_id)
        if not updated:
            raise NotFoundError('Session not found')
        return self._serialize_session(updated)

    def update_practitioner_settings(self, session_id, practitioner_settings):
        """Update practitioner-only notes, opinion weight, and confidence adjustments."""
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        if not isinstance(practitioner_settings, dict):
            raise ValidationError('practitioner_settings must be an object')

        criteria = self.resolve_session_criteria(session)
        normalized = self.normalize_practitioner_settings(criteria, practitioner_settings)
        self._sessions.update(session_id, {'practitioner_settings': normalized})
        updated = self._sessions.find_by_id(session_id)
        if not updated:
            raise NotFoundError('Session not found')
        return self._serialize_session(updated)

    def toggle_lock(self, session_id):
        """Toggle the input-lock flag on a session.

        When locked, the input (criteria) cannot be modified.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).

        Returns:
            bool: The new value of the ``locked`` flag.

        Raises:
            NotFoundError: When the session does not exist.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        new_locked = not session.get('locked', False)
        self._sessions.update(session_id, {'locked': new_locked})
        return new_locked

    def toggle_session_lock(self, session_id):
        """Toggle the session-lock flag on a session.

        When session-locked, qualitative indicators and value functions become
        read-only. PILE-BWT remains editable so users can continue weight
        elicitation.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).

        Returns:
            bool: The new value of the ``session_locked`` flag.

        Raises:
            NotFoundError: When the session does not exist.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        new_locked = not session.get('session_locked', False)
        self._sessions.update(session_id, {'session_locked': new_locked})
        return new_locked

    def update_qualitative(self, session_id, value):
        """Save qualitative indicator data for a session after normalisation.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).
            value (dict): Raw qualitative indicators keyed by criterion name.

        Raises:
            NotFoundError: When the session does not exist.
            LockedError: When the session is locked.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        # Check both practitioner lock and BWT user lock
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        if (session.get('bwt') or {}).get('qi_vf_lock_active', False):
            raise LockedError('QI/VF are locked by PILE-BWT')
        criteria = self.resolve_session_criteria(session)
        normalized = self.normalize_qualitative_indicators(criteria, value)
        self._sessions.update(session_id, {'qualitative_indicators': normalized})

    def update_value_functions(self, session_id, value):
        """Save value function data for a session.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).
            value (dict): Value functions object, expected to contain a
                ``'criteria'`` sub-dict mapping criterion names to point lists.

        Raises:
            NotFoundError: When the session does not exist.
            LockedError: When the session is locked.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        # Check both practitioner lock and BWT user lock
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        if (session.get('bwt') or {}).get('qi_vf_lock_active', False):
            raise LockedError('QI/VF are locked by PILE-BWT')
        self._sessions.update(session_id, {'value_functions': value})

    def update_bwt(self, session_id, value):
        """Save Best-Worst Technique (PILE-BWT) data for a session.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).
            value (dict): The BWT data object.

        Raises:
            NotFoundError: When the session does not exist.
            LockedError: When the session is locked by practitioner.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        # Only check practitioner lock (session_locked), not BWT user lock
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        self._sessions.update(session_id, {'bwt': value})
