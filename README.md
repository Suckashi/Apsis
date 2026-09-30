# Apsis

[繁體中文](README.zh-TW.md)

Apsis is a local Bot workspace built with TypeScript and Node.js. Bots run with **Deep Agents** and an API or Ollama model. Each Bot has its own role, model selection, conversation, private memory, schedules, browser tab, and results. Bots can discover teammates and delegate work; Apsis handles the queue, approvals, persistence, and cross-Bot coordination.

## Conversation first

Select a Bot and say what you need. Messages sent while it works become additional instructions; delivery receipts distinguish received, applied, and not applied. Progress, expandable tool evidence, files and replies stay in the same conversation.

The Bot menu contains new topics, chat options, schedules and memory. Model, approval and working-folder controls live in chat options. Code work uses the same conversation, with files and Git changes available on demand.

This version uses schema 4 with one current data model. Older stores are rejected before rewriting data; automatic migrations and retired execution paths have been removed. See [chat workflow](docs/coding-workbench.md).

## Start

Requires Node.js 22.19 or newer. Shell tools use Git Bash on Windows (install Git for Windows) and system Bash on Linux. `APSIS_SHELL_PATH` can select an absolute Bash executable. Without Bash, other tools remain available.

```sh
npm ci
npm run dev
```

Open <http://localhost:3100>. In **Settings & Tools → Model connections**, add an OpenAI, Anthropic, Ollama, or OpenAI-compatible endpoint and test its streaming and tool calls. Then select a Bot and send a message. Settings and model connections live in `.apsis-v4/settings.toml`; MCP servers live in `.apsis-v4/mcp.json`. API keys stay server-side and can also reference named environment variables. New stores create current configuration files directly. See [configuration files](docs/config-files-design.md) for examples, editing and backups.

Startup defaults to a fresh `.apsis-v4/` directory, so an older `.apsis/`
store does not block `npm run dev`. Older data remains untouched and is not
imported. `APSIS_DATA_DIR` in `.env` can select a custom directory; its workspace
is created under that same directory. Deep Agents supports the four providers
listed above.

For local Ollama, use `http://127.0.0.1:11434` and an installed model ID such as `qwen3.5:9b`. The Ollama server must already be running. Larger tool-capable models are recommended for complex planning and delegation.

## Architecture

```text
Web
        ↓
Domain services: Bots, messages, jobs, approvals, artifacts, routines
        ↓
TaskService → Deep Agents → selected model
        ↓
Apsis tools: workspace, memory, skills, browser, documents, MCP, schedules
        ↓
approval gate and operation journal
```

Deep Agents is the only active runtime and handles planning, context management, and virtual scratch files within one Bot. Its native `task` and `execute` tools are disabled. Apsis owns Bot identity, cross-Bot delegation, permissions, schedules, and saved results. `delegate_task` runs in an independent work context owned by the receiving Bot and returns its result to the sender. Scheduled jobs are also isolated; manual chat keeps its context until **Start a new topic** is selected.

The Deep Agents virtual filesystem is conversation scratch space. Real files use `workspace_*` tools in `.apsis-v4/workspace/`. Tool approval follows Kimi-style deterministic rules, with no LLM reviewer. The default `yolo` mode runs ordinary Shell, browser and MCP operations automatically; earlier danger/sensitive-path/permission policies can ask. `manual` and `auto` are also available. Shell runs on the host, and neither the workspace nor a path rule is an operating-system sandbox.

Long-term transcripts use SQLite with paged history and search. Context checkpoints, automatic compaction, core/reference memory and per-model token budgets keep continuing chats bounded. See the [context and memory guide](docs/conversation-context.md).

## Settings and templates

Settings persist execution limits and a `zh-Hant` or `en` language preference. The defaults are 100 agent steps, 30 minutes of active task time, 60 seconds per shell command, 24,000 evidence characters, 3 delegation levels, 12 delegated jobs, and 4 concurrent execution slots per root task. New jobs snapshot runtime limits; child jobs inherit them. Settings saves use revisions to reject conflicting edits.

Bots receive shared skills automatically and select MCP connectors, and can use workspace or readonly mode. Deny rules override ask and allow rules; readonly cannot be overridden by an allow. Delegated work and routines it creates retain ancestor restrictions. Task-scoped remembered approvals precede ordinary ask rules; dangerous-command checks and denies take precedence. New tasks do not inherit old grants. See [approval modes and Bash](docs/approval-modes.md).

Templates copy a Bot's role, avatar, model, connector selections, and permissions into a new Bot. They do not copy credentials, conversations, memories, or running work, and editing a template does not change existing Bots. The saved language preference applies to localized interface text; messages and tool evidence are not translated, and complete interface translation is not claimed.

Data lives in `.apsis-v4/`: SQLite stores Bots, jobs, approvals, schedules, and event records; conversation SQLite stores paged history and checkpoints; schema 4 JSON stores projects, memories and private skills; run journals are separate files. Restart marks unfinished work interrupted and never replays external actions automatically. Back up `.apsis-v4/` while the app is stopped.

See [Bot workspace](docs/bot-workspace.md) for the user flow, [settings platform](docs/settings-platform.md) for settings details, and [architecture](docs/architecture.md) for implementation boundaries.

## Verify

```sh
npm run build
npm test
npm run test:bots:browser
node scripts/verify-settings.ts
```

The browser tests use isolated deterministic model fixtures. Run the settings verifier after a build; its report and screenshots go to `artifacts/settings-verification/`. These checks do not certify live provider credentials or complete translation coverage. `npm run test:bots:ollama` optionally checks real local-model delegation; model behavior can vary.
