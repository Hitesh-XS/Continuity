from decimal import Decimal

import pytest

from ai.costs import compute_cost, estimate_input_tokens

ONE = Decimal("1.00")
FIVE = Decimal("5.00")


@pytest.mark.parametrize(
    ("tokens_in", "tokens_out", "expected"),
    [
        (0, 0, "0.000000"),
        (1000, 200, "0.002000"),
        (1_000_000, 0, "1.000000"),
        (0, 1_000_000, "5.000000"),
        (1, 1, "0.000006"),
    ],
)
def test_compute_cost(tokens_in, tokens_out, expected):
    assert compute_cost(tokens_in, tokens_out, ONE, FIVE) == Decimal(expected)


def test_cost_rounds_up_never_down():
    assert compute_cost(1, 0, Decimal("0.30"), FIVE) == Decimal("0.000001")


def test_estimate_includes_prompt_overhead():
    assert estimate_input_tokens(0) == 1000
    assert estimate_input_tokens(300) == 1100
    assert estimate_input_tokens(301) == 1101
