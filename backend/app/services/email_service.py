"""Email notification service for elicitation-tools.

Sends transactional emails for study session confirmation, inactivity
warnings, and elicitation session completion notifications.

Configuration is read from the following environment variables:

* ``SMTP_HOST``      – SMTP server hostname (default: ``localhost``).
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
* ``EMAIL_FROM``     – Sender address (default: ``noreply@elicitation-tools.local``).
* ``APP_BASE_URL``   – Public base URL used to build links in emails
                       (default: ``http://localhost:3000``).

When ``SMTP_HOST`` is not set the service silently skips sending and logs a
warning, so the application can run without email support in development.
"""

import logging
import os
import smtplib
import base64
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
        self._host = os.getenv('SMTP_HOST', '').strip()
        self._port = int(os.getenv('SMTP_PORT', '587'))
        self._user = os.getenv('SMTP_USER', '').strip()
        self._password = os.getenv('SMTP_PASSWORD', '').strip()
        self._use_tls = os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'
        self._from = os.getenv('EMAIL_FROM', 'noreply@elicitation-tools.local').strip()
        self._base_url = os.getenv('APP_BASE_URL', 'http://localhost:3000').rstrip('/')

    @property
    def _configured(self):
        """Return ``True`` when an SMTP host is configured."""
        return bool(self._host)

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

    def _send(self, msg, to):
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
                with smtplib.SMTP(self._host, self._port, timeout=15) as server:
                    server.ehlo()
                    server.starttls()
                    if self._user:
                        server.login(self._user, self._password)
                    server.sendmail(self._from, [to], msg.as_string())
            else:
                with smtplib.SMTP(self._host, self._port, timeout=15) as server:
                    if self._user:
                        server.login(self._user, self._password)
                    server.sendmail(self._from, [to], msg.as_string())

            logger.info('EmailService: sent "%s" to %s', msg['Subject'], to)
            return {'status': 'sent'}

        except (
            smtplib.SMTPException,
            ConnectionError,
            TimeoutError,
            OSError,
        ) as exc:
            logger.error(
                'EmailService: failed to send "%s" to %s: %s',
                msg['Subject'], to, exc, exc_info=True,
            )
            return {'status': 'failed', 'error': str(exc)}

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
