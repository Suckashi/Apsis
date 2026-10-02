# Settings platform

> Development redesign: see [single-assistant behavior and limits](single-assistant.md). Roster, role-template and manual Bot-delegation instructions below describe the earlier product and are not available in this phase. Use a new schema-5 directory; preserve older data.

## Current runtime and format

Deep Agents is the only runtime. Supported providers are OpenAI, Anthropic,
Ollama and OpenAI-compatible APIs. There are no Codex bridges, provider aliases
or automatic data migrations. Local knowledge uses schema 5; older stores are
rejected before any database is opened. This version defaults to `.apsis-v5/`;
`APSIS_DATA_DIR` can select a custom location. Existing `.apsis/` data is not
deleted or converted.

Bot profiles are the only editable role/model source. Sessions store a `botId`
and conversation metadata. A run resolves its Bot, model, credentials and limits
once at startup, then keeps an immutable snapshot for that run.

## Settings and models

`GET /api/v2/settings` returns a flat settings object with a string `revision`
(the SHA-256 of `settings.toml`). `PATCH /api/v2/settings` requires that revision
and a partial update. Writes preserve TOML comments and use a file lock, a backup,
and an atomic replacement; stale writes return 409 without replacing user edits.
General settings and providers/models now share `.apsis-v5/settings.toml`; HTTP MCP
declarations live in `.apsis-v5/mcp.json`. New stores create these files directly. Retired SQLite settings/connectors and
connection JSON files are not read. See [configuration files](config-files-design.md) for the implemented
format, backups and editing behavior.

Defaults: 100 agent steps, 30 minutes of active task time, 60 seconds per shell
command (120-second maximum), 24,000 evidence characters, 3 delegation levels,
12 total delegated jobs, and 4 concurrent execution slots per root task.
Pending approvals and suspended parents release their execution slots. Per-Bot
queues and cyclic-delegation checks remain in place. New runtime limits are
snapshotted at task start and inherited by child jobs.

Connection APIs accept optional `modelSettings`, keyed by selected model ID:
`displayName` and `maxOutputTokens`. The latter defaults to 4096. No inference of
reasoning support from names and no additional model calls are used.

All provider forms expose an API URL. OpenAI and Anthropic use their official
endpoints when the field is blank and accept a custom `baseUrl` for proxies or
self-hosted services. Changing the endpoint clears the saved credential unless
a new API key is supplied.

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
context and inherited only down its delegation tree. Settings and grant changes are rechecked before execution. Shell is Bash
on all platforms and is not an OS sandbox; path rules do not constrain shell code.
See [approval modes and Bash](approval-modes.md) for the full ordering.

All Bots automatically receive shared skills from `<dataDir>/skills` (normally
`.apsis-v5/skills`) and `~/.agents/skills`. Each skill is a directory with `SKILL.md`;
YAML `name` and `description` are optional. Apsis-local skills win name collisions.
Discovery refreshes on list/context reads without a watcher. Invalid skills are
skipped and reported in Execution & language. Full content and relative text
resources are loaded on demand with `read_skill`; resource paths cannot escape
the skill directory, including through symlinks. Scripts still require normal
shell authorization. File limits are 1 MiB, UTF-8 text.

Bot-private skills stay private in the knowledge store. Shared skills exist only
as `SKILL.md` directories; there is no Bot/template `skillIds` selection.
`GET /api/skills` lists shared skills; POST creates a local skill and returns 409
for a different body with an existing name. Global skills are never written by
these APIs.

Bots still select MCP connectors explicitly. Configure them in `.apsis-v5/mcp.json`;
the setup page is hidden, but connector APIs and per-Bot selection remain.
The sidebar contains Execution & language, Model connections, and Bot templates.
Remembered approvals live under Advanced permissions; the three modes and policy
precedence are unchanged. Telegram is removed: no polling, outbound notifications,
or channel routes; old configuration and historical data remain untouched.

## Templates and interface

`GET/POST /api/v2/templates` and `PUT/DELETE /api/v2/templates/:id` manage lightweight
templates. `POST /api/v2/bots` accepts `templateId`, copying the role, avatar, model,
connectors and rules. Rules are rebound to the new Bot. Credentials,
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
