import json

import httpx
import pytest

from ai.providers.anthropic_provider import ANTHROPIC_VERSION, API_URL, AnthropicProvider
from ai.providers.base import ProviderError

CALL = {
    "system": "SYS",
    "user": "USER-TEXT-12345",
    "tool_name": "record_memory_items",
    "tool_description": "d",
    "schema": {"type": "object"},
    "max_tokens": 500,
}


def ok_payload(**over):
    payload = {
        "model": "test-model",
        "stop_reason": "tool_use",
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "record_memory_items",
                "input": {"items": []},
            }
        ],
        "usage": {"input_tokens": 120, "output_tokens": 30},
    }
    payload.update(over)
    return payload


def provider_for(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return AnthropicProvider(api_key="KEY-123", model="test-model", client=client)


def test_sends_the_documented_request():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=ok_payload())

    provider_for(handler).complete_structured(**CALL)
    request = seen[0]
    body = json.loads(request.content)
    assert request.method == "POST"
    assert str(request.url) == API_URL
    assert request.headers["x-api-key"] == "KEY-123"
    assert request.headers["anthropic-version"] == ANTHROPIC_VERSION
    assert "authorization" not in request.headers
    assert body["model"] == "test-model"
    assert body["max_tokens"] == 500
    assert body["system"] == "SYS"
    assert body["messages"] == [{"role": "user", "content": "USER-TEXT-12345"}]
    assert body["tools"] == [
        {"name": "record_memory_items", "description": "d", "input_schema": {"type": "object"}}
    ]
    assert body["tool_choice"] == {"type": "tool", "name": "record_memory_items"}
    assert "temperature" not in body


def test_parses_the_tool_result_and_usage():
    result = provider_for(
        lambda request: httpx.Response(200, json=ok_payload())
    ).complete_structured(**CALL)
    assert result.data == {"items": []}
    assert (result.input_tokens, result.output_tokens, result.model) == (120, 30, "test-model")


def test_ignores_text_blocks_around_the_tool_call():
    content = [
        {"type": "text", "text": "thinking aloud"},
        {"type": "tool_use", "id": "t", "name": "record_memory_items", "input": {"items": [1]}},
    ]
    result = provider_for(
        lambda r: httpx.Response(200, json=ok_payload(content=content))
    ).complete_structured(**CALL)
    assert result.data == {"items": [1]}


@pytest.mark.parametrize(
    ("status", "kind", "retryable"),
    [
        (401, "auth", False),
        (403, "auth", False),
        (429, "rate_limited", True),
        (500, "unavailable", True),
        (529, "unavailable", True),
        (400, "bad_request", False),
        (404, "bad_request", False),
    ],
)
def test_maps_http_errors(status, kind, retryable):
    handler = lambda request: httpx.Response(
        status, json={"error": {"type": "some_error", "message": "m"}}
    )  # noqa: E731
    with pytest.raises(ProviderError) as caught:
        provider_for(handler).complete_structured(**CALL)
    assert (caught.value.kind, caught.value.retryable) == (kind, retryable)


def test_a_timeout_is_retryable():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ProviderError) as caught:
        provider_for(handler).complete_structured(**CALL)
    assert (caught.value.kind, caught.value.retryable) == ("timeout", True)


def test_a_connection_failure_is_retryable():
    def handler(request):
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(ProviderError) as caught:
        provider_for(handler).complete_structured(**CALL)
    assert (caught.value.kind, caught.value.retryable) == ("unavailable", True)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"<html>proxy page</html>"),
        httpx.Response(200, json=[1, 2]),
        httpx.Response(200, json=ok_payload(content=[{"type": "text", "text": "no tool"}])),
        httpx.Response(
            200,
            json=ok_payload(
                content=[
                    {"type": "tool_use", "id": "t", "name": "record_memory_items", "input": "nope"}
                ]
            ),
        ),
        httpx.Response(
            200,
            json=ok_payload(
                content=[
                    {"type": "tool_use", "id": "t", "name": "other_tool", "input": {"items": []}}
                ]
            ),
        ),
    ],
    ids=["not-json", "not-an-object", "no-tool-block", "input-not-an-object", "wrong-tool"],
)
def test_unusable_answers_are_retryable_invalid_output(response):
    with pytest.raises(ProviderError) as caught:
        provider_for(lambda request: response).complete_structured(**CALL)
    assert (caught.value.kind, caught.value.retryable) == ("invalid_output", True)


def test_a_truncated_answer_is_not_retried_and_still_reports_its_tokens():
    handler = lambda request: httpx.Response(200, json=ok_payload(stop_reason="max_tokens"))  # noqa: E731
    with pytest.raises(ProviderError) as caught:
        provider_for(handler).complete_structured(**CALL)
    assert caught.value.kind == "invalid_output"
    assert caught.value.retryable is False
    assert (caught.value.input_tokens, caught.value.output_tokens) == (120, 30)


def test_a_bad_answer_after_a_successful_call_still_reports_its_tokens():
    handler = lambda request: httpx.Response(200, json=ok_payload(content=[]))  # noqa: E731
    with pytest.raises(ProviderError) as caught:
        provider_for(handler).complete_structured(**CALL)
    assert (caught.value.input_tokens, caught.value.output_tokens) == (120, 30)


def test_error_messages_never_contain_the_key_or_the_text():
    handler = lambda request: httpx.Response(  # noqa: E731
        401,
        json={
            "error": {"type": "authentication_error", "message": "bad KEY-123 for USER-TEXT-12345"}
        },
    )
    with pytest.raises(ProviderError) as caught:
        provider_for(handler).complete_structured(**CALL)
    text = str(caught.value)
    assert "KEY-123" not in text
    assert "USER-TEXT-12345" not in text
