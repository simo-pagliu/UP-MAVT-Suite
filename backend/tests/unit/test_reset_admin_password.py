"""Unit tests for the reset_admin_password CLI tool."""
import sys
import os
import importlib

import mongomock
import pytest
from werkzeug.security import check_password_hash

# Make the backend root importable so we can import reset_admin_password.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))


@pytest.fixture()
def mock_db():
    client = mongomock.MongoClient()
    return client['elicitation']


class TestResetPassword:
    """Tests for the reset_password() helper in reset_admin_password.py."""

    def _import_reset(self):
        """Import (or reload) the CLI module to get a fresh reference."""
        import reset_admin_password
        importlib.reload(reset_admin_password)
        return reset_admin_password

    def test_returns_non_empty_string(self, mock_db, monkeypatch):
        mod = self._import_reset()
        # Patch MongoClient to use mongomock and return our fixture DB.
        monkeypatch.setattr(
            mod, 'MongoClient',
            lambda uri: _MockClient(mock_db),
        )
        result = mod.reset_password('mongodb://localhost/elicitation')
        assert isinstance(result, str)
        assert len(result) > 0

    def test_stores_hash_in_db(self, mock_db, monkeypatch):
        mod = self._import_reset()
        monkeypatch.setattr(
            mod, 'MongoClient',
            lambda uri: _MockClient(mock_db),
        )
        new_password = mod.reset_password('mongodb://localhost/elicitation')
        doc = mock_db.admin.find_one({'role': 'admin'})
        assert doc is not None
        assert check_password_hash(doc['password_hash'], new_password)

    def test_overwrites_existing_hash(self, mock_db, monkeypatch):
        from werkzeug.security import generate_password_hash
        mock_db.admin.insert_one({'role': 'admin', 'password_hash': generate_password_hash('oldpass')})

        mod = self._import_reset()
        monkeypatch.setattr(
            mod, 'MongoClient',
            lambda uri: _MockClient(mock_db),
        )
        new_password = mod.reset_password('mongodb://localhost/elicitation')
        doc = mock_db.admin.find_one({'role': 'admin'})
        assert check_password_hash(doc['password_hash'], new_password)
        assert not check_password_hash(doc['password_hash'], 'oldpass')

    def test_different_password_each_call(self, mock_db, monkeypatch):
        mod = self._import_reset()
        calls = iter([mongomock.MongoClient(), mongomock.MongoClient()])
        # Use separate DB instances so there's no cross-contamination.
        dbs = [mongomock.MongoClient()['elicitation'], mongomock.MongoClient()['elicitation']]
        results = []
        for db in dbs:
            monkeypatch.setattr(mod, 'MongoClient', lambda uri, _db=db: _MockClient(_db))
            results.append(mod.reset_password('mongodb://localhost/elicitation'))
        assert results[0] != results[1]


class _MockClient:
    """Minimal stand-in for a PyMongo client that returns a fixed DB."""

    def __init__(self, db):
        self._db = db

    def get_default_database(self):
        return self._db

    def close(self):
        pass
