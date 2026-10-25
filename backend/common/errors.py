from rest_framework import status
from rest_framework.exceptions import APIException


class Conflict(APIException):
    """HTTP 409. Pass a specific `code` so the client can react to it."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with existing data."
    default_code = "conflict"

class ApiProblem(APIException):
    """An error with an explicit HTTP status and a stable machine-readable `code`."""

    def __init__(self, status_code: int, code: str, detail: str) -> None:
        self.status_code = status_code
        super().__init__(detail=detail, code=code)