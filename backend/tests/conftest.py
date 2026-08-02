"""
Shared pytest fixtures for the elicitation-tools backend test suite.

All tests use mongomock instead of a real MongoDB instance so no external
services are required.
"""
import sys
import os

import mongomock
import pytest

# Make the backend 'app' package importable from every test module.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


# ---------------------------------------------------------------------------
# Helpers shared across tests
# ---------------------------------------------------------------------------

VALID_CRITERION = {
    'criterion_name': 'Cost',
    'unit': 'EUR',
    'alternatives': [
        {'name': 'A', 'value': '100'},
        {'name': 'B', 'value': '200'},
    ],
}

VALID_CRITERIA = [VALID_CRITERION]


def make_criterion(name='Cost', unit='EUR', alts=None, is_qualitative=False):
    alts = alts or [{'name': 'A', 'value': '100'}, {'name': 'B', 'value': '200'}]
    c = {'criterion_name': name, 'unit': unit, 'alternatives': alts}
    if is_qualitative:
        c['is_qualitative'] = True
    return c


# ---------------------------------------------------------------------------
# mongomock database fixture (function-scoped → isolated per test)
# ---------------------------------------------------------------------------

@pytest.fixture()
def mock_db():
    """Return a fresh mongomock database for each test."""
    client = mongomock.MongoClient()
    return client['elicitation']


# ---------------------------------------------------------------------------
# Flask app + test client fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def app(mock_db):
    """Create a Flask test application wired to the mongomock database."""
    from app import create_app

    flask_app = create_app()
    flask_app.config['TESTING'] = True
    flask_app.config['ADMIN_PASSWORD'] = 'testpass'

    # Override the db on the app object directly so services pick it up.
    flask_app.db = mock_db

    return flask_app


@pytest.fixture()
def client(app):
    """Return a Flask test client."""
    return app.test_client()
