# Settings platform

## Runtime and migration

Deep Agents is the only active engine. The app does not initialize Codex, advertise
it, or expose its login/MCP routes. Legacy provider/session/run types and historical
files remain readable. This does not uninstall Codex or remove local credentials.

Existing Codex Bots (including the old inherited default) retain their histories
and files, are marked `needsModelSelection`, and have their routines disabled.
Selecting an available explicit or global default model clears the blocker.
Schedules must then be re-enabled explicitly; missed work is not replayed. There
is no automatic API-billed fallback.

## Settings and models

`GET /api/v2/settings` returns a flat settings object with `revision`.
`PATCH /api/v2/settings` requires that revision and a partial update. SQLite updates
are transactional; stale writes return 409 without replacing user edits.

Defaults: 100 agent steps, 30 minutes of active task time, 60 seconds per shell
command (120-second maximum), 24,000 evidence characters, 3 delegation levels,
12 total delegated jobs, and 4 concurrent execution slots per root task.
Pending approvals and suspended parents release their execution slots. Per-Bot
queues and cyclic-delegation checks remain in place. New runtime limits are
snapshotted at task start and inherited by child jobs.

Connection APIs accept optional `modelSettings`, keyed by selected model ID:
`displayName` and `maxOutputTokens`. The latter defaults to 4096. No inference of
reasoning support from names and no additional model calls are used.

## Permissions and selections

Rules match exact tool names (or `*`), optional workspace-relative file/directory
paths, and optional target Bot IDs. Global and Bot rules combine with precedence
the Kimi-style mode/history/guard ordering described in [approval modes](approval-modes.md). Paths include descendants only on segment boundaries. Windows
matching is case-insensitive and rejects traversal and ambiguous path aliases.
Filesystem tools independently enforce workspace and symlink restrictions.

Readonly denies local mutations, host commands, MCP calls and browser mutations;
an allow rule cannot override readonly. Native Deep Agents `task` and `execute`
are excluded: host tools and Bot delegation pass through the Apsis gate. Its
private StateBackend scratch filesystem is not the user's filesystem.

Child work retains ancestor restrictions. Approval defaults to yolo, with manual
and auto also available. The dangerous-command guard precedes task approval history;
history precedes configured asks. Exact-operation grants are scoped to the work
context and inherited only down its delegation tree. Old permanent grants are
inactive. Settings and grant changes are rechecked before execution. Shell is Bash
on all platforms and is not an OS sandbox; path rules do not constrain shell code.
See [approval modes and Bash](approval-modes.md) for the full ordering and migration.

Bots select shared skills and MCP connectors explicitly. Existing Bots retain
their prior available sets during migration; new Bots start with empty selections.
Connector selection grants availability; the selected approval mode controls its calls.

## Templates and interface

`GET/POST /api/v2/templates` and `PUT/DELETE /api/v2/templates/:id` manage lightweight
templates. `POST /api/v2/bots` accepts `templateId`, copying the role, avatar, model,
skills, connectors and rules. Rules are rebound to the new Bot. Credentials,
messages, memories and runtime state are never copied. Changing a template does
not change existing Bots. Invalid model references must be replaced before use.

The interface retains the existing theme and compact task history. Settings use
progressive disclosure, explicit save/cancel actions, accessible labels and
44px touch targets. The language preference is persisted; source messages and
tool evidence are not machine-translated.

## Verification

Run `npm run check`, `npm test`, and the browser verification scripts. Tests use
isolated temporary stores and deterministic/local model fixtures; they do not
certify live external provider credentials. Third-party executable plugins,
dedicated search-provider management, new model protocols and vision capability
management are outside this version.
