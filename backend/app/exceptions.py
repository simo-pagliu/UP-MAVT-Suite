class ServiceError(Exception):
    """Base exception for service-layer errors."""
    status_code = 400

class NotFoundError(ServiceError):
    status_code = 404

class ConflictError(ServiceError):
    status_code = 409

class ValidationError(ServiceError):
    status_code = 400

class LockedError(ServiceError):
    status_code = 423
