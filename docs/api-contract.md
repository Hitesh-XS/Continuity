# API contract (v1)

Base path: `/api/v1/`. JSON only. Authenticated requests send `Authorization: Bearer <access>`.

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/auth/register/` | POST | none | `{email, password}` -> 201 user. 403 `registration_disabled` if off. |
| `/auth/token/` | POST | none | `{email, password}` -> `{access, refresh}` |
| `/auth/token/refresh/` | POST | none | `{refresh}` -> `{access, refresh}` (old refresh revoked) |
| `/auth/logout/` | POST | none | `{refresh}` -> 204 (refresh revoked) |
| `/account/me/` | GET, PATCH | Bearer | PATCH accepts `first_name`, `last_name` only |

Errors: `{"error": {"code", "message", "details?", "error_id?"}}`

Codes in use: `validation_error`, `parse_error`, `not_authenticated`, `token_not_valid`,
`no_active_account`, `throttled`, `permission_denied`, `registration_disabled`,
`method_not_allowed`, `payload_too_large`, `server_error`.

Lifetimes: access 15 min, refresh 7 days, rotated on every refresh.


## AI analysis (optional, off by default)

| Endpoint | Method | Notes |
|---|---|---|
| `/ai/status/` | GET | `enabled`, `model`, `consented`, `monthly_budget_usd`, `spent_usd`, `remaining_usd` |
| `/ai/consent/` | POST, DELETE | POST `{version}` records consent; DELETE revokes it |
| `/ai/extract-memory/` | POST | `{messages:[{id, role, text}]}` (1-60 messages, 40,000 characters in total). Returns `items` (each with `evidence_ids`), `usage`, `redactions`, `dropped`, `request_id`. Nothing is stored except a usage ledger. |

Codes: `ai_disabled` (503), `ai_consent_required` (403), `ai_budget_exceeded` (403),
`ai_input_too_large` (413), `ai_unavailable` (503), `ai_busy` (503), `ai_provider_error` (502),
`ai_timeout` (504), `ai_invalid_output` (502), plus the usual `validation_error` and `throttled`.