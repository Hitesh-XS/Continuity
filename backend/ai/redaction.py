"""Pattern-based secret redaction. A safety net, NOT a guarantee: it misses secrets that do not
look like these patterns, and it can redact harmless text that does (for example
`token_count = len(items)`). Both directions are acceptable for a privacy guard."""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

_NOT_ALREADY = r"(?!\[REDACTED)"  # makes every rule idempotent

_RULES: list[tuple[str, re.Pattern[str], str]] = [
    (
        "private_key",
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
        "[REDACTED:private_key]",
    ),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}"), "[REDACTED:anthropic_key]"),
    ("openai_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}"), "[REDACTED:openai_key]"),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "[REDACTED:aws_access_key]"),
    (
        "github_token",
        re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"),
        "[REDACTED:github_token]",
    ),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"), "[REDACTED:slack_token]"),
    (
        "google_api_key",
        re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"),
        "[REDACTED:google_api_key]",
    ),
    (
        "jwt",
        re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),
        "[REDACTED:jwt]",
    ),
    (
        "url_credentials",
        re.compile(r"\b([a-z][a-z0-9+.\-]*://)" + _NOT_ALREADY + r"[^\s/:@]+:[^\s/@]+@", re.I),
        r"\1[REDACTED:url_credentials]@",
    ),
    (
        "bearer_token",
        re.compile(r"\bbearer\s+" + _NOT_ALREADY + r"[A-Za-z0-9._~+/\-]{16,}=*", re.I),
        "Bearer [REDACTED:bearer_token]",
    ),
    (
        "secret",
        re.compile(
            r"\b([a-z0-9_\-]*(?:password|passwd|pwd|secret|token|api[_\-]?key|apikey"
            r"|access[_\-]?key|private[_\-]?key)[a-z0-9_\-]*[\"']?\s*[:=]\s*)"
            r"([\"']?)" + _NOT_ALREADY + r"([^\s\"']{6,})([\"']?)",
            re.I,
        ),
        r"\1\2[REDACTED:secret]\4",
    ),
]


@dataclass(frozen=True)
class RedactionResult:
    text: str
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return sum(self.counts.values())


def redact(text: str) -> RedactionResult:
    counts: dict[str, int] = {}
    for kind, pattern, replacement in _RULES:
        text, n = pattern.subn(replacement, text)
        if n:
            counts[kind] = counts.get(kind, 0) + n
    return RedactionResult(text, counts)


def redact_many(texts: Sequence[str]) -> tuple[list[str], dict[str, int]]:
    redacted: list[str] = []
    totals: dict[str, int] = {}
    for text in texts:
        result = redact(text)
        redacted.append(result.text)
        for kind, n in result.counts.items():
            totals[kind] = totals.get(kind, 0) + n
    return redacted, totals