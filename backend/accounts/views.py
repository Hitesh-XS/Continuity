from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import services
from .models import User
from .serializers import (
    EmailTokenObtainPairSerializer,
    LogoutSerializer,
    RegisterSerializer,
    UserSerializer,
)


class RegisterView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_register"

    def post(self, request: Request) -> Response:
        if not settings.AUTH_REGISTRATION_ENABLED:
            raise PermissionDenied(
                detail="Registration is currently disabled.", code="registration_disabled"
            )
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = services.register_user(**serializer.validated_data)
        except services.EmailAlreadyRegisteredError as exc:
            raise ValidationError(
                {"email": ["An account with this email already exists."]}
            ) from exc
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(TokenObtainPairView):
    """POST {"email", "password"} -> {"access", "refresh"}."""

    serializer_class = EmailTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_login"


class RefreshView(TokenRefreshView):
    """POST {"refresh"} -> new {"access", "refresh"}; the old refresh token is revoked."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_refresh"


class LogoutView(APIView):
    """POST {"refresh"}. The refresh token itself is the credential, so no access
    token is needed (an expired access token must not block logging out)."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_refresh"

    def post(self, request: Request) -> Response:
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.revoke_refresh_token(serializer.validated_data["refresh"])
        except services.InvalidRefreshTokenError as exc:
            raise ValidationError({"refresh": ["Token is invalid or expired."]}) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(RetrieveUpdateAPIView):
    """The authenticated user's own account. There is no user ID in the URL, so no
    way to ask for someone else's."""

    serializer_class = UserSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self) -> User:
        return self.request.user
