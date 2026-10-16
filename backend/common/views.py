from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .health import check_database


class HealthView(APIView):
    """Unauthenticated liveness/readiness probe. Exposes no sensitive detail."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []  # monitors poll this endpoint; never rate-limit it

    def get(self, request):
        db_ok = check_database()
        body = {
            "status": "ok" if db_ok else "degraded",
            "database": "ok" if db_ok else "unavailable",
        }
        code = status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE
        return Response(body, status=code)
