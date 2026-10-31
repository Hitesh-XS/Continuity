# Data inventory

What is stored where. Update this file whenever a phase adds or moves data.

| Data | Local (IndexedDB / chrome.storage) | Django / PostgreSQL | Sent to an AI provider |
|---|---|---|---|
| Account email, password hash | none | always (needed to sign in) | never |
| Access/refresh tokens | extension storage (not a secure vault) | refresh-token blacklist rows | never |
| Raw captured messages | always, while capture is on | only if `sync_mode = full_transcript_opt_in` (not built yet) | never by default; opt-in and minimized in Phase 9 |
| Project name, description, goal | yes | yes, once the user signs in and syncs projects | not in Phase 3; opt-in in Phase 9 |
| Checkpoints (snapshot, rendered package) | always | **only if `sync_mode` is not `metadata_only`** | opt-in in Phase 9 |
| Sync mode setting | yes | yes | never |
| Local projects (name, description, goal, status) | IndexedDB `continuity` → `projects` | not yet (sync arrives in Phase 6b) | never |
| Extension settings (active project, per-site capture consent and pause) | `chrome.storage.local`, key `settings` | never | never |
| Per-tab "supported page open" status (URL path only) | `chrome.storage.session` (cleared when the browser closes) | never | never |
| Site access to claude.ai | Chrome's permission store (granted by the user on Enable, revoked on Remove) | n/a | n/a |

Notes:
- | Project name, description and goal are user-written text. The server can read them
  whenever projects are synced. The UI must say so.
- `sync_mode` is enforced on the server: a `metadata_only` project refuses checkpoint uploads.
- Deleting a project deletes its checkpoints. Backups may keep copies until they expire
  (policy to be written in Phase 13).
- | Captured conversations and messages (from claude.ai, only while capture is On) | IndexedDB `continuity` → `conversations`, `messages` | never (not built; any future sync is per-project and opt-in) | never |
- | Page-reader health (counts and a state, no text) | `chrome.storage.session` (cleared when the browser closes) | never | never |
- | Checkpoints: objective, decisions, completed work, blockers, next action, notes, and references to captured conversations (no conversation text) | IndexedDB `continuity` → `checkpoints` | not yet (Phase 6b, only for projects whose sync mode allows it) | never |
- | Exported checkpoint files | the user's Downloads folder or clipboard, on request | never | never |
- | Server session: access and refresh tokens | IndexedDB `continuity` → `auth` (extension origin: not readable by web pages or content scripts) | refresh-token blacklist rows | never |
- | Sync bookkeeping (which items the server has, errors) | IndexedDB `syncItems`, `syncConfig` (identifiers and fingerprints, no content) | never | never |
- | Projects: name, description, goal, status, sync setting | yes | **only after sign-in AND sync turned on** | never |
- | Checkpoints, including titles of linked conversations | yes | **only after sign-in AND sync on AND the project set to "Details + checkpoints"** | never |
- | Chat messages | yes | **never** | never |
- | Project memory (facts, preferences, decisions, hypotheses, tasks, blockers), their status, topic, edit history (including earlier text of edited items) and references to captured messages | IndexedDB `continuity` → `memoryItems`, `memoryHistory` | **never** (memory is not synced) | never |
- | Exported memory files (Markdown or JSON) | the Downloads folder, on request | never | never |
- | Text of messages you SELECT for AI analysis (after redaction) | the extension (selected by you) | passes through Django **in memory only**: never stored, never logged | **sent to Anthropic** when you click Analyze (feature available via the API only until the UI arrives in Phase 9b) |
| AI consent record (version and time) | n/a | PostgreSQL | never |
| AI usage ledger: request id, time, model, token counts, cost, error code (no content) | n/a | PostgreSQL | never |
