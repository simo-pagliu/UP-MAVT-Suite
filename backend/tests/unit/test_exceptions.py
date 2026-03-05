"""Tests for the custom exception hierarchy."""
import pytest
from app.exceptions import (
    ServiceError,
    NotFoundError,
    ConflictError,
    ValidationError,
    LockedError,
)


class TestExceptionHierarchy:
    def test_service_error_is_base_exception(self):
        assert issubclass(ServiceError, Exception)

    def test_not_found_is_service_error(self):
        assert issubclass(NotFoundError, ServiceError)
        assert NotFoundError.status_code == 404

    def test_conflict_is_service_error(self):
        assert issubclass(ConflictError, ServiceError)
        assert ConflictError.status_code == 409

    def test_validation_is_service_error(self):
        assert issubclass(ValidationError, ServiceError)
        assert ValidationError.status_code == 400

    def test_locked_is_service_error(self):
        assert issubclass(LockedError, ServiceError)
        assert LockedError.status_code == 423

    def test_service_error_default_status_code(self):
        assert ServiceError.status_code == 400

    def test_exception_message(self):
        err = ValidationError('bad input')
        assert str(err) == 'bad input'

    def test_can_be_raised_and_caught(self):
        with pytest.raises(ServiceError):
            raise NotFoundError('not found')

    def test_each_subclass_can_be_raised(self):
        for cls in [NotFoundError, ConflictError, ValidationError, LockedError]:
            with pytest.raises(cls):
                raise cls('msg')
