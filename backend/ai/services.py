import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from common.errors import ApiProblem

from .config import AIConfig, load_config
from .costs import compute_cost, estimate_input_tokens
from .extraction import (
    SCHEMA,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    Prompt,
    Validated,
    build_prompt,
    validate_items,
)
from .models import AIConsent, AIUsage
from .providers import build_provider
from .providers.base import LLMProvider, ProviderError
from .redaction import redact_many

logger = logging.getLogger(__name__)

PURPOSE = "extract_memory"
MAX_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 1.0
RESERVATION_TTL = timedelta(minutes=15)

_PROBLEMS = {
    "auth": (503, "ai_unavailable", "AI analysis is not available right now."),
    "rate_limited": (503, "ai_busy", "The AI service is busy. Try again in a minute."),
    "unavailable": (502, "ai_provider_error", "The AI service could not complete the request."),
    "timeout": (504, "ai_timeout", "The AI service took too long to respond."),
    "bad_request": (502, "ai_provider_error", "The AI service could not complete the request."),
    "invalid_output": (
        502,
        "ai_invalid_output",
        "The AI service returned an answer that could not be used.",
    ),
}


def has_consent(user: Any) -> bool:
    version = getattr(settings, "AI_CONSENT_VERSION", 1)
    return AIConsent.objects.filter(user=user, version=version).exists()


def month_start(now: datetime) -> datetime:
    return datetime(now.year, now.month, 1, tzinfo=UTC)


def month_spend(user: Any, now: datetime) -> Decimal:
    """This calendar month's cost, including recent reservations. Expired reservations are ignored."""
    counted = Q(status__in=[AIUsage.Status.OK, AIUsage.Status.FAILED]) | Q(
        status=AIUsage.Status.RESERVED, created_at__gte=now - RESERVATION_TTL
    )
    total = AIUsage.objects.filter(counted, user=user, created_at__gte=month_start(now)).aggregate(
        total=Sum("cost_usd")
    )["total"]
    return total or Decimal("0")


@dataclass
class _Tally:
    input_tokens: int = 0
    output_tokens: int = 0
    attempts: int = 0

    def add(self, input_tokens: int, output_tokens: int) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens


@dataclass(frozen=True)
class ExtractionOutput:
    items: list[dict[str, Any]]
    usage: dict[str, Any]
    redactions: dict[str, Any]
    dropped: dict[str, int]
    request_id: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "items": self.items,
            "usage": self.usage,
            "redactions": self.redactions,
            "dropped": self.dropped,
            "request_id": self.request_id,
        }


def _reserve(
    user: Any, config: AIConfig, provider_name: str, estimate: Decimal, now: datetime
) -> AIUsage:
    """Checks the cap and records a reservation atomically, so concurrent requests cannot both fit."""
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(
            pk=user.pk
        )  # serialises this user's requests
        if month_spend(user, now) + estimate > config.monthly_budget:
            raise ApiProblem(403, "ai_budget_exceeded", "The monthly AI budget would be exceeded.")
        return AIUsage.objects.create(
            user=user,
            purpose=PURPOSE,
            provider=provider_name,
            model=config.model,
            status=AIUsage.Status.RESERVED,
            cost_usd=estimate,
        )


def _finalize(row: AIUsage, config: AIConfig, tally: _Tally, status: str, error_code: str) -> None:
    """Replaces the reservation with what was actually used. Zero tokens releases it entirely."""
    price_in = config.price_in or Decimal("0")
    price_out = config.price_out or Decimal("0")
    row.input_tokens = tally.input_tokens
    row.output_tokens = tally.output_tokens
    row.cost_usd = compute_cost(tally.input_tokens, tally.output_tokens, price_in, price_out)
    row.status = status
    row.error_code = error_code[:40]
    row.save(update_fields=["input_tokens", "output_tokens", "cost_usd", "status", "error_code"])
    # Counts and codes only: never message text.
    logger.info(
        "ai.extract user=%s request=%s status=%s attempts=%s input_tokens=%s output_tokens=%s cost_usd=%s",
        row.user_id,
        row.pk,
        status,
        tally.attempts,
        tally.input_tokens,
        tally.output_tokens,
        row.cost_usd,
    )


