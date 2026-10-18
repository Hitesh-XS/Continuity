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
- Project name, description and goal are user-written text. The server can read them
  whenever projects are synced. The UI must say so.
- `sync_mode` is enforced on the server: a `metadata_only` project refuses checkpoint uploads.
- Deleting a project deletes its checkpoints. Backups may keep copies until they expire
  (policy to be written in Phase 13).