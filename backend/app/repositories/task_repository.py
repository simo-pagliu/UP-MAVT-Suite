"""Repository for the *tasks* collection.

Tasks represent background jobs (weight computation, step execution) that are
processed by a separate worker process.
"""

from datetime import datetime, timezone
from .base import BaseRepository


class TaskRepository(BaseRepository):
    """Data-access object for the ``tasks`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.tasks

    def find_by_id(self, task_id):
        """Retrieve a single task document by its identifier.

        Args:
            task_id: The document's ``_id`` (string or ObjectId).

        Returns:
            dict | None: The document, or ``None`` if not found.
        """
        oid = self._to_oid(task_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def find_active_for_study(self, study_session_id):
        """Find the most recent pending or running task for a study session.

        Args:
            study_session_id: The study session's identifier.

        Returns:
            dict | None: The most recent active task document, or ``None``.
        """
        return self._col.find_one(
            {'params.study_session_id': str(study_session_id), 'status': {'$in': ['pending', 'running']}},
            sort=[('created_at', -1)]
        )

    def insert(self, doc):
        """Insert a new task document.

        Args:
            doc (dict): The document to insert.

        Returns:
            ObjectId: The ``_id`` of the newly inserted document.
        """
        return self._col.insert_one(doc).inserted_id

    def update(self, task_id, fields):
        """Apply a ``$set`` update to the specified task.

        Args:
            task_id: The document's ``_id`` (string or ObjectId).
            fields (dict): The fields to set.

        Returns:
            int: The number of documents modified (0 or 1).
        """
        oid = self._to_oid(task_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def cancel_pending_for_study(self, study_session_id, task_type, step_number=None):
        """Cancel all pending or running tasks of a given type for a study session.

        Optionally restricts cancellation to tasks for a specific step number.

        Args:
            study_session_id: The study session's identifier.
            task_type (str): The task ``type`` field value to match (e.g.
                ``'compute_weights'``, ``'run_step'``).
            step_number (int | None): If provided, only tasks whose
                ``params.step_number`` matches this value are cancelled.

        Returns:
            int: The number of documents modified.
        """
        query = {
            'params.study_session_id': str(study_session_id),
            'type': task_type,
            'status': {'$in': ['pending', 'running']},
        }
        if step_number is not None:
            query['params.step_number'] = step_number
        return self._col.update_many(query, {'$set': {'status': 'cancelled'}}).modified_count

    def cancel_task(self, task_id):
        """Cancel a single pending or running task and record its completion time.

        Does nothing if the task is already in a terminal state (completed,
        failed, cancelled).

        Args:
            task_id: The document's ``_id`` (string or ObjectId).

        Returns:
            int: The number of documents modified (0 or 1).
        """
        oid = self._to_oid(task_id)
        if not oid:
            return 0
        return self._col.update_one(
            {'_id': oid, 'status': {'$in': ['pending', 'running']}},
            {'$set': {'status': 'cancelled', 'completed_at': datetime.now(timezone.utc)}}
        ).modified_count
