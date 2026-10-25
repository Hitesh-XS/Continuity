import logging
import re
from typing import Any

import httpx

from .base import ProviderError, ProviderResult

logger = logging.getLogger(__name__)

API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
_SAFE_TYPE = re.compile(r"^[a-z_]{1,60}$")


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _classify_status(status: int) -> tuple[str, bool]:
    if status in (401, 403):
        return "auth", False
    if status == 429:
        return "rate_limited", True
    if status >= 500:  # includes 529 "overloaded"
        return "unavailable", True
    return "bad_request", False  # 400, 404 (for example a wrong model name), 413, 422


def _error_type(response: httpx.Response) -> str:
    """The provider's short error category (like "not_found_error"), or "unknown". Never the message."""
    try:
        value = response.json()["error"]["type"]
    except (ValueError, KeyError, TypeError):
        return "unknown"
    return value if isinstance(value, str) and _SAFE_TYPE.match(value) else "unknown"


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout: float = 60.0,
        client: httpx.Client | None = None,
        url: str = API_URL,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout
        self._client = client
        self._url = url

    def _post(self, headers: dict[str, str], body: dict[str, Any]) -> httpx.Response:
        if self._client is not None:
            return self._client.post(self._url, headers=headers, json=body, timeout=self._timeout)
        with httpx.Client() as client:  # redirects are not followed by default: the key stays here
            return client.post(self._url, headers=headers, json=body, timeout=self._timeout)

    def complete_structured(
        self,
        *,
        system: str,
        user: str,
        tool_name: str,
        tool_description: str,
        schema: dict[str, Any],
        max_tokens: int,
    ) -> ProviderResult:
        body = {
            "model": self._model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "tools": [{"name": tool_name, "description": tool_description, "input_schema": schema}],
            "tool_choice": {"type": "tool", "name": tool_name},
        }
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        try:
            response = self._post(headers, body)
        except httpx.TimeoutException:
            raise ProviderError("timeout", "The AI service timed out.", retryable=True) from None
        except httpx.HTTPError:
            raise ProviderError(
                "unavailable", "The AI service could not be reached.", retryable=True
            ) from None

        if not response.is_success:
            kind, retryable = _classify_status(response.status_code)
            logger.warning(
                "anthropic request failed status=%s type=%s",
                response.status_code,
                _error_type(response),
            )
            raise ProviderError(
                kind,
                f"The AI service answered with status {response.status_code}.",
                retryable=retryable,
            )

        try:
            payload = response.json()
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            raise ProviderError(
                "invalid_output", "The AI service sent an unreadable answer.", retryable=True
            )

        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        input_tokens = _count(usage.get("input_tokens"))
        output_tokens = _count(usage.get("output_tokens"))

        if payload.get("stop_reason") == "max_tokens":
            raise ProviderError(
                "invalid_output",
                "The AI answer was cut off.",
                retryable=False,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

        data: object = None
        for block in payload.get("content") or []:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_use"
                and block.get("name") == tool_name
            ):
                data = block.get("input")
                break
        if not isinstance(data, dict):
            raise ProviderError(
                "invalid_output",
                "The AI answer had no usable result.",
                retryable=True,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
        model = payload.get("model")
        return ProviderResult(
            data=data,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model if isinstance(model, str) else self._model,
        )
