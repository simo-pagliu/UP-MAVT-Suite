"""Integration tests for the admin API endpoints."""
import os
import pytest


class TestAdminLogin:
    def test_login_correct_password(self, client, monkeypatch):
        monkeypatch.setenv('ADMIN_PASSWORD', 'testpass')
        resp = client.post('/api/admin/login', json={'password': 'testpass'})
        assert resp.status_code == 200
        assert resp.json['success'] is True

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
        assert resp.status_code in (400, 415)

    def test_default_password_is_admin123(self, client, monkeypatch):
        # Unset env var so the default is used
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)
        resp = client.post('/api/admin/login', json={'password': 'admin123'})
        assert resp.status_code == 200
