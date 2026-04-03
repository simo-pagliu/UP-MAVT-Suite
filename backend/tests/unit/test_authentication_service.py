"""Unit tests for AuthenticationService."""
import pytest
from werkzeug.security import generate_password_hash

from app.services.authentication_service import AuthenticationService


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
