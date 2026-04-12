"""Integration tests for the admin API endpoints."""
import os
import pytest
from unittest.mock import patch
from werkzeug.security import generate_password_hash

from app.services import AuthenticationService


def _set_access_cookie(client, token=None):
    """Inject a valid admin access token cookie directly into the test client."""
    if token is None:
        token = AuthenticationService.generate_access_token('admin')
    client.set_cookie('adm_access_token', token, path='/api')


def _set_refresh_cookie(client, token=None):
    """Inject a valid admin refresh token cookie directly into the test client."""
    if token is None:
        token = AuthenticationService.generate_refresh_token('admin')
    client.set_cookie('adm_refresh_token', token, path='/api')


class TestAdminLogin:
    def test_login_correct_password(self, client, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'testpass')
        resp = client.post('/api/admin/login', json={'password': 'testpass'})
        assert resp.status_code == 200
        assert resp.json['success'] is True
        # Tokens must be set as HTTPOnly cookies, NOT returned in the response body.
        assert 'access_token' not in resp.json
        assert 'refresh_token' not in resp.json
        set_cookies = resp.headers.getlist('Set-Cookie')
        assert any('adm_access_token' in c for c in set_cookies)
        assert any('adm_refresh_token' in c for c in set_cookies)
        assert any('HttpOnly' in c for c in set_cookies)

    def test_login_wrong_password(self, client, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'testpass')
        resp = client.post('/api/admin/login', json={'password': 'wrongpass'})
        assert resp.status_code == 401
        assert resp.json['success'] is False

    def test_login_missing_password_field(self, client):
        resp = client.post('/api/admin/login', json={})
        assert resp.status_code == 400
        assert resp.json['success'] is False

    def test_login_no_json_body(self, client):
        resp = client.post('/api/admin/login', data='not json', content_type='text/plain')
        assert resp.status_code == 400

    def test_default_password_is_admin123(self, client, monkeypatch):
        # Unset env var so the default is used
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)
        resp = client.post('/api/admin/login', json={'password': 'admin123'})
        assert resp.status_code == 200


class TestAdminLogout:
    def test_logout_clears_cookies(self, client):
        _set_access_cookie(client)
        _set_refresh_cookie(client)
        resp = client.post('/api/admin/logout')
        assert resp.status_code == 200
        assert resp.json['success'] is True
        # Both cookies should be expired (max_age=0 / expires in the past)
        set_cookies = resp.headers.getlist('Set-Cookie')
        assert any('adm_access_token' in c for c in set_cookies)
        assert any('adm_refresh_token' in c for c in set_cookies)


class TestAdminVerify:
    def test_verify_with_valid_cookie(self, client):
        _set_access_cookie(client)
        resp = client.get('/api/admin/verify')
        assert resp.status_code == 200
        assert resp.json['success'] is True

    def test_verify_without_cookie_returns_401(self, client):
        resp = client.get('/api/admin/verify')
        assert resp.status_code == 401

    def test_verify_with_invalid_cookie_returns_401(self, client):
        client.set_cookie('adm_access_token', 'badtoken', path='/api')
        resp = client.get('/api/admin/verify')
        assert resp.status_code == 401


class TestAdminRefreshToken:
    def test_refresh_with_valid_refresh_cookie(self, client):
        _set_refresh_cookie(client)
        resp = client.post('/api/admin/refresh')
        assert resp.status_code == 200
        assert resp.json['success'] is True
        # New access token must be delivered as a cookie, not in the response body.
        assert 'access_token' not in resp.json
        set_cookies = resp.headers.getlist('Set-Cookie')
        assert any('adm_access_token' in c for c in set_cookies)

    def test_refresh_with_access_token_cookie_is_rejected(self, client):
        # Placing an access token in the refresh cookie slot must be rejected.
        access_token = AuthenticationService.generate_access_token('admin')
        client.set_cookie('adm_refresh_token', access_token, path='/api')
        resp = client.post('/api/admin/refresh')
        assert resp.status_code == 401

    def test_refresh_without_cookie_is_rejected(self, client):
        resp = client.post('/api/admin/refresh')
        assert resp.status_code == 401

    def test_refresh_with_invalid_cookie_is_rejected(self, client):
        client.set_cookie('adm_refresh_token', 'invalidtoken', path='/api')
        resp = client.post('/api/admin/refresh')
        assert resp.status_code == 401


