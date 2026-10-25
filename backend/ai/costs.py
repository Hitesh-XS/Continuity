import math
from decimal import ROUND_UP, Decimal

_MILLION = Decimal(1_000_000)
_SIX_PLACES = Decimal("0.000001")
CHARS_PER_TOKEN_ESTIMATE = 3  # pessimistic on purpose: an estimate only used for the spending cap
PROMPT_OVERHEAD_TOKENS = 1000  # system prompt and tool definition


def compute_cost(
    input_tokens: int, output_tokens: int, price_in: Decimal, price_out: Decimal
) -> Decimal:
    """Cost in USD, rounded UP to the sixth decimal so the ledger never under-counts."""
    raw = (Decimal(input_tokens) * price_in + Decimal(output_tokens) * price_out) / _MILLION
    return raw.quantize(_SIX_PLACES, rounding=ROUND_UP)


def estimate_input_tokens(prompt_chars: int) -> int:
    return math.ceil(prompt_chars / CHARS_PER_TOKEN_ESTIMATE) + PROMPT_OVERHEAD_TOKENS
