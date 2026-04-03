"""Admin repository.

Provides :class:`AdminRepository`, which manages the single admin user document
stored in the ``admin`` MongoDB collection.  This repository is the source of
truth for the admin password hash once the system has been bootstrapped.
"""

from .base import BaseRepository


class AdminRepository(BaseRepository):
    """Data-access object for the ``admin`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.admin

    def find_password_hash(self):
        """Return the stored admin password hash, or ``None`` if not set.

        Returns:
            str | None: The hashed password string, or ``None`` when no admin
            document exists in the collection yet.
        """
        doc = self._col.find_one({'role': 'admin'})
        return doc.get('password_hash') if doc else None

    def set_password_hash(self, password_hash):
        """Upsert the admin password hash in the collection.

        Args:
            password_hash (str): A hashed password string produced by
                :meth:`AuthenticationService.hash_password`.
        """
        self._col.update_one(
            {'role': 'admin'},
            {'$set': {'password_hash': password_hash}},
            upsert=True,
        )
