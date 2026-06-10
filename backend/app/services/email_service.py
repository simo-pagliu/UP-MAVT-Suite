"""Email notification service for elicitation-tools.

Sends transactional emails for study session confirmation, inactivity
warnings, and elicitation session completion notifications.

Configuration is read from the following environment variables:

* ``DISABLE_EMAIL``   – Set to ``"true"`` to disable email system entirely
                        (default: ``"false"``). When disabled, all SMTP/OAuth2
                        configuration is skipped and all email sends are silently
                        skipped. Useful for deployments where email is not needed.
* ``SMTP_HOST``      – SMTP server hostname (default: ``localhost``).
                       Required only if ``DISABLE_EMAIL`` is ``"false"``.
* ``SMTP_PORT``      – SMTP server port (default: ``587``).
* ``SMTP_USER``      – SMTP authentication username (optional).
* ``SMTP_PASSWORD``  – SMTP authentication password (optional).
* ``EMAIL_AUTH_MODE`` – ``"basic"`` (default) or ``"oauth2"``.
* ``OAUTH2_TENANT_ID`` – Microsoft Entra tenant ID (for oauth2 mode).
* ``OAUTH2_CLIENT_ID`` – App registration client ID (for oauth2 mode).
* ``OAUTH2_CLIENT_SECRET`` – App registration secret (for oauth2 mode).
* ``OAUTH2_SCOPE``    – OAuth scope (default:
                        ``https://outlook.office365.com/.default``).
* ``SMTP_USE_TLS``   – Use STARTTLS when ``"true"`` (default: ``"true"``).
* ``SMTP_TIMEOUT_SECONDS`` – Max seconds for SMTP/OAuth2 operations (default: ``15``).
* ``EMAIL_FROM``     – Sender address (default: ``noreply@elicitation-tools.local``).
* ``APP_BASE_URL``   – Public base URL used to build links in emails
                       (default: ``http://localhost:3000``).

When ``DISABLE_EMAIL`` is ``"true"``, the service silently skips sending all
emails and does not require any SMTP or OAuth2 configuration. This is useful
for development or deployments where email is not needed.

When ``SMTP_HOST`` is not set and ``DISABLE_EMAIL`` is ``"false"``, the service
silently skips sending and logs a warning, so the application can run without
email support in development.
"""

import logging
import os
import smtplib
import base64
from functools import partial
from queue import Queue, Empty
from threading import Thread
from urllib.parse import quote
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HTML email templates
# ---------------------------------------------------------------------------

