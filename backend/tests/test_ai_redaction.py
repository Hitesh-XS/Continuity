import pytest

from ai.redaction import redact, redact_many

# Assembled at runtime so no real-looking token appears literally in the source file.
ANTHROPIC = "sk-ant-" + "a1B2" * 8
OPENAI = "sk-" + "Ab1" * 10
OPENAI_PROJECT = "sk-proj-" + "Ab1" * 10
AWS = "AKIA" + "ABCDEFGHIJKLMNOP"
AWS_TEMP = "ASIA" + "ABCDEFGHIJKLMNOP"
GITHUB = "ghp_" + "a" * 36
GITHUB_PAT = "github_pat_" + "A1" * 20
SLACK = "xoxb-" + "1234567890-abcdefghij"
GOOGLE = "AIza" + "a" * 35
JWT = "eyJ" + "a" * 10 + ".eyJ" + "b" * 10 + "." + "c" * 10
PEM = "-----BEGIN " + "RSA PRIVATE KEY-----\nabc123\nxyz789\n-----END " + "RSA PRIVATE KEY-----"
BEARER = "x" * 24

CASES = [
    ("anthropic", f"my key is {ANTHROPIC} ok", "my key is [REDACTED:anthropic_key] ok"),
    ("openai", f"my key is {OPENAI} ok", "my key is [REDACTED:openai_key] ok"),
    ("openai project", f"my key is {OPENAI_PROJECT} ok", "my key is [REDACTED:openai_key] ok"),
    ("aws", f"id {AWS} end", "id [REDACTED:aws_access_key] end"),
    ("aws temporary", f"id {AWS_TEMP} end", "id [REDACTED:aws_access_key] end"),
    ("github", f"t {GITHUB} end", "t [REDACTED:github_token] end"),
    ("github pat", f"t {GITHUB_PAT} end", "t [REDACTED:github_token] end"),
    ("slack", f"t {SLACK} end", "t [REDACTED:slack_token] end"),
    ("google", f"k {GOOGLE} end", "k [REDACTED:google_api_key] end"),
    ("jwt", f"t {JWT} end", "t [REDACTED:jwt] end"),
    ("private key", f"before\n{PEM}\nafter", "before\n[REDACTED:private_key]\nafter"),
    (
        "url credentials",
        "postgres://admin:s3cretpass@db.example.com:5432/app",
        "postgres://[REDACTED:url_credentials]@db.example.com:5432/app",
    ),
    (
        "bearer",
        f"Authorization: Bearer {BEARER}",
        "Authorization: Bearer [REDACTED:bearer_token]",
    ),
    ("password", "password = hunter2hunter2", "password = [REDACTED:secret]"),
    ("env style", "DB_PASSWORD=abc12345", "DB_PASSWORD=[REDACTED:secret]"),
    ("quoted key", 'API_KEY: "abcdef123456"', 'API_KEY: "[REDACTED:secret]"'),
    ("json token", '{"token": "abcdef123456"}', '{"token": "[REDACTED:secret]"}'),
]


@pytest.mark.parametrize(("label", "text", "expected"), CASES, ids=[c[0] for c in CASES])
def test_secret_is_replaced(label, text, expected):
    assert redact(text).text == expected


@pytest.mark.parametrize(
    "text",
    [
        "tokens are great",
        "password: abc",
        "https://example.com:8080/path",
        "sk-short",
        "Please use a strong password policy.",
        "a normal sentence about keys and secrets",
    ],
)
def test_harmless_text_is_left_alone(text):
    result = redact(text)
    assert result.text == text
    assert result.counts == {}


def test_counts_each_kind():
    result = redact(f"{AWS} and {AWS_TEMP} and password=abcdef123")
    assert result.counts == {"aws_access_key": 2, "secret": 1}
    assert result.total == 3


def test_redaction_is_idempotent():
    text = " ".join(
        [
            ANTHROPIC,
            AWS,
            JWT,
            "postgres://admin:s3cretpass@db.example.com/app",
            f"Bearer {BEARER}",
            "password = hunter2hunter2",
            PEM,
        ]
    )
    first = redact(text)
    second = redact(first.text)
    assert second.text == first.text
    assert second.counts == {}


def test_redact_many_adds_up_counts():
    texts, counts = redact_many([f"a {AWS}", "nothing here", f"b {AWS_TEMP}"])
    assert texts == ["a [REDACTED:aws_access_key]", "nothing here", "b [REDACTED:aws_access_key]"]
    assert counts == {"aws_access_key": 2}


def test_original_secret_does_not_survive():
    assert ANTHROPIC not in redact(f"key {ANTHROPIC}").text
