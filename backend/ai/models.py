import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone


class AIConsent(models.Model):
    """The user agreed that text they select may be sent to the AI provider. Deleting it revokes."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_consent"
    )
    version = models.PositiveSmallIntegerField()
    accepted_at = models.DateTimeField(default=timezone.now)


class AIUsage(models.Model):
    """One row per AI request: counts and cost only. There are deliberately NO content fields."""

    class Status(models.TextChoices):
        RESERVED = "reserved"
        OK = "ok"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_usage"
    )
    created_at = models.DateTimeField(default=timezone.now)
    purpose = models.CharField(max_length=40)
    provider = models.CharField(max_length=30)
    model = models.CharField(max_length=100)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RESERVED)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    # While RESERVED this is the worst-case estimate; afterwards it is the actual cost.
    cost_usd = models.DecimalField(max_digits=12, decimal_places=6, default=Decimal("0"))
    error_code = models.CharField(max_length=40, blank=True, default="")

    class Meta:
        indexes = [models.Index(fields=["user", "created_at"], name="aiusage_user_created_idx")]