def _run_attempts(
    provider: LLMProvider,
    config: AIConfig,
    prompt: Prompt,
    tally: _Tally,
    sleeper: Callable[[float], None],
) -> Validated:
    last: ProviderError | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        tally.attempts = attempt
        try:
            result = provider.complete_structured(
                system=prompt.system,
                user=prompt.user,
                tool_name=TOOL_NAME,
                tool_description=TOOL_DESCRIPTION,
                schema=SCHEMA,
                max_tokens=config.max_output_tokens,
            )
        except ProviderError as exc:
            tally.add(exc.input_tokens, exc.output_tokens)
            last = exc
            if exc.retryable and attempt < MAX_ATTEMPTS:
                sleeper(RETRY_BACKOFF_SECONDS)
                continue
            raise
        tally.add(result.input_tokens, result.output_tokens)
        validated = validate_items(result.data, prompt.label_to_id)
        if not validated.malformed and (validated.items or validated.raw_count == 0):
            return validated  # an empty list is a valid answer: nothing qualified
        last = ProviderError("invalid_output", "The AI answer could not be used.", retryable=True)
    raise last or ProviderError("invalid_output", "The AI answer could not be used.")


def extract_memory(
    *,
    user: Any,
    messages: Sequence[Mapping[str, str]],
    provider_factory: Callable[[AIConfig], LLMProvider] | None = None,
    now: datetime | None = None,
    sleep: Callable[[float], None] | None = None,
) -> ExtractionOutput:
    config = load_config()
    if not config.ready:
        raise ApiProblem(503, "ai_disabled", "AI analysis is not enabled on this server.")
    if not has_consent(user):
        raise ApiProblem(403, "ai_consent_required", "Consent to AI analysis is required first.")

    texts, redaction_counts = redact_many([message["text"] for message in messages])
    prepared = [
        {"id": message["id"], "role": message["role"], "text": text}
        for message, text in zip(messages, texts, strict=True)
    ]
    if sum(len(text) for text in texts) > config.max_input_chars:
        raise ApiProblem(
            413, "ai_input_too_large", "The selected messages are too long to analyse."
        )

    prompt = build_prompt(prepared)
    provider = (provider_factory or build_provider)(config)
    current = now or timezone.now()
    price_in = config.price_in or Decimal("0")
    price_out = config.price_out or Decimal("0")
    estimate = compute_cost(
        estimate_input_tokens(len(prompt.user)) * MAX_ATTEMPTS,
        config.max_output_tokens * MAX_ATTEMPTS,
        price_in,
        price_out,
    )
    row = _reserve(user, config, provider.name, estimate, current)

    tally = _Tally()
    sleeper = sleep or time.sleep
    try:
        validated = _run_attempts(provider, config, prompt, tally, sleeper)
    except ProviderError as exc:
        _finalize(row, config, tally, AIUsage.Status.FAILED, exc.kind)
        if exc.kind in ("auth", "bad_request"):
            logger.error(
                "ai provider rejected the request kind=%s (check key, model and settings)", exc.kind
            )
        status, code, detail = _PROBLEMS.get(exc.kind, _PROBLEMS["unavailable"])
        raise ApiProblem(status, code, detail) from None
    except BaseException:
        _finalize(row, config, tally, AIUsage.Status.FAILED, "internal")
        raise

    _finalize(row, config, tally, AIUsage.Status.OK, "")
    return ExtractionOutput(
        items=validated.items,
        usage={
            "input_tokens": tally.input_tokens,
            "output_tokens": tally.output_tokens,
            "cost_usd": format(row.cost_usd, "f"),
        },
        redactions={"total": sum(redaction_counts.values()), "by_kind": redaction_counts},
        dropped={
            "unsupported": validated.dropped_unsupported,
            "invalid": validated.dropped_invalid,
        },
        request_id=str(row.pk),
    )
