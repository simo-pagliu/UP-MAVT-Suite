"""Unit tests for AuthenticationService."""
import pytest
import mongomock
from werkzeug.security import generate_password_hash

from app.services.authentication_service import AuthenticationService


@pytest.fixture()
def mock_db():
    client = mongomock.MongoClient()
    return client['elicitation']


class TestHashPassword:
    def test_returns_non_empty_string(self):
        result = AuthenticationService.hash_password('mypassword')
        assert isinstance(result, str)
        assert len(result) > 0

    def test_hash_differs_from_plain(self):
        plain = 'mypassword'
        assert AuthenticationService.hash_password(plain) != plain

    def test_two_hashes_of_same_password_differ(self):
        # Salted hashes should not be identical.
        h1 = AuthenticationService.hash_password('mypassword')
        h2 = AuthenticationService.hash_password('mypassword')
        assert h1 != h2

    def test_empty_password_raises(self):
        with pytest.raises(ValueError):
            AuthenticationService.hash_password('')


class TestIsHashed:
    def test_pbkdf2_detected(self):
        h = generate_password_hash('test')
        assert AuthenticationService._is_hashed(h)

    def test_plain_text_not_detected(self):
        assert not AuthenticationService._is_hashed('admin123')
        assert not AuthenticationService._is_hashed('testpass')

    def test_bcrypt_prefix_detected(self):
        assert AuthenticationService._is_hashed('$2b$12$somehashvalue')
        assert AuthenticationService._is_hashed('$2a$12$somehashvalue')

    def test_scrypt_prefix_detected(self):
        assert AuthenticationService._is_hashed('scrypt:32768:8:1$abc$def')


class TestVerifyPassword:
    def test_correct_plain_password_returns_true(self):
        assert AuthenticationService.verify_password('admin123', 'admin123')

    def test_wrong_plain_password_returns_false(self):
        assert not AuthenticationService.verify_password('wrongpass', 'admin123')

    def test_correct_hashed_password_returns_true(self):
        hashed = generate_password_hash('securepass')
        assert AuthenticationService.verify_password('securepass', hashed)

    def test_wrong_password_against_hash_returns_false(self):
        hashed = generate_password_hash('securepass')
        assert not AuthenticationService.verify_password('wrongpass', hashed)

    def test_empty_plain_password_returns_false(self):
        hashed = generate_password_hash('securepass')
        assert not AuthenticationService.verify_password('', hashed)

    def test_empty_stored_password_returns_false(self):
        assert not AuthenticationService.verify_password('somepass', '')

    def test_none_plain_password_returns_false(self):
        hashed = generate_password_hash('securepass')
        assert not AuthenticationService.verify_password(None, hashed)


class TestAuthenticate:
    """Tests for authenticate() without a database (env-only fallback)."""

    def test_correct_password_returns_true(self, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'testpass')
        assert AuthenticationService().authenticate('testpass')

    def test_wrong_password_returns_false(self, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'testpass')
        assert not AuthenticationService().authenticate('wrongpass')

    def test_hashed_password_correct_returns_true(self, monkeypatch):
        hashed = generate_password_hash('securepass')
        monkeypatch.setenv('ADMIN_PASSWORD', hashed)
        assert AuthenticationService().authenticate('securepass')

    def test_hashed_password_wrong_returns_false(self, monkeypatch):
        hashed = generate_password_hash('securepass')
        monkeypatch.setenv('ADMIN_PASSWORD', hashed)
        assert not AuthenticationService().authenticate('wrongpass')

    def test_default_password_when_env_not_set(self, monkeypatch):
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)
        # Default plain-text fallback is 'admin123'.
        assert AuthenticationService().authenticate('admin123')

    def test_default_rejects_wrong_password_when_env_not_set(self, monkeypatch):
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)
        assert not AuthenticationService().authenticate('wrongpass')