_BASE_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{subject}</title>
  <style>
    body {{ font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }}
    .container {{ max-width: 600px; margin: 32px auto; background: #fff;
                  border-radius: 8px; overflow: hidden;
                  box-shadow: 0 2px 8px rgba(0,0,0,.12); }}
    .header {{ background: #2b6cb0; color: #fff; padding: 24px 32px; }}
    .header h1 {{ margin: 0; font-size: 22px; }}
    .body {{ padding: 24px 32px; color: #333; line-height: 1.6; }}
    .code {{ display: inline-block; background: #ebf8ff; color: #2b6cb0;
             font-family: monospace; font-size: 20px; font-weight: bold;
             padding: 8px 20px; border-radius: 4px; letter-spacing: 2px;
             margin: 12px 0; }}
    .button {{ display: inline-block; background: #2b6cb0; color: #fff;
               text-decoration: none; padding: 12px 28px; border-radius: 4px;
               font-size: 15px; margin-top: 16px; }}
    .footer {{ padding: 16px 32px; font-size: 12px; color: #999;
               border-top: 1px solid #eee; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>{heading}</h1></div>
    <div class="body">{body}</div>
    <div class="footer">This is an automated message from mcda-up.psi.ch. Please do not reply.</div>
  </div>
</body>
</html>
"""

_PLAIN_FOOTER = "\n\n---\nThis is an automated message from mcda-up.psi.ch. Please do not reply."


def _html(subject, heading, body):
    return _BASE_HTML.format(subject=subject, heading=heading, body=body)


def _uuid_link(base_url, study_session_id):
    safe_uuid = quote(str(study_session_id), safe="")
    return f"{base_url}/?uuid={safe_uuid}"


def _get_secret_env(var_name):
    """Read a secret from VAR or VAR_FILE (Docker secret pattern)."""
    value = os.getenv(var_name, '').strip()
    if value:
        return value

    file_path = os.getenv(f'{var_name}_FILE', '').strip()
    if not file_path:
        return ''

    try:
        with open(file_path, 'r', encoding='utf-8') as secret_file:
            return secret_file.read().strip()
    except OSError as exc:
        logger.error('EmailService: failed to read %s_FILE from %s: %s', var_name, file_path, exc)
        return ''


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class EmailService:
    """Sends transactional emails via SMTP.

    All public ``send_*`` methods return a ``dict`` with a ``'status'`` key
    (``'sent'`` or ``'skipped'`` or ``'failed'``) and an optional ``'error'``
    key.
    """

    def __init__(self):
        self._disabled = os.getenv('DISABLE_EMAIL', 'false').lower() == 'true'
        
        if self._disabled:
            logger.info('EmailService: email disabled via DISABLE_EMAIL=true')
            # When email is disabled, skip loading SMTP/OAuth2 config entirely
            self._host = ''
            self._port = 587
            self._user = ''
            self._password = ''
            self._auth_mode = 'basic'
            self._oauth2_tenant_id = ''
            self._oauth2_client_id = ''
            self._oauth2_client_secret = ''
            self._oauth2_scope = 'https://outlook.office365.com/.default'
            self._oauth2_token_url = ''
            self._oauth2_username = ''
            self._use_tls = True
            self._smtp_timeout_seconds = self._parse_timeout_seconds(
                os.getenv('SMTP_TIMEOUT_SECONDS', '15')
            )
            self._from = 'noreply@elicitation-tools.local'
            self._base_url = 'http://localhost:3000'
        else:
            self._host = os.getenv('SMTP_HOST', '').strip()
            self._port = int(os.getenv('SMTP_PORT', '587'))
            self._user = os.getenv('SMTP_USER', '').strip()
            self._password = _get_secret_env('SMTP_PASSWORD')
            self._smtp_timeout_seconds = self._parse_timeout_seconds(
                os.getenv('SMTP_TIMEOUT_SECONDS', '15')
            )
            self._auth_mode = os.getenv('EMAIL_AUTH_MODE', 'basic').strip().lower()
            self._oauth2_tenant_id = os.getenv('OAUTH2_TENANT_ID', '').strip()
            self._oauth2_client_id = os.getenv('OAUTH2_CLIENT_ID', '').strip()
            self._oauth2_client_secret = _get_secret_env('OAUTH2_CLIENT_SECRET')
            self._oauth2_scope = os.getenv(
                'OAUTH2_SCOPE', 'https://outlook.office365.com/.default'
            ).strip()
            self._oauth2_token_url = os.getenv('OAUTH2_TOKEN_URL', '').strip()
            self._oauth2_username = os.getenv('OAUTH2_USERNAME', '').strip() or self._user
            self._use_tls = os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'
            self._from = os.getenv('EMAIL_FROM', 'noreply@elicitation-tools.local').strip()
            self._base_url = os.getenv('APP_BASE_URL', 'http://localhost:3000').rstrip('/')
    
    @staticmethod
    def _parse_timeout_seconds(value):
        try:
            parsed = float(value)
            if parsed > 0:
                return parsed
        except (TypeError, ValueError):
            pass
        return 15.0

    @property
    def _configured(self):
        """Return ``True`` when an SMTP host is configured."""
        return bool(self._host)

    @property
    def _oauth2_enabled(self):
        return self._auth_mode == 'oauth2'

    @property
    def is_disabled(self):
        """Return ``True`` when email system is disabled via DISABLE_EMAIL env var."""
        return self._disabled

    def _oauth2_missing_settings(self):
        missing = []
        if not self._oauth2_tenant_id:
            missing.append('OAUTH2_TENANT_ID')
        if not self._oauth2_client_id:
            missing.append('OAUTH2_CLIENT_ID')
        if not self._oauth2_client_secret:
            missing.append('OAUTH2_CLIENT_SECRET')
        if not self._oauth2_username:
            missing.append('OAUTH2_USERNAME/SMTP_USER')
        return missing

    def _resolve_oauth2_token_url(self):
        if self._oauth2_token_url:
            return self._oauth2_token_url
        return (
            f'https://login.microsoftonline.com/{self._oauth2_tenant_id}'
            '/oauth2/v2.0/token'
        )

    def _fetch_oauth2_access_token(self):
        missing = self._oauth2_missing_settings()
        if missing:
            raise ValueError(f'OAuth2 missing required settings: {", ".join(missing)}')

        response = requests.post(
            self._resolve_oauth2_token_url(),
            data={
                'client_id': self._oauth2_client_id,
                'client_secret': self._oauth2_client_secret,
                'scope': self._oauth2_scope,
                'grant_type': 'client_credentials',
            },
            timeout=15,
        )
        response.raise_for_status()
        token = response.json().get('access_token', '').strip()
        if not token:
            raise ValueError('OAuth2 token response missing access_token')
        return token

    def _build_xoauth2_blob(self, access_token):
        auth_string = f'user={self._oauth2_username}\x01auth=Bearer {access_token}\x01\x01'
        return base64.b64encode(auth_string.encode('utf-8')).decode('ascii')

    def _authenticate(self, server):
        if self._oauth2_enabled:
            token = self._fetch_oauth2_access_token()
            xoauth2_blob = self._build_xoauth2_blob(token)
            code, message = server.docmd('AUTH', f'XOAUTH2 {xoauth2_blob}')
            if code != 235:
                raise smtplib.SMTPAuthenticationError(code, message)
            return

        if self._user:
            server.login(self._user, self._password)

    def diagnose_auth(self):
        """Run SMTP auth diagnostics without sending an email.

        Returns:
            dict: Stage-by-stage status for token retrieval and SMTP auth.
        """
        result = {
            'status': 'failed',
            'auth_mode': self._auth_mode,
            'smtp': {
                'configured': self._configured,
                'host': self._host,
                'port': self._port,
                'use_tls': self._use_tls,
                'timeout_seconds': self._smtp_timeout_seconds,
            },
            'oauth2': {
                'enabled': self._oauth2_enabled,
                'username': self._oauth2_username,
                'token_ok': None,
                'smtp_auth_ok': None,
            },
        }

        if self._disabled:
            result['status'] = 'skipped'
            result['error'] = 'Email system is disabled via DISABLE_EMAIL=true'
            return result

        if not self._configured:
            result['status'] = 'skipped'
            result['error'] = 'SMTP_HOST is not configured'
            return result

        token = None
        if self._oauth2_enabled:
            try:
                token = self._run_with_timeout(
                    self._fetch_oauth2_access_token,
                    'oauth2 token retrieval',
                )
                result['oauth2']['token_ok'] = True
            except (requests.RequestException, ValueError) as exc:
                result['oauth2']['token_ok'] = False
                result['error_stage'] = 'oauth2_token'
                result['error'] = str(exc)
                return result

        try:
            with smtplib.SMTP(
                self._host,
                self._port,
                timeout=self._smtp_timeout_seconds,
            ) as server:
                server.ehlo()
                if self._use_tls:
                    server.starttls()
                    server.ehlo()

                if self._oauth2_enabled:
                    xoauth2_blob = self._build_xoauth2_blob(token)
                    code, message = server.docmd('AUTH', f'XOAUTH2 {xoauth2_blob}')
                    if code != 235:
                        raise smtplib.SMTPAuthenticationError(code, message)
                elif self._user:
                    server.login(self._user, self._password)

            result['status'] = 'ok'
            if self._oauth2_enabled:
                result['oauth2']['smtp_auth_ok'] = True
            return result

        except (
            smtplib.SMTPException,
            ConnectionError,
            TimeoutError,
            OSError,
        ) as exc:
            result['error_stage'] = 'smtp_auth'
            result['error'] = str(exc)
            if self._oauth2_enabled:
                result['oauth2']['smtp_auth_ok'] = False
            return result
        except TimeoutError as exc:
            result['error_stage'] = 'timeout'
            result['error'] = str(exc)
            if self._oauth2_enabled:
                result['oauth2']['smtp_auth_ok'] = False
            return result

    def _build_message(self, to, subject, html_body, plain_body, attachment=None, attachment_name=None):
        """Build a MIME email message.

        Args:
            to (str): Recipient address.
            subject (str): Email subject line.
            html_body (str): HTML content.
            plain_body (str): Plain-text fallback.
            attachment (bytes | None): Optional binary attachment.
            attachment_name (str | None): Filename for the attachment.

        Returns:
            MIMEMultipart: The assembled message.
        """
        msg = MIMEMultipart('mixed')
        msg['From'] = self._from
        msg['To'] = to
        msg['Subject'] = subject

        alt = MIMEMultipart('alternative')
        alt.attach(MIMEText(plain_body, 'plain', 'utf-8'))
        alt.attach(MIMEText(html_body, 'html', 'utf-8'))
        msg.attach(alt)

        if attachment and attachment_name:
            part = MIMEBase('application', 'zip')
            part.set_payload(attachment)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename="{attachment_name}"')
            msg.attach(part)

        return msg

    def _run_with_timeout(self, func, operation):
        result_queue = Queue(maxsize=1)

        def _runner():
            try:
                result_queue.put(('result', func()))
            except Exception as exc:  # pragma: no cover - defensive propagation
                result_queue.put(('error', exc))

        worker = Thread(target=_runner, daemon=True)
        worker.start()
        worker.join(self._smtp_timeout_seconds)
        if worker.is_alive():
            raise TimeoutError(
                f'{operation} timed out after {self._smtp_timeout_seconds:g}s'
            )

        try:
            tag, payload = result_queue.get_nowait()
        except Empty as exc:  # pragma: no cover - defensive fallback
            raise RuntimeError(f'{operation} failed without returning a result') from exc

        if tag == 'error':
            raise payload
        return payload

    def _send_blocking(self, msg, to):
        """Transmit *msg* via SMTP and return a status dict.

        Args:
            msg (MIMEMultipart): Message to send.
            to (str): Recipient address (for logging).

        Returns:
            dict: ``{'status': 'sent'}`` on success or
                  ``{'status': 'failed', 'error': str}`` on failure.
        """
        if not self._configured:
            logger.warning(
                'EmailService: SMTP_HOST is not configured – skipping email to %s', to
            )
            return {'status': 'skipped', 'reason': 'SMTP not configured'}

        try:
            if self._use_tls:
                with smtplib.SMTP(
                    self._host,
                    self._port,
                    timeout=self._smtp_timeout_seconds,
                ) as server:
                    server.ehlo()
                    server.starttls()
                    # RFC 3207: client must EHLO again after STARTTLS.
                    server.ehlo()
                    self._authenticate(server)
                    server.sendmail(self._from, [to], msg.as_string())
            else:
                with smtplib.SMTP(
                    self._host,
                    self._port,
                    timeout=self._smtp_timeout_seconds,
                ) as server:
                    server.ehlo()
                    self._authenticate(server)
                    server.sendmail(self._from, [to], msg.as_string())

            logger.info('EmailService: sent "%s" to %s', msg['Subject'], to)
            return {'status': 'sent'}

        except (
            smtplib.SMTPException,
            requests.RequestException,
            ConnectionError,
            TimeoutError,
            OSError,
            ValueError,
        ) as exc:
            logger.error(
                'EmailService: failed to send "%s" to %s: %s',
                msg['Subject'], to, exc, exc_info=True,
            )
            return {'status': 'failed', 'error': str(exc)}
    
    def _send(self, msg, to):
        try:
            return self._run_with_timeout(
                partial(self._send_blocking, msg, to),
                'SMTP send',
            )
        except TimeoutError as exc:
            # The SMTP/OAuth2 call runs in a daemon worker thread and may still
            # finish in the background after this timeout response is returned.
            logger.error(
                'EmailService: timed out sending "%s" to %s: %s',
                msg['Subject'],
                to,
                exc,
            )
            return {
                'status': 'failed',
                'error': str(exc),
                'error_code': 'timeout',
            }

    # ------------------------------------------------------------------
    # Public send methods
    # ------------------------------------------------------------------

    def send_email_verification_code(self, to, code):
        """Send a one-time email verification code.

        Args:
            to (str): Recipient email address.
            code (str): Six-digit verification code.

        Returns:
            dict: Delivery status dict.
        """
        subject = 'Your mcda-up.psi.ch verification code'
        html_body = _html(
            subject=subject,
            heading='Verify Your Email Address',
            body=f"""\
<p>Use the following verification code to continue:</p>
<p><span class="code">{code}</span></p>
<p>This code will expire in 10 minutes.</p>""",
        )
        plain_body = (
            f'Use this verification code to continue: {code}\n\n'
            f'This code will expire in 10 minutes.'
            + _PLAIN_FOOTER
        )
        msg = self._build_message(to, subject, html_body, plain_body)
        return self._send(msg, to)

    def send_session_confirmation(self, to, study_session_id):
        """Send a study-session creation confirmation to the practitioner.

        Args:
            to (str): Practitioner email address.
            study_session_id (str): UUID of the created study session.

        Returns:
            dict: Delivery status dict (``'sent'``, ``'skipped'``, or
                ``'failed'``).
        """
        subject = f'Your Elicitation Study Session UUID: {study_session_id}'
        link = _uuid_link(self._base_url, study_session_id)

        html_body = _html(
            subject=subject,
            heading='Study Session Created',
            body=f"""\
<p>Your new study session has been created successfully. Please keep this UUID
safe – you will need it to access your session.</p>
<p><span class="code">{study_session_id}</span></p>
<p>You can access your session directly using the link below:</p>
<p><a class="button" href="{link}" style="color: #fff !important;">Open Study Session</a></p>
<p>If the button does not work, copy this link into your browser:<br>
<a href="{link}">{link}</a></p>""",
        )
        plain_body = (
            f'Your new study session has been created.\n\n'
            f'Session UUID: {study_session_id}\n\n'
            f'Access your session: {link}'
            + _PLAIN_FOOTER
        )

        msg = self._build_message(to, subject, html_body, plain_body)
        return self._send(msg, to)

    def send_inactivity_warning(self, to, code, study_session_id, months_inactive, zip_bytes, zip_filename):
        """Notify the practitioner that a case study is scheduled for deletion.

        A ZIP backup of the study is attached to the email.

        Args:
            to (str): Practitioner email address.
            code (str): Study session code.
            study_session_id (str): Study session identifier.
            months_inactive (int | float): How long the study has been inactive.
            zip_bytes (bytes): ZIP backup content to attach.
            zip_filename (str): Filename for the attachment.

        Returns:
            dict: Delivery status dict.
        """
        subject = f'Action Required: Study Session "{code}" Scheduled for Deletion'
        restore_link = _uuid_link(self._base_url, study_session_id)
        months_str = f'{int(months_inactive)}'

        html_body = _html(
            subject=subject,
            heading='Study Session Inactivity Warning',
            body=f"""\
<p>Your study session <strong>{code}</strong> has not been modified for over
{months_str} months and is scheduled for deletion in <strong>30 days</strong>.</p>
<p>A backup of your study session is attached to this email as a ZIP file
(<code>{zip_filename}</code>). You can restore it at any time via the admin panel.</p>
<p>To keep your study session active, please open it and make any change before
the deletion deadline:</p>
<p><a class="button" href="{restore_link}" style="color: #fff !important;">Open Study Session</a></p>
<p>If the button does not work, copy this link into your browser:<br>
<a href="{restore_link}">{restore_link}</a></p>""",
        )
        plain_body = (
            f'Your study session "{code}" has been inactive for over {months_str} months '
            f'and is scheduled for deletion in 30 days.\n\n'
            f'A backup ZIP file is attached to this email.\n\n'
            f'To keep your study session active, open it:\n{restore_link}'
            + _PLAIN_FOOTER
        )

        msg = self._build_message(
            to, subject, html_body, plain_body,
            attachment=zip_bytes,
            attachment_name=zip_filename,
        )
        return self._send(msg, to)

    def send_session_completed(self, to, stakeholder_name, code, study_session_id):
        """Notify the practitioner that a stakeholder completed their elicitation.

        Args:
            to (str): Practitioner email address.
            stakeholder_name (str): Name/code of the completed elicitation session.
            code (str): Study session code.
            study_session_id (str): Study session identifier.

        Returns:
            dict: Delivery status dict.
        """
        subject = f'Elicitation Complete: {stakeholder_name} – Study {code}'
        link = _uuid_link(self._base_url, study_session_id)

        html_body = _html(
            subject=subject,
            heading='Elicitation Session Completed',
            body=f"""\
<p>The elicitation session <strong>{stakeholder_name}</strong> (study
<strong>{code}</strong>) has been marked as complete by the stakeholder.</p>
<p>You can now review the responses and begin your analysis:</p>
<p><a class="button" href="{link}" style="color: #fff !important;">Open Study Session</a></p>
<p>If the button does not work, copy this link into your browser:<br>
<a href="{link}">{link}</a></p>""",
        )
        plain_body = (
            f'The elicitation session "{stakeholder_name}" for study "{code}" '
            f'has been completed by the stakeholder.\n\n'
            f'You can now review responses and begin analysis:\n{link}'
            + _PLAIN_FOOTER
        )

        msg = self._build_message(to, subject, html_body, plain_body)
        return self._send(msg, to)
