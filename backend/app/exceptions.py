"""Custom exception hierarchy for the elicitation-tools service layer.

All exceptions raised by services inherit from :class:`ServiceError` so that
Flask's error handler can translate them into the appropriate HTTP responses.
"""


class ServiceError(Exception):
    """Base exception for all service-layer errors.

    Attributes:
        status_code (int): The HTTP status code that should be returned when
            this exception propagates to the API layer.
    """

    status_code = 400


class NotFoundError(ServiceError):
    """Raised when a requested resource does not exist in the database."""

    status_code = 404


class ConflictError(ServiceError):
    """Raised when an operation would violate a uniqueness constraint."""

    status_code = 409


class ValidationError(ServiceError):
    """Raised when the caller supplies invalid or incomplete input data."""

    status_code = 400


class LockedError(ServiceError):
    """Raised when an attempt is made to modify a locked resource."""

    status_code = 423
