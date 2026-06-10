"""Integration tests for email verification API endpoints."""
from unittest.mock import patch


class TestRequestEmailVerificationCode:
    def test_timeout_failure_returns_504(self, client, monkeypatch):
        monkeypatch.setenv('DISABLE_EMAIL', 'false')
        monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')

        with patch(
            'app.routes.api.EmailService.send_email_verification_code',
            return_value={
                'status': 'failed',
                'error_code': 'timeout',
                'error': 'SMTP send timed out after 0.01s',
            },
        ):
            resp = client.post(
                '/api/email-verification/request',
                json={'email': 'owner@example.com'},
            )

        assert resp.status_code == 504
        assert 'timed out' in resp.json['error']

    def test_non_timeout_failure_returns_502(self, client, monkeypatch):
        monkeypatch.setenv('DISABLE_EMAIL', 'false')
        monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')

        with patch(
            'app.routes.api.EmailService.send_email_verification_code',
            return_value={
                'status': 'failed',
                'error': 'SMTP auth failed',
            },
        ):
            resp = client.post(
                '/api/email-verification/request',
                json={'email': 'owner@example.com'},
            )

        assert resp.status_code == 502
        assert resp.json['error'] == 'SMTP auth failed'
