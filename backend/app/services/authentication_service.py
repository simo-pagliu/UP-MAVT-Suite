"""Authentication service.

This module provides :class:`AuthenticationService`, which centralises admin
password hashing, verification, and JWT token management so the logic can be
reused if multiple admin accounts or more complex authentication flows are
introduced in the future.

The admin password is persisted in MongoDB (the ``admin`` collection) once the
system is first accessed.  On the initial request the password is read from the
``ADMIN_PASSWORD`` environment variable, hashed, and written to the database.
All subsequent authentications use the database value.

JWT tokens are signed with the ``JWT_SECRET_KEY`` environment variable.  Access
tokens have a short lifetime (15 minutes by default) and refresh tokens have a
longer lifetime (7 days by default).

Usage
-----
Hashing a new password (e.g. for initial setup)::

    from app.services import AuthenticationService

    hashed = AuthenticationService.hash_password('my-secure-password')
    # Store the returned string in the ADMIN_PASSWORD environment variable.

Verifying a login attempt and issuing tokens (with a database handle)::

    svc = AuthenticationService(db)
    if svc.authenticate(submitted_password):
        access_token = svc.generate_access_token('admin')
        refresh_token = svc.generate_refresh_token('admin')

Protecting a route (Flask example)::

    from app.services import AuthenticationService

    def require_admin_token(f):
        @functools.wraps(f)
        def decorated(*args, **kwargs):
            token = AuthenticationService.extract_bearer_token(request.headers)
            payload = AuthenticationService.verify_token(token)
            if payload is None or payload.get('role') != 'admin':
                return jsonify({'error': 'Unauthorized'}), 401
            return f(*args, **kwargs)
        return decorated
"""

import datetime
import functools
import hmac
import logging
import os
import secrets

import jwt
from werkzeug.security import check_password_hash, generate_password_hash

from app.repositories import UsersRepository

logger = logging.getLogger(__name__)

# The plain-text fallback used when ADMIN_PASSWORD is not set at all.
# This exists purely to avoid a hard crash during development; it must *not*
# be used in any production environment.
_DEFAULT_PLAIN_PASSWORD = 'admin123'

# JWT token lifetimes.
_ACCESS_TOKEN_LIFETIME = datetime.timedelta(minutes=15)
_REFRESH_TOKEN_LIFETIME = datetime.timedelta(days=7)

# Fallback secret used only when JWT_SECRET_KEY env var is unset; it is
# regenerated on each process start so tokens are invalidated on restart.
_EPHEMERAL_JWT_SECRET = secrets.token_hex(32)


def _jwt_secret() -> str:
    """Return the configured JWT signing secret.

    Reads ``JWT_SECRET_KEY`` from the environment.  If it is absent a
    per-process random secret is used (tokens are invalidated on restart).
    """
    secret = os.getenv('JWT_SECRET_KEY', '')
    if not secret:
        logger.warning(
            'JWT_SECRET_KEY is not configured. '
            'Using an ephemeral secret — tokens will be invalidated on restart. '
            'Set JWT_SECRET_KEY to a stable secret in production.'
        )
        return _EPHEMERAL_JWT_SECRET
    return secret


