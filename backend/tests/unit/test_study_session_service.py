"""Unit tests for StudySessionService."""
import pytest
from bson.objectid import ObjectId

from app.exceptions import NotFoundError, ValidationError, ConflictError
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
def svc(mock_db):
    return StudySessionService(mock_db)


@pytest.fixture()
def study_id(svc):
    """Create a study session and return its ID."""
    return svc.create('STUDY-001')


@pytest.fixture()
def study_with_input(svc, study_id):
    """Create a study session with input criteria."""
    svc.update_input(study_id, VALID_CRITERIA)
    return study_id


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------

class TestCreate:
    def test_create_returns_string_id(self, svc):
        sid = svc.create('MY-STUDY')
        assert isinstance(sid, str)
        assert len(sid) == 24

    def test_create_empty_code_raises(self, svc):
        with pytest.raises(ValidationError, match='code is required'):
            svc.create('')

    def test_create_none_code_raises(self, svc):
        with pytest.raises(ValidationError):
            svc.create(None)

    def test_duplicate_code_raises(self, svc, study_id):
        with pytest.raises(ConflictError, match='already exists'):
            svc.create('STUDY-001')


# ---------------------------------------------------------------------------
# get_by_id / get_by_code
# ---------------------------------------------------------------------------

class TestGet:
    def test_get_by_id_ok(self, svc, study_id):
        study = svc.get_by_id(study_id)
        assert study['code'] == 'STUDY-001'
        assert isinstance(study['_id'], str)

    def test_get_by_id_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.get_by_id(str(ObjectId()))

    def test_get_by_code_existing(self, svc, study_id):
        result = svc.get_by_code('STUDY-001')
        assert result['exists'] is True

    def test_get_by_code_missing(self, svc):
        result = svc.get_by_code('GHOST')
        assert result == {'exists': False}

    def test_get_all_returns_list(self, svc):
        svc.create('A')
        svc.create('B')
        all_studies = svc.get_all()
        assert len(all_studies) == 2


# ---------------------------------------------------------------------------
# update_features
# ---------------------------------------------------------------------------

class TestUpdateFeatures:
    def test_update_features_sets_booleans(self, svc, study_id):
        result = svc.update_features(study_id, {'qi': True, 'vf': False, 'bwt': True})
        assert result['features']['qi'] is True
        assert result['features']['vf'] is False
        assert result['features']['bwt'] is True

    def test_update_features_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.update_features(str(ObjectId()), {'qi': True})

    def test_update_features_invalid_dict_is_ignored(self, svc, study_id):
        # Passing None for features should not crash; features dict stays unchanged.
        result = svc.update_features(study_id, None)
        assert 'features' in result


# ---------------------------------------------------------------------------
# update_input / get_input
# ---------------------------------------------------------------------------

class TestInput:
    def test_update_input_creates_input_doc(self, svc, study_id):
        svc.update_input(study_id, VALID_CRITERIA)
        criteria = svc.get_input(study_id)
        assert len(criteria) == 1
        assert criteria[0]['criterion_name'] == 'Cost'

    def test_update_input_overwrites_existing(self, svc, study_id):
        svc.update_input(study_id, VALID_CRITERIA)
        new_criteria = [
            {
                'criterion_name': 'Time',
                'unit': 'days',
                'alternatives': [{'name': 'A', 'value': '5'}],
            }
        ]
        svc.update_input(study_id, new_criteria)
        criteria = svc.get_input(study_id)
        assert criteria[0]['criterion_name'] == 'Time'

    def test_update_input_invalid_criteria_raises(self, svc, study_id):
        with pytest.raises(ValidationError):
            svc.update_input(study_id, [])

    def test_get_input_no_input_returns_empty(self, svc, study_id):
        assert svc.get_input(study_id) == []

    def test_get_input_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.get_input(str(ObjectId()))


# ---------------------------------------------------------------------------
# create_elicitation_session
# ---------------------------------------------------------------------------

class TestCreateElicitationSession:
    def test_creates_elicitation_session(self, svc, study_with_input):
        session_id = svc.create_elicitation_session(study_with_input, 'EXPERT-01')
        assert isinstance(session_id, str)

    def test_missing_name_raises(self, svc, study_with_input):
        with pytest.raises(ValidationError, match='code is required'):
            svc.create_elicitation_session(study_with_input, '')

    def test_duplicate_name_raises(self, svc, study_with_input):
        svc.create_elicitation_session(study_with_input, 'EXPERT-01')
        with pytest.raises(ConflictError, match='already exists'):
            svc.create_elicitation_session(study_with_input, 'EXPERT-01')

    def test_no_input_defined_raises(self, svc, study_id):
        with pytest.raises(ValidationError, match='not defined'):
            svc.create_elicitation_session(study_id, 'EXPERT-01')

    def test_study_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.create_elicitation_session(str(ObjectId()), 'EXPERT-01')


# ---------------------------------------------------------------------------
# list_elicitation_sessions
# ---------------------------------------------------------------------------

class TestListElicitationSessions:
    def test_lists_sessions(self, svc, study_with_input):
        svc.create_elicitation_session(study_with_input, 'E1')
        svc.create_elicitation_session(study_with_input, 'E2')
        result = svc.list_elicitation_sessions(study_with_input)
        assert len(result['sessions']) == 2
        assert result['study_code'] == 'STUDY-001'

    def test_lists_empty_if_no_sessions(self, svc, study_with_input):
        result = svc.list_elicitation_sessions(study_with_input)
        assert result['sessions'] == []

    def test_study_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.list_elicitation_sessions(str(ObjectId()))


# ---------------------------------------------------------------------------
# reset_elicitation_sessions
# ---------------------------------------------------------------------------

class TestResetElicitationSessions:
    def test_deletes_all_sessions(self, svc, study_with_input):
        svc.create_elicitation_session(study_with_input, 'E1')
        svc.create_elicitation_session(study_with_input, 'E2')
        deleted = svc.reset_elicitation_sessions(study_with_input)
        assert deleted == 2
        result = svc.list_elicitation_sessions(study_with_input)
        assert result['sessions'] == []


# ---------------------------------------------------------------------------
# delete study session
# ---------------------------------------------------------------------------

class TestDelete:
    def test_delete_ok_with_no_sessions(self, svc, study_id):
        svc.delete(study_id)
        with pytest.raises(NotFoundError):
            svc.get_by_id(study_id)

    def test_delete_with_sessions_raises(self, svc, study_with_input):
        svc.create_elicitation_session(study_with_input, 'E1')
        with pytest.raises(ValidationError, match='elicitation sessions'):
            svc.delete(study_with_input)

    def test_delete_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.delete(str(ObjectId()))

    def test_delete_also_removes_input_doc(self, svc, mock_db, study_with_input):
        svc.delete(study_with_input)
        # Input collection should be empty after deletion
        assert mock_db.inputs.count_documents({}) == 0
