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