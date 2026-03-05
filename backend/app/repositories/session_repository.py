"""Repository for the *sessions* (elicitation sessions) collection."""

from bson.objectid import ObjectId
from .base import BaseRepository


class SessionRepository(BaseRepository):
    """Data-access object for the ``sessions`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.sessions

    def find_by_id(self, session_id):
        """Retrieve a single session document by its identifier.

        Args:
            session_id: The document's ``_id`` (string or ObjectId).

        Returns:
            dict | None: The document, or ``None`` if not found.
        """
        oid = self._to_oid(session_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def find_by_name(self, name):
        """Retrieve a session by its unique name (session code).

        Args:
            name (str): The session's ``name`` field value.

        Returns:
            dict | None: The first matching document, or ``None``.
        """
        return self._col.find_one({'name': name})

    def find_all(self):
        """Return all sessions sorted by creation date (newest first).

        Returns:
            list[dict]: All session documents.
        """
        return list(self._col.find().sort('created_at', -1))

    def find_by_study_session_id(self, study_session_id):
        """Return all sessions that belong to a given study session.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            list[dict]: Matching session documents, newest first.
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return []
        return list(self._col.find({'study_session_id': oid}).sort('created_at', -1))

    def count_by_study_session_id(self, study_session_id):
        """Count sessions that belong to a given study session.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            int: The number of matching documents.
        """
        oid = self._to_oid(study_session_id)
        return self._col.count_documents({'study_session_id': oid}) if oid else 0

    def insert(self, doc):
        """Insert a new session document.

        Args:
            doc (dict): The document to insert.

        Returns:
            ObjectId: The ``_id`` of the newly inserted document.
        """
        return self._col.insert_one(doc).inserted_id

    def update(self, session_id, fields):
        """Apply a ``$set`` update to the specified session.

        Args:
            session_id: The document's ``_id`` (string or ObjectId).
            fields (dict): The fields to set.

        Returns:
            int: The number of documents modified (0 or 1).
        """
        oid = self._to_oid(session_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def delete(self, session_id):
        """Delete a session document by its identifier.

        Args:
            session_id: The document's ``_id`` (string or ObjectId).

        Returns:
            int: The number of documents deleted (0 or 1).
        """
        oid = self._to_oid(session_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count

    def find_by_ids(self, session_ids):
        """Retrieve multiple sessions by a list of identifiers.

        Invalid or unparseable identifiers are silently skipped.

        Args:
            session_ids (list): A list of ``_id`` values (strings or ObjectIds).

        Returns:
            list[dict]: Documents whose ``_id`` is in the resolved list.
        """
        oids = [oid for sid in session_ids if (oid := self._to_oid(sid)) is not None]
        if not oids:
            return []
        return list(self._col.find({'_id': {'$in': oids}}))

    def delete_many_by_study_session_id(self, study_session_id):
        """Delete all sessions that belong to a given study session.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            int: The number of documents deleted.
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.delete_many({'study_session_id': oid}).deleted_count
