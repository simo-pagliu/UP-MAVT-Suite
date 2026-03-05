"""Base repository providing shared MongoDB helper utilities."""

from bson.objectid import ObjectId


class BaseRepository:
    """Mixin with common helpers for working with MongoDB ObjectIds."""

    @staticmethod
    def _to_oid(value):
        """Convert a string or existing ObjectId to a :class:`~bson.objectid.ObjectId`.

        Args:
            value: The value to convert.  May already be an ``ObjectId``, a
                24-character hex string, or any other type.

        Returns:
            ObjectId | None: The converted identifier, or ``None`` when the
            value is falsy or cannot be parsed.
        """
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
        """Convert an ObjectId (or any value) to its string representation.

        Args:
            value: The value to convert.  Handles ``ObjectId`` instances,
                ``None``, and any other type via ``str()``.

        Returns:
            str | None: The string form of the identifier, or ``None`` when
            *value* is ``None``.
        """
        if isinstance(value, ObjectId):
            return str(value)
        if value is None:
            return None
        return str(value)
