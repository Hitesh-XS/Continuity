import uuid

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

User = get_user_model()


def test_project_uses_custom_user_model():
    assert User._meta.label == "accounts.User"


@pytest.mark.django_db
def test_create_user_normalizes_email_and_hashes_password():
    user = User.objects.create_user(email="Alice@Example.COM", password="s3cret-pass-123")
    assert user.email == "alice@example.com"
    assert user.password != "s3cret-pass-123"
    assert user.check_password("s3cret-pass-123")
    assert user.is_staff is False
    assert isinstance(user.id, uuid.UUID)


def test_email_is_required():
    with pytest.raises(ValueError):
        User.objects.create_user(email="", password="s3cret-pass-123")


@pytest.mark.django_db
def test_duplicate_email_is_rejected_case_insensitively():
    User.objects.create_user(email="a@example.com", password="s3cret-pass-123")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(email="A@Example.com", password="s3cret-pass-123")


@pytest.mark.django_db
def test_create_superuser_sets_flags():
    admin = User.objects.create_superuser(email="root@example.com", password="s3cret-pass-123")
    assert admin.is_staff is True
    assert admin.is_superuser is True


def test_superuser_cannot_be_created_without_staff_flag():
    with pytest.raises(ValueError):
        User.objects.create_superuser(
            email="root@example.com", password="s3cret-pass-123", is_staff=False
        )
