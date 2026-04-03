"""Email verification code workflow for practitioner onboarding."""

from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets


class EmailVerificationService:
    """Issue and validate short-lived email verification codes."""

    _EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

    def __init__(self, db):
        self._collection = db.email_verifications

    @classmethod
    def _normalize_email(cls, email):
        return str(email or '').strip().lower()

    @classmethod
    def is_valid_email_format(cls, email):
        return bool(cls._EMAIL_RE.match(cls._normalize_email(email)))

    @staticmethod
    def _hash_code(email, code):
        payload = f'{email}:{code}'.encode('utf-8')
        return hashlib.sha256(payload).hexdigest()

    @staticmethod
    def _as_utc_aware(value):
        """Normalize datetimes from DB to UTC-aware objects.

        PyMongo may return naive datetime objects depending on client config.
        We treat naive values as UTC to keep comparisons stable.
        """
        if not isinstance(value, datetime):
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def issue_code(self, email, code_ttl_minutes=10):
        normalized_email = self._normalize_email(email)
        if not self.is_valid_email_format(normalized_email):
            return {'ok': False, 'error': 'Invalid email format'}

        code = f'{secrets.randbelow(1000000):06d}'
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=code_ttl_minutes)

        self._collection.update_one(
            {'email': normalized_email},
            {
                '$set': {
                    'email': normalized_email,
                    'code_hash': self._hash_code(normalized_email, code),
                    'created_at': now,
                    'expires_at': expires_at,
                    'attempts': 0,
                },
                '$unset': {
                    'verified_at': '',
                    'verification_token': '',
                    'token_expires_at': '',
                },
            },
            upsert=True,
        )

        return {
            'ok': True,
            'email': normalized_email,
            'code': code,
            'expires_in_seconds': code_ttl_minutes * 60,
        }

    def confirm_code(self, email, code, token_ttl_minutes=30):
        normalized_email = self._normalize_email(email)
        normalized_code = str(code or '').strip()

        if not self.is_valid_email_format(normalized_email):
            return {'ok': False, 'error': 'Invalid email format'}
        if not re.fullmatch(r'\d{6}', normalized_code):
            return {'ok': False, 'error': 'Code must be a 6-digit number'}

        doc = self._collection.find_one({'email': normalized_email})
        if not doc:
            return {'ok': False, 'error': 'No verification request found for this email'}

        now = datetime.now(timezone.utc)
        expires_at = self._as_utc_aware(doc.get('expires_at'))
        if not expires_at or now > expires_at:
            return {'ok': False, 'error': 'Verification code has expired'}

        expected_hash = doc.get('code_hash', '')
        provided_hash = self._hash_code(normalized_email, normalized_code)
        if provided_hash != expected_hash:
            self._collection.update_one(
                {'_id': doc['_id']},
                {'$inc': {'attempts': 1}},
            )
            return {'ok': False, 'error': 'Invalid verification code'}

        token = secrets.token_urlsafe(24)
        token_expires_at = now + timedelta(minutes=token_ttl_minutes)
        self._collection.update_one(
            {'_id': doc['_id']},
            {
                '$set': {
                    'verified_at': now,
                    'verification_token': token,
                    'token_expires_at': token_expires_at,
                },
                '$unset': {
                    'code_hash': '',
                    'expires_at': '',
                },
            },
        )

        return {
            'ok': True,
            'verification_token': token,
            'token_expires_in_seconds': token_ttl_minutes * 60,
        }

    def consume_verification_token(self, email, token):
        normalized_email = self._normalize_email(email)
        normalized_token = str(token or '').strip()
        if not normalized_email or not normalized_token:
            return False

        doc = self._collection.find_one(
            {
                'email': normalized_email,
                'verification_token': normalized_token,
            }
        )
        if not doc:
            return False

        now = datetime.now(timezone.utc)
        token_expires_at = self._as_utc_aware(doc.get('token_expires_at'))
        if not token_expires_at or now > token_expires_at:
            return False

        # One-time token consumption: prevent token replay.
        self._collection.update_one(
            {'_id': doc['_id']},
            {
                '$unset': {
                    'verification_token': '',
                    'token_expires_at': '',
                }
            },
        )
        return True