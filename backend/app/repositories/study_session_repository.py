from bson.objectid import ObjectId
from .base import BaseRepository

class StudySessionRepository(BaseRepository):
    def __init__(self, db):
        self._col = db.study_sessions

    def find_by_id(self, study_session_id):
        oid = self._to_oid(study_session_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def find_by_code(self, code):
        return self._col.find_one({'code': code})

    def find_all(self):
        return list(self._col.find().sort('created_at', -1))

    def insert(self, doc):
        return self._col.insert_one(doc).inserted_id

    def update(self, study_session_id, fields):
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def delete(self, study_session_id):
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count

    def unset_fields(self, study_session_id, field_names):
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        unset_doc = {f: '' for f in field_names}
        return self._col.update_one({'_id': oid}, {'$unset': unset_doc}).matched_count
