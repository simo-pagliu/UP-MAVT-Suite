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

    def test_create_sets_default_vf_method(self, svc):
        sid = svc.create('VF-METHOD-STUDY')
        study = svc.get_by_id(sid)
        assert study['vf_method'] == 'mid-splitting'

    def test_create_sets_empty_metadata_defaults(self, svc):
        sid = svc.create('META-DEFAULTS')
        study = svc.get_by_id(sid)
        assert study['title'] == ''
        assert study['description'] == ''

    def test_create_sets_all_features_enabled(self, svc):
        sid = svc.create('FEATURES-DEFAULT')
        study = svc.get_by_id(sid)
        assert study['features'] == {'qi': True, 'vf': True, 'bwt': True}

    def test_create_accepts_metadata(self, svc):
        sid = svc.create('META-SET', title='My Title', description='My Description')
        study = svc.get_by_id(sid)
        assert study['title'] == 'My Title'
        assert study['description'] == 'My Description'


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
    def test_update_features_always_all_true(self, svc, study_id):
        result = svc.update_features(study_id)
        assert result['features']['qi'] is True
        assert result['features']['vf'] is True
        assert result['features']['bwt'] is True

    def test_update_features_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.update_features(str(ObjectId()))

    def test_update_features_updates_vf_method(self, svc, study_id):
        result = svc.update_features(study_id, 'free-edit')
        assert result['vf_method'] == 'free-edit'


class TestUpdateMetadata:
    def test_update_metadata_ok(self, svc, study_id):
        result = svc.update_metadata(study_id, title='Case A', description='A short description')
        assert result['title'] == 'Case A'
        assert result['description'] == 'A short description'

    def test_update_metadata_not_found_raises(self, svc):
        with pytest.raises(NotFoundError):
            svc.update_metadata(str(ObjectId()), title='x')

    def test_update_metadata_rejects_invalid_types(self, svc, study_id):
        with pytest.raises(ValidationError, match='Title must be a string'):
            svc.update_metadata(study_id, title=123)
        with pytest.raises(ValidationError, match='Description must be a string'):
            svc.update_metadata(study_id, description=456)


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


# ---------------------------------------------------------------------------
# create – creator_email and last_modified_at
# ---------------------------------------------------------------------------

class TestCreateCreatorEmail:
    def test_create_stores_creator_email(self, svc):
        sid = svc.create('EMAIL-STUDY', creator_email='owner@example.com')
        # Access raw document to verify stored value
        doc = svc._studies.find_by_id(sid)
        assert doc['creator_email'] == 'owner@example.com'

    def test_create_strips_creator_email_whitespace(self, svc):
        sid = svc.create('TRIM-STUDY', creator_email='  owner@example.com  ')
        doc = svc._studies.find_by_id(sid)
        assert doc['creator_email'] == 'owner@example.com'

    def test_create_defaults_creator_email_to_empty_string(self, svc):
        sid = svc.create('NO-EMAIL-STUDY')
        doc = svc._studies.find_by_id(sid)
        assert doc['creator_email'] == ''

    def test_create_sets_last_modified_at(self, svc):
        sid = svc.create('MODIFIED-STUDY')
        doc = svc._studies.find_by_id(sid)
        assert doc.get('last_modified_at') is not None


# ---------------------------------------------------------------------------
# import_study_case – creator_email overwrite/preserve
# ---------------------------------------------------------------------------

class TestImportBackupCreatorEmail:
    def test_import_backup_overwrites_creator_email_from_contact_email(self, svc):
        source_id = svc.create('SRC-BACKUP-EMAIL', creator_email='backup-owner@example.com')
        svc.update_input(source_id, VALID_CRITERIA)
        buf, _, _ = svc.export_backup_zip(source_id)

        result = svc.import_study_case(
            buf.getvalue(),
            on_conflict='regenerate',
            contact_email='current-login@example.com',
        )

        imported = svc._studies.find_by_id(result['study_session_id'])
        assert imported['creator_email'] == 'current-login@example.com'

    def test_import_backup_preserves_creator_email_when_flag_enabled(self, svc):
        source_id = svc.create('SRC-BACKUP-PRESERVE', creator_email='backup-owner@example.com')
        svc.update_input(source_id, VALID_CRITERIA)
        buf, _, _ = svc.export_backup_zip(source_id)

        result = svc.import_study_case(
            buf.getvalue(),
            on_conflict='regenerate',
            contact_email='admin-current@example.com',
            preserve_backup_email=True,
        )

        imported = svc._studies.find_by_id(result['study_session_id'])
        assert imported['creator_email'] == 'backup-owner@example.com'


class TestImportBackupEmptyCriteria:
    def test_import_backup_allows_empty_criteria_with_metadata_only(self, svc):
        source_id = svc.create('SRC-META-ONLY', title='Metadata Only Study')
        # No criteria and no sessions: backup should still be importable.
        buf, _, _ = svc.export_backup_zip(source_id)

        result = svc.import_study_case(
            buf.getvalue(),
            on_conflict='regenerate',
            contact_email='uploader@example.com',
        )

        imported = svc.get_by_id(result['study_session_id'])
        assert imported['title'] == 'Metadata Only Study'
        assert imported['creator_email'] == 'uploader@example.com'
        assert svc.get_input(result['study_session_id']) == []


# ---------------------------------------------------------------------------
# complete_elicitation_session
# ---------------------------------------------------------------------------