class TestDeleteInactiveStudySessions:
    """Integration tests for the /admin/delete-inactive endpoint."""

    def _create_old_study(self, client, mock_db, code, days=400):
        """Create a study session then backdate its last_modified_at."""
        from datetime import datetime, timezone, timedelta
        from bson.objectid import ObjectId
        resp = client.post('/api/study-session', json={'code': code})
        sid = resp.json['study_session_id']
        old_date = datetime.now(timezone.utc) - timedelta(days=days)
        mock_db.study_sessions.update_one(
            {'_id': ObjectId(sid)},
            {'$set': {'last_modified_at': old_date}},
        )
        return sid

    def test_requires_cookie(self, client):
        resp = client.post('/api/admin/delete-inactive', json={})
        assert resp.status_code == 401
        assert resp.json['success'] is False

    def test_wrong_cookie_returns_401(self, client):
        client.set_cookie('adm_access_token', 'invalidtoken', path='/api')
        resp = client.post('/api/admin/delete-inactive', json={})
        assert resp.status_code == 401

    def test_correct_cookie_returns_200(self, client):
        _set_access_cookie(client)
        resp = client.post('/api/admin/delete-inactive', json={})
        assert resp.status_code == 200
        assert resp.json['success'] is True

    def test_response_shape(self, client):
        _set_access_cookie(client)
        resp = client.post('/api/admin/delete-inactive', json={})
        assert resp.status_code == 200
        data = resp.json
        assert 'inactive_count' in data
        assert 'deleted_count' in data
        assert 'deleted' in data
        assert 'email_results' in data

    def test_inactive_session_is_deleted(self, client, mock_db):
        from bson.objectid import ObjectId
        _set_access_cookie(client)
        sid = self._create_old_study(client, mock_db, 'OLD-TO-DELETE')
        resp = client.post(
            '/api/admin/delete-inactive',
            json={'send_backup_email': False},
        )
        assert resp.status_code == 200
        assert resp.json['deleted_count'] >= 1
        deleted_codes = [d['code'] for d in resp.json['deleted']]
        assert 'OLD-TO-DELETE' in deleted_codes
        assert mock_db.study_sessions.find_one({'_id': ObjectId(sid)}) is None

    def test_recent_session_is_not_deleted(self, client, mock_db):
        from bson.objectid import ObjectId
        _set_access_cookie(client)
        resp_recent = client.post('/api/study-session', json={'code': 'KEEP-RECENT'})
        sid_recent = resp_recent.json['study_session_id']
        # Also create an old session so something gets deleted (shows the endpoint ran)
        self._create_old_study(client, mock_db, 'DELETE-OLD-BUT-NOT-RECENT')
        resp = client.post(
            '/api/admin/delete-inactive',
            json={'send_backup_email': False},
        )
        assert resp.status_code == 200
        assert mock_db.study_sessions.find_one({'_id': ObjectId(sid_recent)}) is not None

    def test_no_inactive_sessions_returns_zero_deleted(self, client):
        _set_access_cookie(client)
        resp = client.post('/api/admin/delete-inactive', json={})
        assert resp.status_code == 200
        assert resp.json['deleted_count'] == 0
        assert resp.json['deleted'] == []

    def test_login_with_hashed_password(self, client, monkeypatch):
        hashed = generate_password_hash('securepass')
        monkeypatch.setenv('ADMIN_PASSWORD', hashed)
        resp = client.post('/api/admin/login', json={'password': 'securepass'})
        assert resp.status_code == 200
        assert resp.json['success'] is True

    def test_login_wrong_password_against_hash(self, client, monkeypatch):
        hashed = generate_password_hash('securepass')
        monkeypatch.setenv('ADMIN_PASSWORD', hashed)
        resp = client.post('/api/admin/login', json={'password': 'wrongpass'})
        assert resp.status_code == 401
        assert resp.json['success'] is False


class TestAdminEmailDiagnostics:
    def test_requires_cookie(self, client):
        resp = client.post('/api/admin/email-diagnostics', json={})
        assert resp.status_code == 401
        assert resp.json['success'] is False

    def test_wrong_cookie_returns_401(self, client):
        client.set_cookie('adm_access_token', 'badtoken', path='/api')
        resp = client.post('/api/admin/email-diagnostics', json={})
        assert resp.status_code == 401
        assert resp.json['success'] is False

    def test_ok_diagnostics_returns_200(self, client):
        _set_access_cookie(client)
        with patch('app.routes.api.EmailService') as email_cls:
            email_cls.return_value.diagnose_auth.return_value = {
                'status': 'ok',
                'auth_mode': 'oauth2',
                'smtp': {'configured': True, 'host': 'smtp.office365.com', 'port': 587, 'use_tls': True},
                'oauth2': {'enabled': True, 'username': 'mcda@psi.ch', 'token_ok': True, 'smtp_auth_ok': True},
            }
            resp = client.post('/api/admin/email-diagnostics', json={})

        assert resp.status_code == 200
        assert resp.json['success'] is True
        assert resp.json['status'] == 'ok'

    def test_failed_diagnostics_returns_502(self, client):
        _set_access_cookie(client)
        with patch('app.routes.api.EmailService') as email_cls:
            email_cls.return_value.diagnose_auth.return_value = {
                'status': 'failed',
                'error_stage': 'smtp_auth',
                'error': '(535, Authentication unsuccessful)',
                'smtp': {'configured': True, 'host': 'smtp.office365.com', 'port': 587, 'use_tls': True},
                'oauth2': {'enabled': True, 'username': 'mcda@psi.ch', 'token_ok': True, 'smtp_auth_ok': False},
            }
            resp = client.post('/api/admin/email-diagnostics', json={})

        assert resp.status_code == 502
        assert resp.json['success'] is False
        assert resp.json['error_stage'] == 'smtp_auth'

