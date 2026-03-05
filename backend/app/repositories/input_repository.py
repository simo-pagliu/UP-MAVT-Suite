from datetime import datetime, timezone
from .base import BaseRepository

class InputRepository(BaseRepository):
    def __init__(self, db):
        self._col = db.inputs

    def find_by_id(self, input_id):
        oid = self._to_oid(input_id)
        return self._col.find_one({'_id': oid}) if oid else None

    def insert(self, doc):
        return self._col.insert_one(doc).inserted_id

    def update_criteria(self, input_id, criteria):
        oid = self._to_oid(input_id)
        if not oid:
            return 0
        return self._col.update_one(
            {'_id': oid},
            {'$set': {'criteria': criteria, 'updated_at': datetime.now(timezone.utc)}}
        ).modified_count

    def delete(self, input_id):
        oid = self._to_oid(input_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count
