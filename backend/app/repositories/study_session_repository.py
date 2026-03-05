"""Repository for the *study_sessions* collection."""

from bson.objectid import ObjectId
from .base import BaseRepository


class StudySessionRepository(BaseRepository):
    """Data-access object for the ``study_sessions`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.study_sessions

    def find_by_id(self, study_session_id):
        """Retrieve a single study session document by its identifier.

        Args:
            study_session_id: The document's ``_id`` (string or ObjectId).

        Returns:
            dict | None: The document, or ``None`` if not found.
        """
        oid = self._to_oid(study_session_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def find_by_code(self, code):
        """Retrieve a study session by its unique practitioner code.

        Args:
            code (str): The session's ``code`` field value.

        Returns:
            dict | None: The first matching document, or ``None``.
        """
        return self._col.find_one({'code': code})

    def find_all(self):
        """Return all study sessions sorted by creation date (newest first).

        Returns:
            list[dict]: All study session documents.
        """
        return list(self._col.find().sort('created_at', -1))

    def insert(self, doc):
        """Insert a new study session document.

        Args:
            doc (dict): The document to insert.

        Returns:
            ObjectId: The ``_id`` of the newly inserted document.
        """
        return self._col.insert_one(doc).inserted_id

    def update(self, study_session_id, fields):
        """Apply a ``$set`` update to the specified study session.

        Args:
            study_session_id: The document's ``_id`` (string or ObjectId).
            fields (dict): The fields to set.

        Returns:
            int: The number of documents modified (0 or 1).
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def delete(self, study_session_id):
        """Delete a study session document by its identifier.

        Args:
            study_session_id: The document's ``_id`` (string or ObjectId).

        Returns:
            int: The number of documents deleted (0 or 1).
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count

    def unset_fields(self, study_session_id, field_names):
        """Remove specific fields from a study session document using ``$unset``.

        Args:
            study_session_id: The document's ``_id`` (string or ObjectId).
            field_names (list[str]): Names of the fields to remove.

        Returns:
            int: The number of documents matched (0 or 1).
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        unset_doc = {f: '' for f in field_names}
        return self._col.update_one({'_id': oid}, {'$unset': unset_doc}).matched_count
