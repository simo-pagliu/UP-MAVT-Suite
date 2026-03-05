"""Repository for the *inputs* collection.

An *input* document holds the shared criteria definition that is linked to a
study session and inherited by all of its elicitation sessions.
"""

from datetime import datetime, timezone
from .base import BaseRepository


class InputRepository(BaseRepository):
    """Data-access object for the ``inputs`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.inputs

    def find_by_id(self, input_id):
        """Retrieve a single input document by its identifier.

        Args:
            input_id: The document's ``_id`` (string or ObjectId).

        Returns:
            dict | None: The document, or ``None`` if not found or if
            *input_id* cannot be converted to an ObjectId.
        """
        oid = self._to_oid(input_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def insert(self, doc):
        """Insert a new input document into the collection.

        Args:
            doc (dict): The document to insert.

        Returns:
            ObjectId: The ``_id`` of the newly inserted document.
        """
        return self._col.insert_one(doc).inserted_id

    def update_criteria(self, input_id, criteria):
        """Replace the criteria list in an existing input document.

        Also updates the ``updated_at`` timestamp.

        Args:
            input_id: The document's ``_id`` (string or ObjectId).
            criteria (list[dict]): The new list of criterion definitions.

        Returns:
            int: The number of documents modified (0 or 1).
        """
        oid = self._to_oid(input_id)
        if not oid:
            return 0
        return self._col.update_one(
            {'_id': oid},
            {'$set': {'criteria': criteria, 'updated_at': datetime.now(timezone.utc)}}
        ).modified_count

    def delete(self, input_id):
        """Delete an input document by its identifier.

        Args:
            input_id: The document's ``_id`` (string or ObjectId).

        Returns:
            int: The number of documents deleted (0 or 1).
        """
        oid = self._to_oid(input_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count
