"""Unit tests for SessionService."""
import pytest
from bson.objectid import ObjectId

from app.exceptions import NotFoundError, ValidationError, LockedError
from app.services.session_service import SessionService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_CRITERIA = [
    {
        'criterion_name': 'Cost',
        'unit': 'EUR',
        'alternatives': [{'name': 'A', 'value': '100'}, {'name': 'B', 'value': '200'}],
    }
]

QUALITATIVE_CRITERIA = [
    {
        'criterion_name': 'Quality',
        'unit': '',
        'is_qualitative': True,
        'alternatives': [{'name': 'A', 'value': ''}, {'name': 'B', 'value': ''}],
    }
]


@pytest.fixture()
def svc(mock_db):
    return SessionService(mock_db)


# ---------------------------------------------------------------------------
# validate_criteria
# ---------------------------------------------------------------------------

class TestValidateCriteria:
    def test_empty_list_raises(self, svc):
        with pytest.raises(ValidationError, match='At least one criterion'):
            svc.validate_criteria([])

    def test_non_list_raises(self, svc):
        with pytest.raises(ValidationError):
            svc.validate_criteria(None)

    def test_missing_required_field_raises(self, svc):
        with pytest.raises(ValidationError, match='missing required fields'):
            svc.validate_criteria([{'criterion_name': 'X', 'unit': 'km'}])  # no alternatives

    def test_non_dict_item_raises(self, svc):
        with pytest.raises(ValidationError, match='not valid'):
            svc.validate_criteria(['not a dict'])

    def test_invalid_alternative_raises(self, svc):
        with pytest.raises(ValidationError, match='invalid'):
            svc.validate_criteria([{
                'criterion_name': 'X',
                'unit': 'km',
                'alternatives': [{'name': 'A'}],  # missing 'value'
            }])

    def test_defaults_group_and_description(self, svc):
        result = svc.validate_criteria(VALID_CRITERIA)
        assert result[0]['group'] == ''
        assert result[0]['description'] == ''

    def test_preserves_explicit_group_and_description(self, svc):
        c = dict(VALID_CRITERIA[0])
        c['group'] = 'G1'
        c['description'] = 'Desc'
        result = svc.validate_criteria([c])
        assert result[0]['group'] == 'G1'
        assert result[0]['description'] == 'Desc'

    def test_non_string_group_raises(self, svc):
        c = dict(VALID_CRITERIA[0])
        c['group'] = 123
        with pytest.raises(ValidationError, match='group must be a string'):
            svc.validate_criteria([c])


# ---------------------------------------------------------------------------
# validate_input_for_features
# ---------------------------------------------------------------------------

class TestValidateInputForFeatures:
    def test_qi_active_requires_alternatives(self, svc):
        criteria = [{'criterion_name': 'X', 'unit': '', 'alternatives': []}]
        with pytest.raises(ValidationError, match='QI requires'):
            svc.validate_input_for_features(criteria, {'qi': True, 'vf': False, 'bwt': False})

    def test_vf_active_requires_names(self, svc):
        criteria = [{'criterion_name': '', 'unit': '', 'alternatives': []}]
        with pytest.raises(ValidationError, match='must have a name'):
            svc.validate_input_for_features(criteria, {'qi': False, 'vf': True, 'bwt': False})

    def test_no_active_features_always_passes(self, svc):
        svc.validate_input_for_features(VALID_CRITERIA, {'qi': False, 'vf': False, 'bwt': False})


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

class TestSessionCrud:
    def test_create_returns_string_id(self, svc):
        sid = svc.create('TestSession', VALID_CRITERIA)
        assert isinstance(sid, str)
        assert len(sid) == 24  # ObjectId hex

    def test_get_by_id_returns_session(self, svc):
        sid = svc.create('S1', VALID_CRITERIA)
        session = svc.get_by_id(sid)
        assert session['name'] == 'S1'
        assert isinstance(session['_id'], str)

    def test_get_by_id_not_found_raises(self, svc):
        with pytest.raises(NotFoundError, match='Session not found'):
            svc.get_by_id(str(ObjectId()))

    def test_get_by_id_invalid_id_raises(self, svc):
        with pytest.raises((NotFoundError, Exception)):
            svc.get_by_id('not-an-objectid')

    def test_get_by_name_existing(self, svc):
        svc.create('Named', VALID_CRITERIA)
        result = svc.get_by_name('Named')
        assert result is not None
        assert result['exists'] is True

    def test_get_by_name_missing_returns_none(self, svc):
        assert svc.get_by_name('ghost') is None

    def test_get_all_returns_list(self, svc):
        svc.create('S1', VALID_CRITERIA)
        svc.create('S2', VALID_CRITERIA)
        all_sessions = svc.get_all()
        assert len(all_sessions) == 2

    def test_delete_removes_session(self, svc):
        sid = svc.create('ToDelete', VALID_CRITERIA)
        svc.delete(sid)
        with pytest.raises(NotFoundError):
            svc.get_by_id(sid)

    def test_delete_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.delete(str(ObjectId()))


