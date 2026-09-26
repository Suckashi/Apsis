# Apsis architecture

Apsis is a single-owner, single-process Node.js application. `npm run dev` builds the React Bot interface and starts the server. Deep Agents is the only active runtime; the model connection selects its provider and model.

## Boundaries

- **ProductService** (`server/product.ts`) owns Bot profiles, templates, per-Bot queues, cross-Bot delegation, schedules, approvals, results, MCP connectors, and browser tabs. Bots are peers. `list_bots` discovers available peers; `delegate_task` submits a job to a recipient's queue and waits for that job's result. The recipient uses its own role and model while retaining ancestor permission restrictions.
- **TaskService** (`server/tasks.ts`) owns conversation transcripts, run IDs, cancellation, model selection, operation journaling, and recovery evidence. A run belongs to the server rather than the HTTP connection.
- **Deep Agents adapter** (`server/engines/deep.ts`) connects a selected model and Apsis tools to `createDeepAgent`. Its todo list and a same-name summarization middleware handle work inside one Bot. Apsis supplies bounded model budgets, versioned normalized checkpoints, and a context-scoped disk scratch backend. Native `task` and `execute` are excluded from model tools and rejected if called, keeping delegation and host execution behind the Apsis gate. Safe checkpoints are saved after complete tool exchanges or valid final answers; raw history remains separate.
- **Settings and policy** (`shared/settings.ts`, `server/settings.ts`, `server/policy.ts`) define bounded settings, transactional SQLite revision checks, normalized permission rules, and deterministic policy decisions. `server/run-slots.ts` manages execution slots per root task.
- **Tools and authorization** (`server/tools.ts`, `server/coding-tools.ts`) expose real workspace files, memory, skills, Bash, browser, documents, schedules, and MCP. Selected tools and product extensions pass through authorization before execution and journal their outcomes. The default `yolo` mode allows operations unless an earlier deny or ask policy applies. `manual` asks for Shell, MCP calls, and browser changes; `auto` skips asks but preserves hard restrictions and explicit denies. Generated documents and published copies authorize their destination paths before writing.
- **Knowledge** (`server/context.ts`, `server/agents.ts`) supplies scoped memories and selected skills. A Bot's memory and history search are private; shared skills are selected on demand. Virtual Deep Agents files do not grant access to host files.

## Execution

Web and paired Telegram send messages to the same Bot queues. Each Bot executes one job at a time. A new message during a run queues for later; a steering message is applied at the next Deep Agents invocation boundary. Separate Bots may run concurrently. A delegated job is bounded by depth and root-job count, and cyclic waits are rejected. Runtime limits are snapshotted at job start and inherited by children. Execution slots are limited per root task; waiting for approval or a child releases a slot, then execution resumes after reacquiring it.

Deep Agents uses `@langchain/openai` or `@langchain/anthropic` depending on the saved model connection. Ollama and custom compatible endpoints use their OpenAI-compatible Chat Completions endpoint. Credentials remain server-side. Per-model settings support a display name, output-token limit, and context-window limit. All providers default to a 256K (262,144-token) context window when the field is blank; an explicit per-model setting takes precedence.

Codex execution, sign-in and bridge routes are retired. Legacy types and historical records remain readable, but legacy Codex Bots require explicit model selection and their schedules are disabled during migration. They are never automatically moved to a billed API. Existing Codex installations and credentials are not removed. See [settings platform](settings-platform.md) for the migration contract.

Tools touching the real workspace use restricted relative paths; symlinks and traversal are rejected. Shell runs from the workspace but can reach the host. A tool result or document is task data, not a source of instructions or new permission.

Global and Bot rules share the [approval policy](approval-modes.md): deny, dangerous command ask, auto, task grants, explicit ask, explicit allow, sensitive/Git control paths, yolo, then manual defaults. Optional paths match exact files or directory descendants on segment boundaries; Windows matching is case-insensitive. Readonly blocks mutations, shell and MCP calls regardless of approval mode. Each ancestor's policy and connector selection applies to child work; `permissionBotIds` also carries restrictions through delegated routines and their descendants. Exact-operation task grants precede ordinary asks, but never dangerous-command asks or denies. Legacy permanent approvals remain visible without granting access. Saved MCP draft sends recheck deny rules and connector selection. Path rules cannot restrict what code inside an approved shell command accesses.

Templates copy Bot configuration, rebind rules to the new Bot, and exclude credentials, transcripts, memories and runtime state. Shared skills and MCP connectors are explicit Bot selections. The settings locale is persisted as `zh-Hant` or `en`; it selects localized interface text without translating source messages or evidence. Complete interface translation is not assumed.

Run records save operation evidence at tool boundaries. An interrupted run is not replayed. A later task may receive a bounded excerpt of prior failure evidence and must inspect current state before repeating work. Incomplete tool state is not adopted. A completed tool exchange can remain a safe checkpoint after later failure or cancellation; external operations are never automatically replayed.

## Storage

`.apsis/product.sqlite` stores product records, settings revisions, templates, permission rules and events using SQLite WAL. Settings updates compare the submitted revision inside a transaction and return 409 on conflict. `.apsis/conversations.sqlite` stores paged transcripts, work contexts, normalized checkpoints and compaction records, with FTS5 trigram search. `.apsis/context-files/` stores private scratch and run-segmented offloads. `.apsis/state.json` stores knowledge and configuration with schema validation and atomic replacement; `.apsis/runs/` stores run journals. `.apsis/connections.json` and `.apsis/telegram.json` hold credentials and owner pairing. `.apsis/workspace/` holds user files. These files are excluded from Git. Stop the app before copying `.apsis/` for a complete backup.

The app is intended for one owner and one writing process. It does not provide multi-user isolation, exactly-once execution of external side effects, or an operating-system sandbox for shell commands.

See [conversation, context and memory management](conversation-context.md) for migration, budgets, lifecycle and API details.

## Verification

`npm run check` and `npm test` cover types and automated regressions, including settings validation, revision conflicts and policy integration. `npm run test:bots:browser` exercises the Bot workflow. After `npm run build`, run `node scripts/verify-settings.ts` for the settings browser checks; reports and screenshots are written to `artifacts/settings-verification/`. Browser fixtures avoid external model calls and do not certify real provider credentials or complete translation coverage.
