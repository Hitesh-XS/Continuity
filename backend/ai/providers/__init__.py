from ..config import AIConfig
from .anthropic_provider import AnthropicProvider
from .base import LLMProvider


def build_provider(config: AIConfig) -> LLMProvider:
    """The one place that knows which provider is in use. Adding another means adding it here."""
    return AnthropicProvider(
        api_key=config.api_key, model=config.model, timeout=float(config.timeout_seconds)
    )