# ---------------------------------------------------------------------------
# Lock toggles
# ---------------------------------------------------------------------------

class TestLockToggle:
    def test_toggle_lock_initially_false(self, svc):
        sid = svc.create('L', VALID_CRITERIA)
        result = svc.toggle_lock(sid)
        assert result is True

    def test_toggle_lock_second_call_returns_false(self, svc):
        sid = svc.create('L2', VALID_CRITERIA)
        svc.toggle_lock(sid)
        result = svc.toggle_lock(sid)
        assert result is False

    def test_toggle_session_lock_initially_false(self, svc):
        sid = svc.create('SL', VALID_CRITERIA)
        result = svc.toggle_session_lock(sid)
        assert result is True

    def test_toggle_lock_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.toggle_lock(str(ObjectId()))


# ---------------------------------------------------------------------------
# update_criteria
# ---------------------------------------------------------------------------

class TestUpdateCriteria:
    def test_update_criteria_ok(self, svc):
        sid = svc.create('UC', VALID_CRITERIA)
        new_criteria = [
            {
                'criterion_name': 'Cost',
                'unit': 'USD',
                'alternatives': [{'name': 'A', 'value': '50'}],
            }
        ]
        svc.update_criteria(sid, new_criteria)
        session = svc.get_by_id(sid)
        assert session['criteria'][0]['unit'] == 'USD'

    def test_update_criteria_locked_session_raises(self, svc):
        sid = svc.create('LK', VALID_CRITERIA)
        svc.toggle_session_lock(sid)
        with pytest.raises(LockedError):
            svc.update_criteria(sid, VALID_CRITERIA)

    def test_update_criteria_locked_input_raises(self, svc):
        sid = svc.create('LI', VALID_CRITERIA)
        svc.toggle_lock(sid)
        with pytest.raises(LockedError):
            svc.update_criteria(sid, VALID_CRITERIA)

    def test_became_qualitative_clears_value_functions(self, svc):
        """Criteria that flip to qualitative must be removed from value_functions."""
        sid = svc.create('VF', VALID_CRITERIA)
        # Set value_functions with 'Cost' entry
        svc.update_value_functions(sid, {'criteria': {'Cost': {'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}]}}})
        # Now flip 'Cost' to qualitative
        new_criteria = [
            {
                'criterion_name': 'Cost',
                'unit': 'EUR',
                'is_qualitative': True,
                'alternatives': [{'name': 'A', 'value': ''}, {'name': 'B', 'value': ''}],
            }
        ]
        svc.update_criteria(sid, new_criteria)
        session = svc.get_by_id(sid)
        vf = session.get('value_functions') or {}
        assert 'Cost' not in vf.get('criteria', {})


# ---------------------------------------------------------------------------
# update_qualitative / value_functions / bwt
# ---------------------------------------------------------------------------

class TestUpdateFields:
    def test_update_qualitative_ok(self, svc, mock_db):
        sid = svc.create('Q', QUALITATIVE_CRITERIA)
        value = {
            'Quality': {
                'ranking': {'A': 1, 'B': 2},
                'values': {'1': 0.8, '2': 0.3},
            }
        }
        svc.update_qualitative(sid, value)
        session = svc.get_by_id(sid)
        assert session['qualitative_indicators'] is not None

    def test_update_qualitative_locked_raises(self, svc):
        sid = svc.create('QL', QUALITATIVE_CRITERIA)
        svc.toggle_session_lock(sid)
        with pytest.raises(LockedError):
            svc.update_qualitative(sid, {})

    def test_update_value_functions_ok(self, svc):
        sid = svc.create('VF', VALID_CRITERIA)
        svc.update_value_functions(sid, {'criteria': {}})
        session = svc.get_by_id(sid)
        assert session['value_functions'] == {'criteria': {}}

    def test_update_value_functions_locked_raises(self, svc):
        sid = svc.create('VFL', VALID_CRITERIA)
        svc.toggle_session_lock(sid)
        with pytest.raises(LockedError):
            svc.update_value_functions(sid, {})

    def test_update_bwt_ok(self, svc):
        sid = svc.create('BWT', VALID_CRITERIA)
        svc.update_bwt(sid, {'comparisons': []})
        session = svc.get_by_id(sid)
        assert session['bwt'] == {'comparisons': []}

    def test_update_bwt_locked_raises(self, svc):
        sid = svc.create('BWTL', VALID_CRITERIA)
        svc.toggle_session_lock(sid)
        with pytest.raises(LockedError):
            svc.update_bwt(sid, {})


# ---------------------------------------------------------------------------
# Completeness checks
# ---------------------------------------------------------------------------

class TestCompletenessChecks:
    def test_is_qualitative_complete_true(self):
        criteria = [{'criterion_name': 'Q', 'is_qualitative': True}]
        qi = {'Q': {'ranking': {'A': 1}, 'values': {1: 0.5}}}
        assert SessionService.is_qualitative_complete(criteria, qi) is True

    def test_is_qualitative_complete_missing_data(self):
        criteria = [{'criterion_name': 'Q', 'is_qualitative': True}]
        assert SessionService.is_qualitative_complete(criteria, {}) is False

    def test_is_qualitative_complete_empty_ranking(self):
        criteria = [{'criterion_name': 'Q', 'is_qualitative': True}]
        qi = {'Q': {'ranking': {}, 'values': {}}}
        assert SessionService.is_qualitative_complete(criteria, qi) is False

    def test_is_qualitative_complete_no_qualitative_criteria(self):
        criteria = [{'criterion_name': 'C', 'is_qualitative': False}]
        assert SessionService.is_qualitative_complete(criteria, {}) is True

    def test_is_value_functions_complete_true(self):
        criteria = [{'criterion_name': 'C'}]
        vf = {'criteria': {'C': {'points': [{'x': 0, 'y': 0}]}}}
        assert SessionService.is_value_functions_complete(criteria, vf) is True

    def test_is_value_functions_complete_missing(self):
        criteria = [{'criterion_name': 'C'}]
        assert SessionService.is_value_functions_complete(criteria, {}) is False

    def test_is_value_functions_complete_skips_qualitative(self):
        criteria = [{'criterion_name': 'Q', 'is_qualitative': True}]
        # No entry in value_functions needed for qualitative
        assert SessionService.is_value_functions_complete(criteria, {}) is True


# ---------------------------------------------------------------------------
# normalize_qualitative_indicators
# ---------------------------------------------------------------------------

class TestNormalizeQualitativeIndicators:
    def test_non_dict_returns_empty(self):
        assert SessionService.normalize_qualitative_indicators([], None) == {}

    def test_normalizes_confidences(self):
        criteria = [{'criterion_name': 'Q', 'is_qualitative': True}]
        qi = {
            'Q': {
                'ranking': {'A': 1, 'B': 2},
                'values': {1: 0.8, 2: 0.3},
                'confidences': {1: 3, 2: 4},
            }
        }
        result = SessionService.normalize_qualitative_indicators(criteria, qi)
        assert '1' in result['Q']['confidences']
        assert '2' in result['Q']['confidences']

    def test_passes_through_non_qualitative_keys(self):
        criteria = [{'criterion_name': 'Q', 'is_qualitative': True}]
        qi = {'OTHER': 'data'}
        result = SessionService.normalize_qualitative_indicators(criteria, qi)
        assert result['OTHER'] == 'data'


# ---------------------------------------------------------------------------
# detect_type
# ---------------------------------------------------------------------------

class TestDetectType:
    def test_detects_stakeholder_session(self, svc):
        svc.create('mycode', VALID_CRITERIA)
        result = svc.detect_type('mycode')
        assert result['exists'] is True
        assert result['type'] == 'stakeholder'

    def test_detects_missing_code(self, svc):
        result = svc.detect_type('nonexistent')
        assert result['exists'] is False

    def test_detects_stakeholder_session_by_uuid(self, svc):
        session_id = svc.create('mycode', VALID_CRITERIA)
        result = svc.detect_type(session_id)
        assert result['exists'] is True
        assert result['type'] == 'stakeholder'
        assert result['_id'] == session_id
        assert result['code'] == 'mycode'

    def test_detects_unknown_uuid_returns_not_exists(self, svc):
        unknown_id = str(ObjectId())
        result = svc.detect_type(unknown_id)
        assert result['exists'] is False

    def test_uuid_lookup_returns_name_as_code(self, svc):
        session_id = svc.create('human-code', VALID_CRITERIA)
        result = svc.detect_type(session_id)
        assert result['code'] == 'human-code'
