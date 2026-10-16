"""One error shape for the whole API:

    {"error": {"code": "...", "message": "...", "details": ..., "error_id": "..."}}

`code` is stable and machine-readable (the extension switches on it). `message` is
human-readable. `details` carries field errors or retry hints. `error_id` appears only
for unexpected server errors so users can quote it without us exposing internals.
"""

import logging
import math
import uuid
from typing import Any

from rest_framework import status
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


def error_body(
    code: str, message: str, details: Any = None, error_id: str | None = None
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    if error_id is not None:
        error["error_id"] = error_id
    return {"error": error}


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    response = drf_exception_handler(exc, context)

    if response is None:
        # Unexpected failure. Log the traceback server-side under an ID; never put
        # the exception text in the response. Request bodies are never logged.
        error_id = uuid.uuid4().hex
        logger.error("Unhandled exception in API request (error_id=%s)", error_id, exc_info=exc)
        return Response(
            error_body("server_error", "An unexpected error occurred.", error_id=error_id),
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if isinstance(exc, ValidationError):
        response.data = error_body(
            "validation_error", "The request data was invalid.", details=response.data
        )
        return response

    data = response.data
    detail = data.get("detail") if isinstance(data, dict) else None
    code = getattr(detail, "code", None) or "error"  # ErrorDetail carries a code
    message = str(detail) if isinstance(detail, str) else "The request could not be completed."

    details = None
    if isinstance(exc, Throttled) and exc.wait is not None:
        details = {"retry_after_seconds": math.ceil(exc.wait)}

    response.data = error_body(code, message, details)
    return response
