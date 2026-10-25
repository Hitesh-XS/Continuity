from decimal import Decimal

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services
from .config import load_config
from .models import AIConsent
from .serializers import ConsentSerializer, ExtractRequestSerializer

_SIX = Decimal("0.000001")


def _money(value: Decimal) -> str:
    return format(value.quantize(_SIX), "f")


class AIStatusView(APIView):
    def get(self, request: Request) -> Response:
        config = load_config()
        spent = services.month_spend(request.user, timezone.now())
        return Response(
            {
                "enabled": config.ready,
                "provider": "anthropic",
                "model": config.model if config.ready else None,
                "consent_version": getattr(settings, "AI_CONSENT_VERSION", 1),
                "consented": services.has_consent(request.user),
                "monthly_budget_usd": _money(config.monthly_budget),
                "spent_usd": _money(spent),
                "remaining_usd": _money(max(config.monthly_budget - spent, Decimal("0"))),
            }
        )


class AIConsentView(APIView):
    def post(self, request: Request) -> Response:
        serializer = ConsentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version = serializer.validated_data["version"]
        AIConsent.objects.update_or_create(user=request.user, defaults={"version": version})
        return Response({"consented": True, "version": version})

    def delete(self, request: Request) -> Response:
        AIConsent.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ExtractMemoryView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ai_extract"

    def post(self, request: Request) -> Response:
        serializer = ExtractRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        output = services.extract_memory(
            user=request.user,
            messages=[dict(message) for message in serializer.validated_data["messages"]],
        )
        return Response(output.as_dict())
