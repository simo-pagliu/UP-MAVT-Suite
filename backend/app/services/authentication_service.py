"""Authentication service.

This module provides :class:`AuthenticationService`, which centralises admin
password hashing and verification so the logic can be reused if multiple admin
accounts or more complex authentication flows are introduced in the future.

The admin password is persisted in MongoDB (the ``admin`` collection) once the
system is first accessed.  On the initial request the password is read from the
``ADMIN_PASSWORD`` environment variable (or ``ADMIN_PASSWORD_FILE`` for Docker
secrets), hashed, and written to the database.  All subsequent authentications
use the database value.

Docker secrets
--------------
When running with Docker Swarm or Compose secrets, set the
``ADMIN_PASSWORD_FILE`` environment variable to the path of the secret file
(e.g. ``/run/secrets/admin_password``).  The ``ADMIN_PASSWORD`` environment
variable takes precedence if both are set.

Usage
-----
Hashing a new password (e.g. for initial setup)::

    from app.services import AuthenticationService

    hashed = AuthenticationService.hash_password('my-secure-password')
    # Store the returned string in ADMIN_PASSWORD or in the secret file.

Verifying a login attempt (with a database handle)::

    svc = AuthenticationService(db)
    if svc.authenticate(submitted_password):
        # Grant access.
        ...
"""

import hmac
import logging
import os

from werkzeug.security import check_password_hash, generate_password_hash

from app.repositories import UsersRepository

logger = logging.getLogger(__name__)

# The plain-text fallback used when ADMIN_PASSWORD is not set at all.
# This exists purely to avoid a hard crash during development; it must *not*
# be used in any production environment.
_DEFAULT_PLAIN_PASSWORD = 'admin123'


def _read_admin_password() -> str:
    """Read the admin password from the environment or a Docker secret file.

    Resolution order:

    1. ``ADMIN_PASSWORD`` environment variable (direct value).
    2. The file pointed to by ``ADMIN_PASSWORD_FILE`` (Docker secrets pattern).
    3. Empty string if neither is configured.

    Returns:
        The raw password/hash string, or ``''`` when nothing is configured.
    """
    value = os.getenv('ADMIN_PASSWORD', '').strip()
    if value:
        return value

    file_path = os.getenv('ADMIN_PASSWORD_FILE', '').strip()
    if not file_path:
        return ''

    try:
        with open(file_path, 'r', encoding='utf-8') as secret_file:
            return secret_file.read().strip()
    except OSError as exc:
        logger.error(
            'AuthenticationService: failed to read ADMIN_PASSWORD_FILE from %s: %s',
            file_path, exc,
        )
        return ''


class AuthenticationService:
    """Service for admin password hashing and verification.

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
                # Bootstrap: read from env or secret file, hash, and persist to DB.
                env_password = _read_admin_password()
                if not env_password:
                    logger.warning(
                        'Neither ADMIN_PASSWORD nor ADMIN_PASSWORD_FILE is configured. '
                        'Falling back to the default insecure password. '
                        'Set ADMIN_PASSWORD or ADMIN_PASSWORD_FILE in production.'
                    )
                    env_password = _DEFAULT_PLAIN_PASSWORD
                if self._is_hashed(env_password):
                    stored = env_password
                else:
                    stored = self.hash_password(env_password)
                repo.set_password_hash(stored)
            return self.verify_password(plain_password, stored)

        # No database — fall back to environment-variable-only behaviour.
        stored = _read_admin_password()
        if not stored:
            logger.warning(
                'Neither ADMIN_PASSWORD nor ADMIN_PASSWORD_FILE is configured. '
                'Falling back to the default insecure password. '
                'Set ADMIN_PASSWORD or ADMIN_PASSWORD_FILE in production.'
            )
            stored = _DEFAULT_PLAIN_PASSWORD
        return self.verify_password(plain_password, stored)

