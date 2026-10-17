from rest_framework import status
from rest_framework.exceptions import APIException


class Conflict(APIException):
    """HTTP 409. Pass a specific `code` so the client can react to it."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with existing data."
    default_code = "conflict"