class TestCompleteElicitationSession:
    def test_complete_locks_session(self, svc, study_with_input):
        session_id = svc.create_elicitation_session(study_with_input, 'S1')
        result = svc.complete_elicitation_session(session_id)
        assert result['session']['session_locked'] is True

    def test_complete_returns_study_context(self, svc, study_with_input):
        session_id = svc.create_elicitation_session(study_with_input, 'S2')
        result = svc.complete_elicitation_session(session_id)
        assert result['study'] is not None
        assert result['study']['code'] == 'STUDY-001'

    def test_complete_not_found_raises(self, svc):
        from app.exceptions import NotFoundError
        with pytest.raises(NotFoundError):
            svc.complete_elicitation_session(str(ObjectId()))

    def test_complete_standalone_session_returns_no_study(self, svc, mock_db):
        """A standalone session (not linked to a study) should return study=None."""
        session_svc = SessionService(mock_db)
        sid = session_svc.create('standalone', VALID_CRITERIA)
        result = svc.complete_elicitation_session(sid)
        assert result['study'] is None


# ---------------------------------------------------------------------------
# get_inactive_study_sessions
# ---------------------------------------------------------------------------

class TestGetInactiveStudySessions:
    def test_returns_empty_when_all_recent(self, svc):
        svc.create('RECENT-STUDY')
        inactive = svc.get_inactive_study_sessions(months=12)
        assert inactive == []

    def test_returns_old_sessions(self, svc, mock_db):
        from datetime import datetime, timezone, timedelta
        sid = svc.create('OLD-STUDY')
        old_date = datetime.now(timezone.utc) - timedelta(days=400)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'last_modified_at': old_date}},
        )
        inactive = svc.get_inactive_study_sessions(months=12)
        assert len(inactive) == 1
        assert inactive[0]['code'] == 'OLD-STUDY'
        assert inactive[0]['months_inactive'] > 12

    def test_months_inactive_key_present(self, svc, mock_db):
        from datetime import datetime, timezone, timedelta
        sid = svc.create('OLD-STUDY-2')
        old_date = datetime.now(timezone.utc) - timedelta(days=500)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'last_modified_at': old_date}},
        )
        inactive = svc.get_inactive_study_sessions(months=12)
        assert 'months_inactive' in inactive[0]

    def test_falls_back_to_created_at_when_no_last_modified(self, svc, mock_db):
        from datetime import datetime, timezone, timedelta
        sid = svc.create('OLD-FALLBACK')
        old_date = datetime.now(timezone.utc) - timedelta(days=400)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'created_at': old_date}, '$unset': {'last_modified_at': ''}},
        )
        inactive = svc.get_inactive_study_sessions(months=12)
        assert any(s['code'] == 'OLD-FALLBACK' for s in inactive)


# ---------------------------------------------------------------------------
# delete_inactive_study_sessions
# ---------------------------------------------------------------------------

class TestDeleteInactiveStudySessions:
    def _make_old_study(self, svc, mock_db, code, days=400, creator_email=''):
        from datetime import datetime, timezone, timedelta
        sid = svc.create(code, creator_email=creator_email)
        old_date = datetime.now(timezone.utc) - timedelta(days=days)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'last_modified_at': old_date}},
        )
        return sid

    def test_returns_empty_when_no_inactive(self, svc):
        svc.create('RECENT')
        deleted = svc.delete_inactive_study_sessions(months=12)
        assert deleted == []

    def test_deletes_inactive_session(self, svc, mock_db):
        sid = self._make_old_study(svc, mock_db, 'OLD-DEL')
        deleted = svc.delete_inactive_study_sessions(months=12)
        assert any(d['code'] == 'OLD-DEL' for d in deleted)
        assert mock_db.study_sessions.find_one({'_id': ObjectId(sid)}) is None

    def test_deleted_result_has_expected_keys(self, svc, mock_db):
        self._make_old_study(svc, mock_db, 'OLD-KEYS', creator_email='p@example.com')
        deleted = svc.delete_inactive_study_sessions(months=12)
        entry = deleted[0]
        assert 'code' in entry
        assert 'creator_email' in entry
        assert 'months_inactive' in entry
        assert entry['creator_email'] == 'p@example.com'

    def test_deletes_child_elicitation_sessions(self, svc, mock_db):
        from app.services.session_service import SessionService
        sid = self._make_old_study(svc, mock_db, 'OLD-WITH-SESSIONS')
        # Inject an elicitation session directly since create_elicitation_session
        # requires input criteria to be defined.
        from datetime import datetime, timezone
        mock_db.sessions.insert_one({
            'name': 'SH-1',
            'study_session_id': ObjectId(sid),
            'created_at': datetime.now(timezone.utc),
        })
        assert mock_db.sessions.count_documents({'study_session_id': ObjectId(sid)}) == 1
        svc.delete_inactive_study_sessions(months=12)
        assert mock_db.sessions.count_documents({'study_session_id': ObjectId(sid)}) == 0

    def test_recent_sessions_not_deleted(self, svc, mock_db):
        sid_recent = svc.create('KEEP-ME')
        sid_old = self._make_old_study(svc, mock_db, 'DELETE-ME')
        deleted = svc.delete_inactive_study_sessions(months=12)
        assert any(d['code'] == 'DELETE-ME' for d in deleted)
        assert mock_db.study_sessions.find_one({'_id': ObjectId(sid_recent)}) is not None
