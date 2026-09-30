# Apsis architecture

Apsis is a single-owner, single-process Node.js application. Deep Agents is the
only runtime; a Bot selects its provider and model. This version uses schema 4
and supports only the current data model. Older stores are rejected before
opening databases, with their original files preserved. Startup defaults to a new `.apsis-v4/` directory, leaving older `.apsis/` stores
untouched. No automatic import is performed. `server/app-directories.ts` defines
one directory policy for the app, sharing and live model checks. `APSIS_DATA_DIR`
selects a custom location; the workspace defaults to `<dataDir>/workspace`.

## Boundaries

`server/product.ts` is the composition root. It creates services, connects their
typed dependencies, starts recovery and background ticks, and owns shutdown.
Domain services receive only the resources and operations they use:

| Module                | Responsibility                                                       |
| --------------------- | -------------------------------------------------------------------- |
| `bot-service.ts`      | Profiles, templates, model choices and Bot lifecycle                 |
| `message-service.ts`  | Idempotent receipts, message delivery, steering and new topics       |
| `job-service.ts`      | Durable queues, delegation and execution slots                       |
| `approval-service.ts` | Permission context, policy, authorization and decisions              |
| `artifact-service.ts` | Published snapshots and generated/read documents                     |
| `routine-service.ts`  | Schedules and independent scheduled contexts                         |
| `product-queries.ts`  | Typed public snapshots, Bot detail and run views                     |
| `product-tools.ts`    | Model-facing domain tools and connector access                       |
| `chat-workspaces.ts`  | Context Git metadata, verification and PR tracking                   |
| `execution-state.ts`  | Shared transient controllers, waits, slots and delivery coordination |

`server/routes/` owns HTTP parsing and response handling, divided into core,
projects, files, Bot conversation/workspace/assets, and operation routes.
`product-routes.ts` dispatches requests. Routes call domain services; they do not
implement queue execution or model calls. `app.ts` enforces Host/Origin checks,
serves the UI and handles the remaining model/skill/storage endpoints.

`TaskService` owns run IDs, cancellation, transcripts and operation journals.
`run-config.ts` resolves the Bot's role, model, credentials and connector context
once at run start. TaskService copies model/runtime settings and the agent
configuration before calling its runner. There is no persisted Agent profile or
session model selection competing with Bot configuration.

The Deep Agents adapter in `server/engines/deep.ts` connects the resolved model
and Apsis tools to `createDeepAgent`. It owns the same-name summarization
middleware, bounded model budgets, versioned normalized checkpoints and a
context-scoped scratch backend. Native `task` and `execute` are disabled; Bot
delegation and host execution go through Apsis authorization and journaling.

## Browser boundary

`shared/api.ts` defines public views and Bot, template, routine and message request
contracts. `request-schema.ts` validates configuration, knowledge, file and action
requests; `message-schema.ts` validates message delivery. Unknown fields and wrong
types return HTTP 400 before mutation. Domain checks still enforce ownership,
revisions, model availability and reference freshness. Clients send writable
fields instead of submitting complete response objects.

`public/bot.tsx` composes layout, navigation, chat controls and modal entry points.
`use-chat-data.ts` owns parallel data refreshes, stale-response guards, transcript
pagination preservation and SSE lifecycle. `use-chat-composer.ts` owns drafts,
attachments, references and idempotent delivery. `conversation-messages.tsx` and
`chat-composer.tsx` render those workflows. Profile, settings, routine editing,
artifact cards and Markdown/icons are separate components.

## Execution

A Bot executes one queued job at a time. Different Bots may run concurrently.
Messages during active chat become steering at the next invocation boundary;
otherwise they enter the queue. Receipts distinguish received, applied and
not-applied instructions. Retrying an HTTP request does not duplicate a message.
Jobs and routines use fixed WorkContexts and locations; scheduled/delegated work
has its own context. Starting a new topic preserves the Bot and visible history.

Runtime limits are captured at job start and inherited by delegated descendants.
Depth, root-job count and cyclic wait checks bound delegation. Execution slots
are limited per root task; approvals and waiting parents release a slot and
reacquire it before resuming. `task-lifecycle.ts` owns Job, Run, user-message and
steering delivery transitions. Terminal tasks cannot resume; retries create new
tasks. A restart expires pending approvals and reconciles active jobs against
their journals. A completed journal requires a committed assistant transcript;
otherwise it becomes interrupted. Unfinished operations and draft sends become
unknown. External actions are never replayed automatically.

`createApp().close()` stops admission, cancels queued/active work, ends SSE and
waits for HTTP handlers, background work and running tasks. It then drains run
journals and knowledge writes and closes both SQLite databases. Repeated close
calls share a promise. SIGINT/SIGTERM use this path; cleanup errors produce a
nonzero CLI exit. Journal write failures stop a run and are surfaced to the user
and shutdown caller; temporary files are removed and settled write queues pruned.
Journals and transcripts are separate stores, so restart reconciliation covers
the window between their commits.

Models use `@langchain/openai` or `@langchain/anthropic`; Ollama and custom
endpoints use OpenAI-compatible Chat Completions. Credentials stay server-side.
All providers default to a 256K token context window when unset; per-model
configuration takes precedence. Current checkpoints require version 1 and the
explicit `deepagents@1.14.0` engine tag. Raw history remains separate.

## Storage

| Store                              | Data and writes                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `product.sqlite`                   | Bots, templates, jobs, approvals, artifacts, routines, receipts and events                      |
| `conversations.sqlite`             | Session metadata, paged messages, FTS history, WorkContexts, checkpoints and compaction records |
| `state.json` (schema 4)            | Projects, memories and private skills; serialized atomic knowledge mutations                    |
| `settings.toml` / `mcp.json`       | Current model/runtime/UI configuration and HTTP MCP declarations                                |
| `skills/` plus `~/.agents/skills/` | Shared `SKILL.md` directories, discovered on demand                                             |
| `runs/` / `context-files/`         | Operation journals, private scratch and offloaded context                                       |

ProductDB exposes typed repositories with fixed record kinds. Queue and Bot
queries filter in SQLite, with indexes on Bot, session, status and run fields.
Conversation writes use their own SQLite transactions; appending a message never
rewrites knowledge or other sessions. Knowledge changes validate the complete
current state and replace the JSON file atomically, retaining its last backup.

Configuration writes preserve comments, compare file-hash revisions, use locks
and atomic replacement, and retain `.bak` files. Missing initialized files and
invalid formats stop startup rather than silently resetting state. There are no
old JSON/SQLite imports, Codex bridges or permanent approval compatibility paths.
Stop the application before copying its complete data directory for backup.

## Permissions and verification

`shared/settings.ts`, `server/settings.ts` and `server/policy.ts` define bounded
settings and deterministic policy decisions. Readonly, ancestor restrictions,
explicit denies, dangerous-command checks and current task grants apply across
workflows. Each Bot selects MCP connectors; shared skills are available on
demand. Documents and tool output remain untrusted task data. Relative file
paths and symlinks are checked separately from shell policy. Shell runs on the
host and is not an operating-system sandbox.

Templates copy role, avatar, model, connectors and permission rules, excluding
credentials, conversations, memories and runtime state. The locale controls UI
text without translating source messages or evidence.

Run `npm run check`, `npm test` and `npm run build`. Browser scripts verify chat,
Bot delegation, settings, context, files and mobile composer flows using isolated
stores and deterministic model fixtures. They do not certify live provider
credentials. See [settings](settings-platform.md), [context and memory](conversation-context.md),
and [chat work](coding-workbench.md) for detailed behavior.