class TestAuthenticateWithDb:
    """Tests for authenticate() with a MongoDB database handle."""

    def test_bootstraps_from_plain_env_password(self, mock_db, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'mypassword')
        svc = AuthenticationService(mock_db)
        assert svc.authenticate('mypassword')

    def test_bootstrap_stores_hash_in_db(self, mock_db, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'mypassword')
        AuthenticationService(mock_db).authenticate('mypassword')
        stored = mock_db.users.find_one({'role': 'admin'})
        assert stored is not None
        assert AuthenticationService._is_hashed(stored['password_hash'])

    def test_bootstraps_from_hashed_env_password(self, mock_db, monkeypatch):
        hashed = generate_password_hash('securepass')
        monkeypatch.setenv('ADMIN_PASSWORD', hashed)
        assert AuthenticationService(mock_db).authenticate('securepass')

    def test_uses_db_hash_over_env_when_db_has_hash(self, mock_db, monkeypatch):
        # Pre-seed a hash in the DB for 'dbpassword'.
        db_hash = generate_password_hash('dbpassword')
        mock_db.users.insert_one({'role': 'admin', 'password_hash': db_hash})
        # Even if env has a different password, the DB value wins.
        monkeypatch.setenv('ADMIN_PASSWORD', 'envpassword')
        svc = AuthenticationService(mock_db)
        assert svc.authenticate('dbpassword')
        assert not svc.authenticate('envpassword')

    def test_wrong_password_returns_false(self, mock_db, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'mypassword')
        assert not AuthenticationService(mock_db).authenticate('wrongpass')

    def test_default_password_when_env_not_set(self, mock_db, monkeypatch):
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)
        assert AuthenticationService(mock_db).authenticate('admin123')

    def test_second_call_uses_db_not_env(self, mock_db, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'firstpass')
        AuthenticationService(mock_db).authenticate('firstpass')
        # Change env — DB value should now be used, env is ignored.
        monkeypatch.setenv('ADMIN_PASSWORD', 'changedpass')
        assert AuthenticationService(mock_db).authenticate('firstpass')
        assert not AuthenticationService(mock_db).authenticate('changedpass')


class TestGenerateAccessToken:
    def test_returns_non_empty_string(self):
        token = AuthenticationService.generate_access_token('admin')
        assert isinstance(token, str)
        assert len(token) > 0

    def test_payload_contains_role_and_type(self):
        import jwt as pyjwt
        from app.services.authentication_service import _jwt_secret
        token = AuthenticationService.generate_access_token('admin')
        payload = pyjwt.decode(token, _jwt_secret(), algorithms=['HS256'])
        assert payload['role'] == 'admin'
        assert payload['type'] == 'access'

    def test_payload_has_expiry(self):
        import jwt as pyjwt
        from app.services.authentication_service import _jwt_secret
        token = AuthenticationService.generate_access_token('admin')
        payload = pyjwt.decode(token, _jwt_secret(), algorithms=['HS256'])
        assert 'exp' in payload


class TestGenerateRefreshToken:
    def test_returns_non_empty_string(self):
        token = AuthenticationService.generate_refresh_token('admin')
        assert isinstance(token, str)
        assert len(token) > 0

    def test_payload_contains_role_and_refresh_type(self):
        import jwt as pyjwt
        from app.services.authentication_service import _jwt_secret
        token = AuthenticationService.generate_refresh_token('admin')
        payload = pyjwt.decode(token, _jwt_secret(), algorithms=['HS256'])
        assert payload['role'] == 'admin'
        assert payload['type'] == 'refresh'


class TestVerifyToken:
    def test_valid_access_token_returns_payload(self):
        token = AuthenticationService.generate_access_token('admin')
        payload = AuthenticationService.verify_token(token)
        assert payload is not None
        assert payload['role'] == 'admin'

    def test_invalid_token_returns_none(self):
        assert AuthenticationService.verify_token('notavalidtoken') is None

    def test_none_token_returns_none(self):
        assert AuthenticationService.verify_token(None) is None

    def test_empty_string_returns_none(self):
        assert AuthenticationService.verify_token('') is None


class TestExtractBearerToken:
    def test_extracts_token_from_valid_header(self):
        class FakeHeaders:
            def get(self, key, default=''):
                if key == 'Authorization':
                    return 'Bearer mytoken'
                return default

        result = AuthenticationService.extract_bearer_token(FakeHeaders())
        assert result == 'mytoken'

    def test_returns_none_for_missing_header(self):
        class FakeHeaders:
            def get(self, key, default=''):
                return default

        result = AuthenticationService.extract_bearer_token(FakeHeaders())
        assert result is None

    def test_returns_none_for_non_bearer_scheme(self):
        class FakeHeaders:
            def get(self, key, default=''):
                if key == 'Authorization':
                    return 'Basic dXNlcjpwYXNz'
                return default

        result = AuthenticationService.extract_bearer_token(FakeHeaders())
        assert result is None

