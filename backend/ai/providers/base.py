from dataclasses import dataclass
from typing import Any, Protocol


class ProviderError(Exception):
    """A provider failure. The message is ours: it never contains request or response content."""

    def __init__(
        self,
        kind: str,
        message: str,
        *,
        retryable: bool = False,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        super().__init__(message)
        self.kind = kind  # auth | rate_limited | unavailable | timeout | bad_request | invalid_output
        self.retryable = retryable
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


@dataclass(frozen=True)
class ProviderResult:
    data: dict[str, Any]
    input_tokens: int
    output_tokens: int
    model: str


class LLMProvider(Protocol):
    name: str

    def complete_structured(
        self,
        *,
        system: str,
        user: str,
        tool_name: str,
        tool_description: str,
        schema: dict[str, Any],
        max_tokens: int,
    ) -> ProviderResult: ...