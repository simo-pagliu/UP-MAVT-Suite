"""Users repository.

Provides :class:`UsersRepository`, which manages user documents stored in the
``users`` MongoDB collection.  Currently this repository is used to persist
the admin password hash, acting as the single source of truth once the system
has been bootstrapped.
"""

from .base import BaseRepository


class UsersRepository(BaseRepository):
    """Data-access object for the ``users`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.users

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

