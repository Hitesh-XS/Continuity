from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "date_joined")
        read_only_fields = ("id", "email", "date_joined")


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    # max_length stops absurdly long passwords from being hashed (a cheap DoS).
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs: dict) -> dict:
        candidate = User(email=attrs["email"])
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(max_length=4096)


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Login with email, case-insensitively (emails are stored lowercased)."""

    def validate(self, attrs: dict) -> dict:
        email = attrs.get(self.username_field)
        if isinstance(email, str):
            attrs[self.username_field] = email.strip().lower()
        return super().validate(attrs)