class AuthenticationService:
    """Service for admin password hashing, verification, and JWT management.

    Args:
        db: Optional PyMongo (or mongomock) database object.  When provided,
            the service reads and writes the admin password hash to the
            ``admin`` collection so that the hash persists across restarts.
            When omitted the service falls back to environment-variable-only
            behaviour (useful for unit tests that don't need a database).
    """

    def __init__(self, db=None):
        self._db = db

    @staticmethod
    def hash_password(plain_password: str) -> str:
        """Return a secure hash of *plain_password*.

        The returned string should be stored as the ``ADMIN_PASSWORD``
        environment variable or written directly to the database via
        :meth:`UsersRepository.set_password_hash`.

        Args:
            plain_password: The plain-text password to hash.

        Returns:
            A hash string suitable for storage.

        Raises:
            ValueError: If *plain_password* is empty.
        """
        if not plain_password:
            raise ValueError('Password must not be empty')
        return generate_password_hash(plain_password)

    @staticmethod
    def _is_hashed(password: str) -> bool:
        """Return ``True`` if *password* looks like a known hash format."""
        return password.startswith(('pbkdf2:', 'scrypt:', '$2b$', '$2a$'))

    @staticmethod
    def verify_password(plain_password: str, stored_password: str) -> bool:
        """Verify *plain_password* against a stored password value.

        Accepts both hashed (recommended) and legacy plain-text stored values
        to allow a smooth migration.  A warning is logged when a plain-text
        stored value is detected.

        Args:
            plain_password: The password submitted by the user.
            stored_password: The value stored in the environment / database.

        Returns:
            ``True`` if the passwords match, ``False`` otherwise.
        """
        if not plain_password or not stored_password:
            return False

        if AuthenticationService._is_hashed(stored_password):
            return check_password_hash(stored_password, plain_password)

        # Legacy plain-text path — kept for backward compatibility.
        logger.warning(
            'ADMIN_PASSWORD appears to be stored as plain text. '
            'Please replace it with a hashed value produced by '
            'AuthenticationService.hash_password().'
        )
        return hmac.compare_digest(str(plain_password), str(stored_password))

    def authenticate(self, plain_password: str) -> bool:
        """Return ``True`` if *plain_password* matches the configured password.

        Authentication order:

        1. If a database handle was provided at construction time, look up the
           admin password hash from the ``admin`` collection.
        2. If no hash is found in the database (first run), read the password
           from the ``ADMIN_PASSWORD`` environment variable (or fall back to the
           default development password), hash it, persist it to the database,
           and use the resulting hash for this request.
        3. If no database handle is available (e.g. unit tests), read the
           password directly from the environment variable.

        Args:
            plain_password: The password submitted by the user.

        Returns:
            ``True`` if authentication succeeds, ``False`` otherwise.
        """
        if self._db is not None:
            repo = UsersRepository(self._db)
            stored = repo.find_password_hash()
            if stored is None:
                # Bootstrap: read from env, hash, and persist to DB.
                env_password = os.getenv('ADMIN_PASSWORD')
                if not env_password:
                    logger.warning(
                        'ADMIN_PASSWORD is not configured. '
                        'Falling back to the default insecure password. '
                        'Set ADMIN_PASSWORD to a hashed value in production.'
                    )
                    env_password = _DEFAULT_PLAIN_PASSWORD
                if self._is_hashed(env_password):
                    stored = env_password
                else:
                    stored = self.hash_password(env_password)
                repo.set_password_hash(stored)
            return self.verify_password(plain_password, stored)

        # No database — fall back to environment-variable-only behaviour.
        stored = os.getenv('ADMIN_PASSWORD')
        if not stored:
            logger.warning(
                'ADMIN_PASSWORD is not configured. '
                'Falling back to the default insecure password. '
                'Set ADMIN_PASSWORD to a hashed value in production.'
            )
            stored = _DEFAULT_PLAIN_PASSWORD
        return self.verify_password(plain_password, stored)

    # ---------------------------------------------------------------------- #
    # JWT token management
    # ---------------------------------------------------------------------- #

    @staticmethod
    def generate_access_token(role: str = 'admin') -> str:
        """Return a short-lived JWT access token for *role*.

        Args:
            role: The role to embed in the token (e.g. ``'admin'``).

        Returns:
            A signed JWT string valid for :data:`_ACCESS_TOKEN_LIFETIME`.
        """
        now = datetime.datetime.now(datetime.timezone.utc)
        payload = {
            'role': role,
            'type': 'access',
            'iat': now,
            'exp': now + _ACCESS_TOKEN_LIFETIME,
        }
        return jwt.encode(payload, _jwt_secret(), algorithm='HS256')

    @staticmethod
    def generate_refresh_token(role: str = 'admin') -> str:
        """Return a long-lived JWT refresh token for *role*.

        Args:
            role: The role to embed in the token (e.g. ``'admin'``).

        Returns:
            A signed JWT string valid for :data:`_REFRESH_TOKEN_LIFETIME`.
        """
        now = datetime.datetime.now(datetime.timezone.utc)
        payload = {
            'role': role,
            'type': 'refresh',
            'iat': now,
            'exp': now + _REFRESH_TOKEN_LIFETIME,
        }
        return jwt.encode(payload, _jwt_secret(), algorithm='HS256')

    @staticmethod
    def verify_token(token: str | None) -> dict | None:
        """Verify *token* and return its payload, or ``None`` on failure.

        Args:
            token: A JWT string (may be ``None``).

        Returns:
            The decoded payload dict, or ``None`` if verification fails.
        """
        if not token:
            return None
        try:
            return jwt.decode(token, _jwt_secret(), algorithms=['HS256'])
        except jwt.PyJWTError:
            return None

    @staticmethod
    def extract_bearer_token(headers) -> str | None:
        """Extract the Bearer token from an ``Authorization`` header.

        Args:
            headers: The Flask ``request.headers`` mapping.

        Returns:
            The raw token string, or ``None`` if the header is absent or
            malformed.
        """
        auth = headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[len('Bearer '):]
        return None

