from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

from .exceptions import error_body


class RequestBodyLimitMiddleware:
    """Reject oversized request bodies early, based on the Content-Length header.

    Requests without Content-Length (chunked uploads) are not covered here; the
    production reverse proxy must enforce its own limit too.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        try:
            length = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            return JsonResponse(
                error_body("bad_request", "Invalid Content-Length header."), status=400
            )

        if length > settings.API_MAX_REQUEST_BODY_BYTES:
            return JsonResponse(
                error_body("payload_too_large", "The request body is too large."), status=413
            )
        return self.get_response(request)
