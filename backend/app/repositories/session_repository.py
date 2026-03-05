from bson.objectid import ObjectId
from .base import BaseRepository

class SessionRepository(BaseRepository):
    def __init__(self, db):
        self._col = db.sessions

    def find_by_id(self, session_id):
        oid = self._to_oid(session_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def find_by_name(self, name):
        return self._col.find_one({'name': name})

    def find_all(self):
        return list(self._col.find().sort('created_at', -1))

    def find_by_study_session_id(self, study_session_id):
        oid = self._to_oid(study_session_id)
        if not oid:
            return []
        return list(self._col.find({'study_session_id': oid}).sort('created_at', -1))

    def count_by_study_session_id(self, study_session_id):
        oid = self._to_oid(study_session_id)
        return self._col.count_documents({'study_session_id': oid}) if oid else 0

    def insert(self, doc):
        return self._col.insert_one(doc).inserted_id

    def update(self, session_id, fields):
        oid = self._to_oid(session_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def delete(self, session_id):
        oid = self._to_oid(session_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count

    def find_by_ids(self, session_ids):
        oids = [oid for sid in session_ids if (oid := self._to_oid(sid)) is not None]
        if not oids:
            return []
        return list(self._col.find({'_id': {'$in': oids}}))

    def delete_many_by_study_session_id(self, study_session_id):
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.delete_many({'study_session_id': oid}).deleted_count
