from datetime import datetime, timezone
from bson.objectid import ObjectId

from app.repositories import SessionRepository, InputRepository
from app.exceptions import NotFoundError, ValidationError, ConflictError, LockedError


class SessionService:
    def __init__(self, db):
        self._sessions = SessionRepository(db)
        self._inputs = InputRepository(db)

    # ------------------------------------------------------------------ #
    # Internal normalization helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _normalize_rank_key(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return value

    @staticmethod
    def _normalize_confidence_value(value, default=4):
        try:
            confidence = int(value)
        except (TypeError, ValueError):
            confidence = default
        return max(0, min(4, confidence))

    @classmethod
    def _build_rank_confidences_from_alternatives(cls, ranking, confidences_alternatives):
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
        """Returns normalized criteria list or raises ValidationError."""
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
    def validate_input_for_features(criteria, features):
        """Raises ValidationError if criteria do not satisfy activated features."""
        if not isinstance(criteria, list) or len(criteria) == 0:
            raise ValidationError('At least one criterion is required')
        features = features or {'qi': False, 'vf': False, 'bwt': False}
        qi_active = features.get('qi', False)
        vf_active = features.get('vf', False)
        bwt_active = features.get('bwt', False)
        if qi_active:
            for idx, criterion in enumerate(criteria):
                alternatives = criterion.get('alternatives', [])
                if not isinstance(alternatives, list) or len(alternatives) == 0:
                    raise ValidationError(
                        f'QI requires alternatives for all criteria. '
                        f'Criterion "{criterion.get("criterion_name")}" at position {idx + 1} is missing alternatives'
                    )
        if vf_active or bwt_active:
            for idx, criterion in enumerate(criteria):
                if not criterion.get('criterion_name'):
                    raise ValidationError(f'Criterion {idx + 1} must have a name')

    # ------------------------------------------------------------------ #
    # Criteria resolution
    # ------------------------------------------------------------------ #
    def resolve_session_criteria(self, session):
        """Return the criteria list for a session (from input doc or embedded)."""
        if not isinstance(session, dict):
            return []
        input_id = self._sessions._to_oid(session.get('input_id'))
        if input_id:
            input_doc = self._inputs.find_by_id(input_id)
            if isinstance(input_doc, dict) and isinstance(input_doc.get('criteria'), list):
                return input_doc.get('criteria')
        return session.get('criteria', [])

    def _serialize_session(self, session):
        """Serialize ObjectId fields and attach criteria to a session dict."""
        session['_id'] = str(session['_id'])
        if 'input_id' in session:
            session['input_id'] = self._sessions._str_id(session.get('input_id'))
        if 'study_session_id' in session:
            session['study_session_id'] = self._sessions._str_id(session.get('study_session_id'))
        session['criteria'] = self.resolve_session_criteria(session)
        return session

    # ------------------------------------------------------------------ #
    # Completeness checks
    # ------------------------------------------------------------------ #
    @staticmethod
    def is_qualitative_complete(criteria, qualitative_indicators):
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
        criteria = self.validate_criteria(criteria)
        doc = {
            'name': name,
            'criteria': criteria,
            'qualitative_indicators': None,
            'value_functions': None,
            'bwt': None,
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        inserted_id = self._sessions.insert(doc)
        return str(inserted_id)

    def get_by_id(self, session_id):
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        return self._serialize_session(session)

    def get_by_name(self, name):
        session = self._sessions.find_by_name(name)
        if not session:
            return None
        self._serialize_session(session)
        session['exists'] = True
        return session

    def get_all(self):
        sessions = self._sessions.find_all()
        for s in sessions:
            s['_id'] = str(s['_id'])
            self._serialize_session(s)
        return sessions

    def detect_type(self, db, code):
        """Returns {'exists': bool, 'type': ..., '_id': ..., 'code': ...}."""
        stakeholder = self._sessions.find_by_name(code)
        if stakeholder:
            return {'exists': True, 'type': 'stakeholder', '_id': str(stakeholder['_id']), 'code': code}
        from app.repositories import StudySessionRepository
        study_repo = StudySessionRepository(db)
        practitioner = study_repo.find_by_code(code)
        if practitioner:
            return {'exists': True, 'type': 'practitioner', '_id': str(practitioner['_id']), 'code': code}
        return {'exists': False}

    def delete(self, session_id):
        deleted = self._sessions.delete(session_id)
        if deleted == 0:
            raise NotFoundError('Session not found')

    def update_criteria(self, session_id, criteria):
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

    def toggle_lock(self, session_id):
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        new_locked = not session.get('locked', False)
        self._sessions.update(session_id, {'locked': new_locked})
        return new_locked

    def toggle_session_lock(self, session_id):
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        new_locked = not session.get('session_locked', False)
        self._sessions.update(session_id, {'session_locked': new_locked})
        return new_locked

    def update_qualitative(self, session_id, value):
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        criteria = self.resolve_session_criteria(session)
        normalized = self.normalize_qualitative_indicators(criteria, value)
        self._sessions.update(session_id, {'qualitative_indicators': normalized})

    def update_value_functions(self, session_id, value):
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        self._sessions.update(session_id, {'value_functions': value})

    def update_bwt(self, session_id, value):
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        if session.get('session_locked', False):
            raise LockedError('Session is locked')
        self._sessions.update(session_id, {'bwt': value})
