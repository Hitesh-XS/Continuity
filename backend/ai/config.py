from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from django.conf import settings


def _decimal(value: object) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return None
    return number if number.is_finite() and number >= 0 else None


@dataclass(frozen=True)
class AIConfig:
    enabled: bool
    api_key: str = field(repr=False)  # never printed or logged
    model: str
    price_in: Decimal | None
    price_out: Decimal | None
    monthly_budget: Decimal
    max_input_chars: int
    max_output_tokens: int
    timeout_seconds: int

    @property
    def ready(self) -> bool:
        """Fails closed: every ingredient must be present, including both prices."""
        return bool(
            self.enabled
            and self.api_key
            and self.model
            and self.price_in is not None
            and self.price_out is not None
        )


def load_config() -> AIConfig:
    """Read on every call, so tests and settings changes take effect immediately."""
    return AIConfig(
        enabled=bool(getattr(settings, "AI_ENABLED", False)),
        api_key=str(getattr(settings, "ANTHROPIC_API_KEY", "") or ""),
        model=str(getattr(settings, "AI_MODEL", "") or ""),
        price_in=_decimal(getattr(settings, "AI_PRICE_INPUT_PER_MTOK_USD", "")),
        price_out=_decimal(getattr(settings, "AI_PRICE_OUTPUT_PER_MTOK_USD", "")),
        monthly_budget=_decimal(getattr(settings, "AI_MONTHLY_BUDGET_USD", "0")) or Decimal("0"),
        max_input_chars=int(getattr(settings, "AI_MAX_INPUT_CHARS", 40_000)),
        max_output_tokens=int(getattr(settings, "AI_MAX_OUTPUT_TOKENS", 2_000)),
        timeout_seconds=int(getattr(settings, "AI_REQUEST_TIMEOUT_SECONDS", 60)),
    )