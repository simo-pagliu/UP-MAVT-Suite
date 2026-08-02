"""Unit tests for EmailService."""
import pytest
from unittest.mock import MagicMock, patch


class TestEmailServiceConfiguration:
    def test_not_configured_when_smtp_host_absent(self, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        from app.services.email_service import EmailService
        svc = EmailService()
        assert not svc._configured

    def test_configured_when_smtp_host_set(self, monkeypatch):
        monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
        from app.services.email_service import EmailService
        svc = EmailService()
        assert svc._configured

    def test_defaults(self, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        monkeypatch.delenv('SMTP_PORT', raising=False)
        monkeypatch.delenv('EMAIL_FROM', raising=False)
        monkeypatch.delenv('APP_BASE_URL', raising=False)
        from app.services.email_service import EmailService
        svc = EmailService()
        assert svc._port == 587
        assert svc._from == 'noreply@elicitation-tools.local'
        assert svc._base_url == 'http://localhost:3000'


class TestEmailServiceSendSkipped:
    """When SMTP is not configured every send_* method returns 'skipped'."""

    def _svc(self, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        from app.services.email_service import EmailService
        return EmailService()

    def test_send_session_confirmation_skipped(self, monkeypatch):
        svc = self._svc(monkeypatch)
        result = svc.send_session_confirmation('user@example.com', 'sid-abc123')
        assert result['status'] == 'skipped'

    def test_send_inactivity_warning_skipped(self, monkeypatch):
        svc = self._svc(monkeypatch)
        result = svc.send_inactivity_warning(
            'user@example.com', 'CODE1', 'study-id-1', 13,
            b'zipbytes', 'backup.zip',
        )
        assert result['status'] == 'skipped'

    def test_send_session_completed_skipped(self, monkeypatch):
        svc = self._svc(monkeypatch)
        result = svc.send_session_completed(
            'user@example.com', 'stakeholder-A', 'STUDY-001', 'study-id-1',
        )
        assert result['status'] == 'skipped'


class TestEmailServiceSendSuccess:
    """When SMTP is configured and SMTP server responds OK, status is 'sent'."""

    def _svc(self, monkeypatch):
        monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
        monkeypatch.setenv('SMTP_PORT', '587')
        monkeypatch.setenv('SMTP_USE_TLS', 'true')
        monkeypatch.setenv('EMAIL_FROM', 'noreply@test.local')
        from app.services.email_service import EmailService
        return EmailService()

    def _mock_smtp(self):
        """Return a context-manager-compatible SMTP mock."""
        smtp_instance = MagicMock()
        smtp_instance.__enter__ = MagicMock(return_value=smtp_instance)
        smtp_instance.__exit__ = MagicMock(return_value=False)
        return smtp_instance

    def test_send_session_confirmation_sent(self, monkeypatch):
        svc = self._svc(monkeypatch)
        smtp_mock = self._mock_smtp()
        with patch('smtplib.SMTP', return_value=smtp_mock):
            result = svc.send_session_confirmation('user@example.com', 'sid-1')
        assert result['status'] == 'sent'
        smtp_mock.sendmail.assert_called_once()

    def test_send_inactivity_warning_sent(self, monkeypatch):
        svc = self._svc(monkeypatch)
        smtp_mock = self._mock_smtp()
        with patch('smtplib.SMTP', return_value=smtp_mock):
            result = svc.send_inactivity_warning(
                'user@example.com', 'OLD-STUDY', 'sid-2', 14, b'zip', 'backup.zip',
            )
        assert result['status'] == 'sent'

    def test_send_session_completed_sent(self, monkeypatch):
        svc = self._svc(monkeypatch)
        smtp_mock = self._mock_smtp()
        with patch('smtplib.SMTP', return_value=smtp_mock):
            result = svc.send_session_completed(
                'practitioner@example.com', 'Alice', 'STUDY-1', 'sid-3',
            )
        assert result['status'] == 'sent'

    def test_send_failure_returns_failed_status(self, monkeypatch):
        svc = self._svc(monkeypatch)
        with patch('smtplib.SMTP', side_effect=ConnectionRefusedError('refused')):
            result = svc.send_session_confirmation('user@example.com', 'sid-fail')
        assert result['status'] == 'failed'
        assert 'error' in result


class TestEmailServiceOAuth2:
    def _svc(self, monkeypatch):
        monkeypatch.setenv('SMTP_HOST', 'smtp.office365.com')
        monkeypatch.setenv('SMTP_PORT', '587')
        monkeypatch.setenv('SMTP_USE_TLS', 'true')
        monkeypatch.setenv('EMAIL_FROM', 'noreply@test.local')
        monkeypatch.setenv('EMAIL_AUTH_MODE', 'oauth2')
        monkeypatch.setenv('SMTP_USER', 'sender@example.com')
        monkeypatch.setenv('OAUTH2_TENANT_ID', 'tenant-id')
        monkeypatch.setenv('OAUTH2_CLIENT_ID', 'client-id')
        monkeypatch.setenv('OAUTH2_CLIENT_SECRET', 'client-secret')
        monkeypatch.setenv('OAUTH2_SCOPE', 'https://outlook.office365.com/.default')
        from app.services.email_service import EmailService
        return EmailService()

    def _mock_smtp(self):
        smtp_instance = MagicMock()
        smtp_instance.__enter__ = MagicMock(return_value=smtp_instance)
        smtp_instance.__exit__ = MagicMock(return_value=False)
        smtp_instance.docmd.return_value = (235, b'2.7.0 Authentication successful')
        return smtp_instance

    def test_send_uses_xoauth2_auth(self, monkeypatch):
        svc = self._svc(monkeypatch)
        smtp_mock = self._mock_smtp()

        with patch('smtplib.SMTP', return_value=smtp_mock), patch(
            'app.services.email_service.requests.post'
        ) as token_post:
            token_post.return_value = MagicMock(
                raise_for_status=MagicMock(),
                json=MagicMock(return_value={'access_token': 'token-123'}),
            )
            result = svc.send_session_confirmation('user@example.com', 'sid-oauth')

        assert result['status'] == 'sent'
        smtp_mock.login.assert_not_called()
        smtp_mock.docmd.assert_called_once()

    def test_missing_oauth2_settings_returns_failed(self, monkeypatch):
        monkeypatch.setenv('SMTP_HOST', 'smtp.office365.com')
        monkeypatch.setenv('EMAIL_AUTH_MODE', 'oauth2')
        monkeypatch.delenv('OAUTH2_TENANT_ID', raising=False)
        monkeypatch.delenv('OAUTH2_CLIENT_ID', raising=False)
        monkeypatch.delenv('OAUTH2_CLIENT_SECRET', raising=False)
        monkeypatch.setenv('SMTP_USER', 'sender@example.com')

        from app.services.email_service import EmailService
        svc = EmailService()

        with patch('smtplib.SMTP', return_value=self._mock_smtp()):
            result = svc.send_session_confirmation('user@example.com', 'sid-missing-oauth')

        assert result['status'] == 'failed'
        assert 'missing required settings' in result['error']


class TestEmailServiceDisableFlag:
    def test_disable_email_skips_even_when_oauth2_secret_missing(self, monkeypatch):
        monkeypatch.setenv('DISABLE_EMAIL', 'true')
        monkeypatch.setenv('SMTP_HOST', 'smtp.office365.com')
        monkeypatch.setenv('EMAIL_AUTH_MODE', 'oauth2')
        monkeypatch.setenv('SMTP_USER', 'sender@example.com')
        monkeypatch.setenv('OAUTH2_TENANT_ID', 'tenant-id')
        monkeypatch.setenv('OAUTH2_CLIENT_ID', 'client-id')
        monkeypatch.delenv('OAUTH2_CLIENT_SECRET', raising=False)

        from app.services.email_service import EmailService
        svc = EmailService()

        result = svc.send_session_confirmation('user@example.com', 'sid-disabled')

        assert svc.is_disabled is True
        assert result['status'] == 'skipped'


class TestEmailServiceMessageContent:
    """Validate that messages contain expected content."""

    def _svc(self, monkeypatch):
        monkeypatch.delenv('SMTP_HOST', raising=False)
        monkeypatch.setenv('APP_BASE_URL', 'https://app.example.com')
        from app.services.email_service import EmailService
        return EmailService()

    def test_confirmation_message_contains_code(self, monkeypatch):
        svc = self._svc(monkeypatch)
        msg = svc._build_message(
            'user@example.com',
            'Your Session: XXYYZZ',
            '<p>XXYYZZ</p>',
            'XXYYZZ',
        )
        assert 'XXYYZZ' in msg.as_string()

    def test_inactivity_message_contains_zip_attachment(self, monkeypatch):
        svc = self._svc(monkeypatch)
        msg = svc._build_message(
            'user@example.com',
            'Inactivity warning',
            '<p>body</p>',
            'body',
            attachment=b'PK\x03\x04',
            attachment_name='backup.zip',
        )
        content = msg.as_string()
        assert 'backup.zip' in content

    def test_base_url_trailing_slash_stripped(self, monkeypatch):
        monkeypatch.setenv('APP_BASE_URL', 'https://app.example.com/')
        from app.services.email_service import EmailService
        svc = EmailService()
        assert not svc._base_url.endswith('/')


class TestEmailServiceTimeouts:
    def test_invalid_timeout_uses_default(self, monkeypatch):
        monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
        monkeypatch.setenv('SMTP_TIMEOUT_SECONDS', 'invalid')
        from app.services.email_service import EmailService
        svc = EmailService()
        assert svc._smtp_timeout_seconds == 15.0

    def test_send_timeout_returns_failed_with_timeout_code(self, monkeypatch):
        import time

        monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
        monkeypatch.setenv('SMTP_TIMEOUT_SECONDS', '0.01')
        from app.services.email_service import EmailService
        svc = EmailService()

        def _slow_send(_msg, _to):
            time.sleep(0.1)
            return {'status': 'sent'}

        monkeypatch.setattr(svc, '_send_blocking', _slow_send)
        result = svc.send_session_confirmation('user@example.com', 'sid-timeout')

        assert result['status'] == 'failed'
        assert result['error_code'] == 'timeout'
        assert 'timed out' in result['error']
