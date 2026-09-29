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

`GET /api/v2/settings` returns a flat settings object with a string `revision`
(the SHA-256 of `settings.toml`). `PATCH /api/v2/settings` requires that revision
and a partial update. Writes preserve TOML comments and use a file lock, a backup,
and an atomic replacement; stale writes return 409 without replacing user edits.
General settings and providers/models now share `.apsis/settings.toml`; HTTP MCP
declarations live in `.apsis/mcp.json`. Legacy SQLite settings/connectors and
connection JSON files are imported on first startup and retained without dual
writes. See [configuration files](config-files-design.md) for the implemented
format, migration, backups and editing behavior.

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

All Bots automatically receive shared skills from `<dataDir>/skills` (normally
`.apsis/skills`) and `~/.agents/skills`. Each skill is a directory with `SKILL.md`;
YAML `name` and `description` are optional. Apsis-local skills win name collisions.
Discovery refreshes on list/context reads without a watcher. Invalid skills are
skipped and reported in Execution & language. Full content and relative text
resources are loaded on demand with `read_skill`; resource paths cannot escape
the skill directory, including through symlinks. Scripts still require normal
shell authorization. File limits are 1 MiB, UTF-8 text.

Shared legacy skills are migrated once, preserving IDs in `x-apsis-id` frontmatter.
`skills/.legacy-backup.json` retains the original records and
`skills/.migrated-v1.json` prevents deleted files from being reimported. Keep both
when backing up. Bot-private skills stay private in the existing store.
`GET /api/skills` lists shared skills; POST creates a local skill and returns 409
for a different body with an existing name. Global skills are never written by
these APIs. Old Bot/template `skillIds` are retained but no longer limit access.

Bots still select MCP connectors explicitly. Configure them in `.apsis/mcp.json`;
the setup page is hidden, but connector APIs and per-Bot selection remain.
The sidebar contains Execution & language, Model connections, and Bot templates.
Remembered approvals live under Advanced permissions; the three modes and policy
precedence are unchanged. Telegram is removed: no polling, outbound notifications,
or channel routes; old configuration and historical data remain untouched.

## Templates and interface

`GET/POST /api/v2/templates` and `PUT/DELETE /api/v2/templates/:id` manage lightweight
templates. `POST /api/v2/bots` accepts `templateId`, copying the role, avatar, model,
legacy skill references, connectors and rules. Rules are rebound to the new Bot. Credentials,
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
