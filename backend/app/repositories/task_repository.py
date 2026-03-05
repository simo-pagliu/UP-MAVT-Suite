from datetime import datetime, timezone
from .base import BaseRepository

class TaskRepository(BaseRepository):
    def __init__(self, db):
        self._col = db.tasks

    def find_by_id(self, task_id):
        oid = self._to_oid(task_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def find_active_for_study(self, study_session_id):
        return self._col.find_one(
            {'params.study_session_id': str(study_session_id), 'status': {'$in': ['pending', 'running']}},
            sort=[('created_at', -1)]
        )

    def insert(self, doc):
        return self._col.insert_one(doc).inserted_id

    def update(self, task_id, fields):
        oid = self._to_oid(task_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def cancel_pending_for_study(self, study_session_id, task_type, step_number=None):
        query = {
            'params.study_session_id': str(study_session_id),
            'type': task_type,
            'status': {'$in': ['pending', 'running']},
        }
        if step_number is not None:
            query['params.step_number'] = step_number
        return self._col.update_many(query, {'$set': {'status': 'cancelled'}}).modified_count

    def cancel_task(self, task_id):
        oid = self._to_oid(task_id)
        if not oid:
            return 0
        return self._col.update_one(
            {'_id': oid, 'status': {'$in': ['pending', 'running']}},
            {'$set': {'status': 'cancelled', 'completed_at': datetime.now(timezone.utc)}}
        ).modified_count
