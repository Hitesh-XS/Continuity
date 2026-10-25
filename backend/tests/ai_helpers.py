from ai.providers.base import ProviderResult


class FakeProvider:
    """A scripted stand-in for the provider. Each call consumes the next scripted step."""

    name = "fake"

    def __init__(self, *script, repeat: bool = False):
        self.script = list(script)
        self.repeat = repeat
        self.calls: list[dict] = []

    def complete_structured(self, **kwargs):
        self.calls.append(kwargs)
        step = self.script[0] if self.repeat else self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def reply(items, input_tokens: int = 1000, output_tokens: int = 200) -> ProviderResult:
    return ProviderResult(
        data={"items": items},
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model="fake-model",
    )


def memory_item(kind="fact", text="The API uses JWT", topic="auth", evidence=("M1",)) -> dict:
    return {"kind": kind, "text": text, "topic": topic, "evidence": list(evidence)}


def msgs(*texts: str) -> list[dict]:
    return [
        {"id": f"m{i + 1}", "role": "user" if i % 2 == 0 else "assistant", "text": text}
        for i, text in enumerate(texts)
    ]
