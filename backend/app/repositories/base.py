from bson.objectid import ObjectId

class BaseRepository:
    @staticmethod
    def _to_oid(value):
        if isinstance(value, ObjectId):
            return value
        if not value:
            return None
        try:
            return ObjectId(value)
        except Exception:
            return None

    @staticmethod
    def _str_id(value):
        if isinstance(value, ObjectId):
            return str(value)
        if value is None:
            return None
        return str(value)
