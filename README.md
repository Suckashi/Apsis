# Apsis

**English** | [繁體中文](README.zh-TW.md)

A local-first personal AI workspace with a Web interface and a Telegram bot. Apsis uses **TypeScript and Node.js**, selectable Pi, Deep Agents and OpenAI Agents SDK runtimes, and a local memory architecture inspired by Hermes Agent.

Start development with `npm run dev`. Python, Docker, Redis, and a separate database server are not required. Ollama is optional for local models; cloud APIs can be used instead.

## What Apsis does

Ordinary conversation works without creating an agent or granting writes. The default runtime embeds `@earendil-works/pi-coding-agent` 0.87.0 for sessions, context compaction, precise edits and cancellable shell tools. Existing conversations can continue.

Enable file writes for precise `edit_file` replacements. **Allow commands (允許執行命令)** in task options also enables file writes. Commands use PowerShell on Windows and Bash elsewhere, starting in the workspace but able to access the host outside it. Shell is off by default and unavailable to Telegram; commands default to 60 seconds (120 maximum) and stop with the task. Custom agents must also select the shell tool; existing conversation snapshots retain their tools. Apsis supplies the SDK's tools, credentials and resources without loading global Pi configuration or extensions.

- Create custom agents with separate instructions, model choices, tools, skills and private or shared memory; chat through Web or resume through paired Telegram.
- Stream model replies and show expandable tool activity in Web conversations.
- Read workspace files, and optionally modify files or save knowledge with write permission.
- Keep durable memories, load reusable skills on demand, and search previous conversations.
- Keep several model providers and models configured at once, then choose one for a conversation or agent.
- Use a compact messenger interface with dark, light, and system themes, mobile navigation, searchable history, Markdown, and code copying.

The Web layout follows [xAI's Grok Bot design reference](https://x.ai/news/designing-grok-bot), while retaining Apsis's identity and capabilities. The Web interface supports Traditional Chinese and English. In **Settings → General → Interface language**, choose your language. Switching reloads the page and remembers your preference in this browser; chat drafts are retained. Saved conversations, project names, code and tool output keep their original text. Task permissions reset after reload as usual. This repository also provides documentation in both languages.

## Architecture and responsibilities

| Component                         | Responsibility                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `@earendil-works/pi-ai`           | Model providers, model abstraction, and streamed model responses.                            |
| `@earendil-works/pi-agent-core`   | The agent loop: ask the model, execute tools, return tool results, and continue.             |
| `@earendil-works/pi-coding-agent` | Pi sessions, context compaction, precise edits and cancellable shell tools.                  |
| Apsis                             | Web and Telegram interfaces, task lifecycle, permissions, local storage, memory, and skills. |
| Hermes Agent                      | A reference for memory handling and on-demand skills, implemented locally in TypeScript.     |

All three Pi packages are pinned to `0.87.0`. Pi remains the default runtime; custom agents can also use `deepagents` or `@openai/agents`. Engine adapters share Apsis's tools, permissions and long-term memory. Apsis neither installs Hermes Agent nor connects to a Hermes Gateway. The memory implementation follows selected architectural ideas; it is not a complete port of Hermes.

```text
Web browser ── HTTP / run polling ──┐
Telegram ─── long polling ────┤
                              ▼
                      Shared task service
                       ├─ history, progress, cancellation
                       ├─ memories + skill index
                       ├─ agent snapshot → Pi / Deep Agents / OpenAI SDK → model
                       ├─ permission-gated local tools
                       └─ atomic JSON storage
```

## Quick start

Requires **Node.js 22.19 or later** and npm.

```sh
git clone https://github.com/Suckashi/Apsis.git
cd Apsis
npm ci
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

Click the **Settings** gear, open **Model connections (模型連線)** in the dialog, choose a provider, enter its credential and one or more model IDs, and save. Set a default connection and model for ordinary Apsis conversations; you can also choose a model in the chat composer before starting a conversation. Changes apply without restarting. If no model is configured, the home screen guides you to add a service. Demo mode is no longer part of everyday controls; existing demo conversations remain available.

Development starts the server and browser build together. Browser assets are rebuilt on changes, and the backend restarts automatically. Refresh the browser after frontend changes.

## Creating agents

Open **Settings → My Agents (我的 Agents) → Create Agent (建立 Agent)**. Start from a research, code-reading or writing template, then configure instructions, a named connection, model ID, tools, skills and memory scope. Engine selection lives under Advanced settings. Save, then select **Start conversation (開始對話)** to try it. Switch agents from the sidebar.

| Engine            | Model connections                                | Runtime behavior                                                                         |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Pi                | OpenAI, Anthropic, Ollama, custom compatible API | Existing Apsis loop and tools                                                            |
| Deep Agents       | OpenAI, Anthropic, Ollama, custom compatible API | Planning, internal subagents, virtual scratch files and framework summarization          |
| OpenAI Agents SDK | OpenAI, Ollama, custom compatible API            | SDK agent loop; OpenAI uses Responses, others use Chat Completions; SDK tracing disabled |

All engines run in Node.js. No Python service, LangSmith deployment, or database server is required. Dependencies increase, but engine modules load on demand. Models must support tools and streaming. Each agent selects a named model connection and one of its model IDs. Connections have independent URLs and credentials. Web and Telegram share the same model connection manager.

Private memory and history retrieval are scoped to the agent. Shared agents use Apsis's shared memories and shared-conversation search. Agents see selected shared skills and skills they create themselves. Workspace files remain shared; the owner can inspect all knowledge in the management UI. This is not multi-user isolation.

Memory scope is fixed after creation. Edits affect new conversations only; existing conversations retain a configuration snapshot. Archiving preserves memory and existing conversations. Telegram `/new` uses default Apsis; `/resume` retains a custom conversation's agent.

Deep Agents' built-in filesystem uses conversation-local virtual state, never the host filesystem. Real files use `workspace_list_files`, `workspace_read_file`, and `workspace_write_file`, with Apsis's permissions. Virtual notes and todos persist on successful completion. Real writes and long-term knowledge require both tool selection and per-task write permission. The virtual filesystem has no shell backend; the separately granted shared shell tool runs on the host.

There is no visual handoff/workflow editor or cross-engine delegation yet. OpenAI SDK handoffs are not configured by the UI. Deep Agents can delegate internally with inherited tools.

In **Model connections**, choose a service first, configure its endpoint and credential, then add the exact model IDs available from that service. Choose a default model for the connection. The agent editor groups available connections by provider; select a connection and model for that agent. Multiple compatible endpoints coexist without replacing old settings. Changing the provider or URL clears the old key. Connections referenced by agents or existing conversations cannot be archived.

## Background tasks and operation history

**Projects:** choose a project above the composer, or use **加入專案** to register an existing absolute directory on the computer running Apsis. Each new conversation snapshots that directory; file tools, Shell and the file panel use it. Existing conversations without a project keep the default workspace. Use **另開專案對話** to change projects. A moved or missing directory fails closed instead of silently creating another folder. Project selection is not filesystem isolation for Shell; conversations sharing a project still share its files.

**Results:** expand **查看操作結果** below a reply or operation history in Task history. New runs retain bounded tool output, unified patches for `write_file` / `edit_file`, and Shell commands and exit codes (including partial output on failure or cancellation). Each output/patch/command keeps up to 24,000 characters and marks truncation. Shell-driven file changes do not get automatic diffs. Older runs remain readable but cannot recover output that was never stored. “回合結束” means execution ended, not that every requested check passed.

**Continuation:** **檢查並接續** prepares an editable message; review current permissions and send it. Any next message after failure, cancellation or restart receives a bounded, same-conversation journal excerpt from attempts since the latest completed run (up to eight attempts / 16,000 characters). All three engines are instructed to inspect current state before repeating actions. No commands are replayed automatically; successful native state remains the continuation baseline. This supplies evidence to the model, not a guarantee that it will correctly complete every remaining step.

Tasks belong to the server. After sending, switch conversations or open settings directly; closing the tab or losing the network does not cancel a task. **Task history (任務紀錄)** shows status, output, tool names, targets, operation outcomes and provider-reported token usage, with 50 runs per page. Stop an active run or open its conversation from its card.

The server and computer must remain running. Restart marks unfinished runs interrupted and started-but-unconfirmed operations unknown, without automatic replay. A new message creates a new run; inspect previous side effects first. Deep Agents usage covers available main-flow message statistics, not a complete subagent bill. No estimated prices are shown.

## Model connections

The provider-first setup offers OpenAI, Anthropic, Ollama, and OpenAI-compatible presets for Kimi, DeepSeek, OpenRouter, and Qwen, plus a custom endpoint. A preset supplies connection details; it does not add a new native protocol. Each saved connection can list several model IDs, with one default model. The composer chooses a configured connection and model for a new ordinary Apsis conversation. Custom agents select their own connection and model. Existing conversations keep their selected model when resumed.

| Service                          | Configuration                                                      | Transport                                    |
| -------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| OpenAI                           | Model IDs and an OpenAI API key                                    | Pi's OpenAI provider                         |
| Anthropic                        | Model IDs and an Anthropic API key                                 | Pi's Anthropic provider                      |
| Ollama                           | A loopback HTTP URL and installed model IDs                        | OpenAI-compatible Chat Completions           |
| Kimi, DeepSeek, OpenRouter, Qwen | Preset base URL, exact model IDs, and service API key              | OpenAI-compatible Chat Completions           |
| Custom OpenAI-compatible API     | Base URL, model IDs, and optional key for unauthenticated services | Chat Completions with SSE and function tools |

### OpenAI and Anthropic

Choose OpenAI or Anthropic in **Model connections**, enter its API key, add the model IDs you want to use, and save. Their credentials are stored independently. The connection's default model is used when that connection is chosen without another model selection.

Configured means values are present. **Model connections → Test model** verifies streaming, tool execution and returning the tool result through the selected engine and model. Cloud tests may incur charges. Tests use isolated state without workspace or saved knowledge access. Results apply only to that model/engine combination; editing clears previous results.

### Local Ollama

1. Start your existing Ollama installation.
2. Select **Ollama (local)** in Model connections.
3. Enter `http://127.0.0.1:11434`, or your local Ollama port.
4. Use **Load local models (讀取本機模型)**, add the models you want to use, choose a default, and save.

Apsis does not install Ollama or download models. This connector accepts loopback HTTP addresses only and filters cloud models from discovery. API keys are not required. `qwen3.5:9b` has been used for local integration testing.

The Pi adapter requests thinking off and up to 2,048 output tokens. Its context metadata is 8,192 tokens; the actual context configuration is controlled by Ollama. The other adapters request up to 4,096 output tokens and also disable Ollama reasoning via `reasoning_effort: none`.

### Custom OpenAI-compatible API

Choose a preset for Kimi, DeepSeek, OpenRouter, or Qwen, or choose **Custom service (自訂服務)**, and enter:

- **Base URL:** the service's complete API base path, such as `https://api.example.com/v1`, `https://gateway.example.com/api/v1`, or `http://127.0.0.1:1234/v1`.
- **Models:** the exact model IDs supplied by the service; choose one as the connection's default. You can type an ID that is not in the suggestions.
- **API key:** the key for that endpoint. Leave it empty only when the service requires no authentication.

Apsis appends `/chat/completions`. A pasted full Chat Completions URL is also normalized. The service and model must support SSE streaming and function tools. Responses-only and Azure-specific protocols are not implemented by this connector.

The custom endpoint has its own credential. Leaving the key empty preserves it at the same URL. Changing the URL without supplying a replacement clears the previous key. For an unauthenticated service, the SDK sends a non-secret placeholder.

The adapter supports text input and requests up to 4,096 output tokens. Its context metadata is 32,768 tokens and does not configure the server's actual context window.

### Settings and environment variables

Saved named connections apply to new Web conversations and agents. The selected connection and model belong to the conversation, so resuming an existing conversation keeps its choice. An already-running task keeps its settings snapshot. Keys are never returned by the configuration APIs or repopulated into password fields. To remove one, select the explicit key-removal option and save.

Named connections and their credentials are stored in `.loom/connections.json`. Configured legacy services are imported from `.loom/settings.json` (which takes precedence over environment values), keeping their IDs and binding existing conversations and agents. Edit imported credentials and endpoints in Model connections. Restarting does not overwrite edits or revive archived services. The UI does not edit `.env`; environment values initialize services that have not yet been imported and require a restart.

See [.env.example](.env.example) for configuration examples:

| Variable                                     | Purpose                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `PI_PROVIDER`                                | `openai`, `anthropic`, `ollama`, or `openai-compatible`          |
| `PI_MODEL`                                   | Model ID                                                         |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`       | Official provider credentials                                    |
| `OLLAMA_URL`                                 | Local Ollama URL                                                 |
| `COMPATIBLE_BASE_URL` / `COMPATIBLE_API_KEY` | Custom API connection                                            |
| `PORT` / `SHARE_PORT`                        | Application port, default 3100; sharing proxy port, default 3102 |

## Using the Web interface

- The **Settings** gear opens one dialog with sections for model connections, agents, memory, skills, and Telegram. Switch sections inside the dialog; **Task history (任務紀錄)** remains a separate view.
- The **＋** beside Apsis opens a new topic. It keeps saved memories and skills and creates a conversation when the first message is sent.
- The **＋** inside the input opens task options. File, memory and skill writes have independent switches, all off by default.
- The composer model picker selects a configured connection and model before the first message in a new ordinary Apsis conversation. Agent conversations use the model saved with that agent.
- Switch agents from the sidebar. Model diagnostics are inside each service’s Advanced section; knowledge editing, merging and revisions are inside each entry’s Manage menu.
- **Ctrl/Cmd + K** searches conversation titles and opens quick navigation. **Conversation history (對話紀錄)** expands the saved list.
- On desktop, Enter sends and Shift+Enter adds a line. On mobile, Enter adds a line; use the send button or Ctrl/Cmd+Enter to send. IME confirmation does not submit.
- Tool activity can be expanded while a task runs. Stop controls cancel the current local task.
- Replies render Markdown, tables, and code blocks. Code copying preserves whitespace. Use **Export Markdown (匯出 Markdown)** in the conversation menu to download visible messages.
- Drafts are saved per conversation in this browser. After submission, connection failures direct you to task history; prompts are never automatically resubmitted.
- Scrolling up preserves your reading position; **Latest messages (最新訊息)** resumes following the output.
- The top file button opens workspace files in a side panel on desktop or a drawer on mobile.

Raw HTML in replies is not executed. Unsafe link schemes are blocked, and referenced images are not loaded automatically.

## Telegram

1. Create a dedicated bot with [Telegram's BotFather](https://t.me/BotFather).
2. In **Settings → Telegram**, enter the token, enable the bot, and save.
3. Once connected, generate a pairing code and privately send the displayed `/pair …` command to your bot. Codes expire after ten minutes and can be used once.
4. Send a task. Its conversation appears in Web history, where you can inspect progress, stop it, or continue chatting.

The bot uses Apsis's default model selected in **Model connections** for new conversations and shares Apsis's workspace, memories, and skills. Web conversations can also be resumed in a private bot chat using the conversation menu's Telegram resume command; resumed conversations retain their selected connection and model.

Supported commands: `/help`, `/new`, `/stop`, `/status`, and `/resume <conversation-id>` in private chats.

Telegram uses outbound long polling and needs no public URL or tunnel. `npm run dev` starts an enabled bot alongside the Web server. Your computer and model must remain running. Existing webhooks or another polling process produce a visible conflict; Apsis does not remove another application's webhook.

Only one paired owner is supported. Unpaired users and unrelated group traffic are ignored. Unpairing or changing the token removes account bindings without deleting conversation history. Write permission for Telegram tasks is configured separately and defaults to off.

Groups are opt-in. After pairing, send `/where@YourBotUsername` in the target group and save its negative group ID. Only the owner's mentions or replies in that group trigger tasks. Replies return to the group and original topic and can include workspace information. Each chat/topic has a separate conversation, while memories and skills remain shared.

Telegram currently accepts text and sends completed plain-text replies. Voice, images, and attachments are not supported. Update offsets are recorded before execution to avoid repeating writes after a crash; interrupted work and failed delivery are not automatically retried. Saved results remain available in Web history.

## Remote preview

Ordinary development uses `npm run dev`. For optional remote access, install [Cloudflare's cloudflared client](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) and run:

```sh
npm run dev:share
```

On Windows, the project also detects the official executable at `.tools/cloudflared.exe`. This binary is not committed and is unnecessary for local development.

The command reuses an existing Apsis server or starts one, then creates a password-protected proxy and a temporary Cloudflare URL. It prints the URL and random password and saves them in Git-ignored `.loom/share-connection.json`. Do not commit or share that file publicly.

Remote login grants **full owner access**, including model settings, conversations, and task execution. All application pages and APIs require authentication. Sessions use an HttpOnly, Secure, SameSite cookie and expire after eight hours; remote logout ends the session. The proxy checks the assigned hostname and request origin and limits failed logins. The Web UI polls progress and reply text by run ID; the legacy NDJSON API remains available.

This uses Apsis's password authentication. A fixed domain and Cloudflare Access are separate setup work and are not provided by this command. Cloudflare carries the remote traffic; your computer must stay awake and online.

Ctrl+C closes sharing. An existing development server stays running; one started by the sharing command stops with it. Restarting sharing replaces the URL, password, and sessions.

## Memory, skills, and local data

| Knowledge            | Current behavior                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Durable memory       | Inject complete entries into each task's system context, within a 16,000-character budget.                      |
| Reusable skills      | Include up to 50 index entries with 120-character descriptions; load the full procedure with tools when needed. |
| Conversation history | Search completed messages with case-insensitive substring matching and return up to ten bounded excerpts.       |

Available tools: `list_files`, `read_file`, `write_file`, `remember`, `update_memory`, `save_skill`, `list_skills`, `read_skill`, and `search_history`.

The model saves knowledge only with the corresponding permission. Same-scope facts are deduplicated using normalized text and ranked lexically against the current prompt, including CJK bigrams, before applying the 16,000-character budget. This is not vector retrieval or semantic deduplication. The management UI supports editing, disabling, deleting and merging same-scope items, up to 20 content revisions, and links to source conversations for agent-saved knowledge. Disabled/merged entries are excluded from context. Skills remain on-demand; no background learning worker runs.

| Location                 | Contents                                                                      |
| ------------------------ | ----------------------------------------------------------------------------- |
| `.loom/state.json`       | Agent definitions, conversation snapshots, engine state, memories, and skills |
| `.loom/settings.json`    | Legacy configuration retained for compatibility                               |
| `.loom/connections.json` | Named providers, model IDs, defaults, and their credentials                   |
| `.loom/telegram.json`    | Bot token, owner pairing, conversation bindings, and update offset            |
| `workspace/`             | Files accessible to the agent's file tools                                    |

Local data is created on demand and ignored by Git. Settings and tokens are stored as local plaintext; configuration APIs do not expose the secrets. Files use mode 0600 where supported. Conversation writes are serialized and use atomic JSON replacement within one server process.

Storage schema version 1 is validated on load and save. Migration preserves `state.pre-v1.json`; later writes retain the previous `state.json.bak`. Invalid data stops loading without replacing the original. Runs are stored separately in `.loom/runs/<id>.json`; named credentials live in `.loom/connections.json`. The Telegram settings page offers a conversation/agent/knowledge snapshot, excluding connection keys and run files. For a full backup, stop the server and copy `.loom/` and `workspace/`. Restore while stopped, keeping a copy of the current data; there is no automatic restore UI.

Single-process JSON storage remains to preserve simple startup. Run journals are separate and streamed tokens do not rewrite conversation state. Large histories and multiple writers are reasons to migrate to SQLite later; SQLite is not implemented now. See [architecture notes](docs/architecture.md).

Older Hermes/hybrid conversations migrate to Pi mode while preserving their IDs, messages, and Pi transcripts. Retired gateway settings are ignored and removed from the settings file on the next save.

## Current scope and limits

- One local owner and one Telegram bot, with multiple custom agents; no multi-user isolation or hosted computers.
- The server binds to `127.0.0.1`, checks Host/Origin, requires a custom header for API mutations, and sets a restrictive Content Security Policy. Use the authenticated sharing proxy for remote access.
- File tools stay inside `workspace/`, reject hidden paths, traversal, and symlinks, and limit file content to 256,000 bytes. The separately granted shell tool runs on the host and is not confined to the workspace.
- Each task is limited to five minutes. Pi and OpenAI SDK allow twelve turns; Deep Agents has a 48-step graph recursion limit. Interrupted tasks are marked failed on restart rather than resumed automatically.
- Pi coding-agent automatically compacts context and persists session entries in Apsis storage. OpenAI SDK conversations are not automatically compacted. Deep Agents provides framework summarization; model-specific context tuning remains future work.
- The JSON store loads all state and rewrites it on each mutation. Use one server process per data directory.
- Scheduling, browser/computer control, MCP management, and media input are not implemented.

## Completed improvements and next steps

This iteration adds server-owned background runs, operation journals, named connections and capability probes, separate write permissions, knowledge provenance/revisions/merge/disable, agent navigation/templates, and validated versioned storage with backups.

Further work includes token-aware budgets and summarization across engines, vector retrieval, indexing/pagination for large conversation histories, and multi-user isolation. Side-effectful task replay and cross-engine workflows remain unimplemented.

## Development and verification

`npm run test:agents:ollama` tests real workspace reads and continuation with all three engines using isolated temporary data. It accepts `OLLAMA_MODEL` and `OLLAMA_URL`. Local Qwen successfully called file tools through all engines, but live runs also produced malformed tool calls, refusals and incorrect claims about missing history. Deterministic SDK tests confirm the history is sent; model behavior is not guaranteed. The smoke test reports failures without silently retrying.

Agent tests also cover CRUD validation, configuration snapshots, archive preservation, memory/skill isolation and real SDK HTTP streaming and continuation for all three engines.

| Command                | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `npm run dev`          | Type-check, watch browser assets, and run the server with restart-on-change |
| `npm start`            | Build and start without file watching                                       |
| `npm run check`        | Strict TypeScript checks                                                    |
| `npm run build`        | Type-check and compile browser assets into `dist/public/`                   |
| `npm test`             | Automated tests without paid API calls                                      |
| `npm run test:ollama`  | Optional real-model integration test                                        |
| `npm run format:check` | Check repository formatting                                                 |
| `npm run dev:share`    | Start optional password-protected remote sharing                            |

The automated suite exercises the real Pi SDK with deterministic model transports, custom API streaming and tool calls, memory injection, history, permissions, migration, cancellation, settings, sharing authentication, and Telegram pairing and delivery behavior. It uses an injected Telegram transport rather than a live account.

`npm run test:ollama` requires a running local model. It uses an isolated temporary workspace to verify actual file-tool execution, streaming, and conversation recall. It defaults to `qwen3.5:9b`; override with `OLLAMA_MODEL` and `OLLAMA_URL`. It does not use existing Apsis data or cloud credentials.

A [GitHub Actions template](docs/github-actions.yml.example) covers Windows/Linux and Node 22/24. It is a template, not an enabled workflow; copy it to `.github/workflows/ci.yml` to enable it with an appropriately authorized GitHub credential.

### Source layout

```text
public/                Browser TypeScript, HTML, and CSS
server/agent.ts         Pi runtime integration and engine dispatch
server/runtime.ts       Engine-neutral run/tool contracts
server/tools.ts         Shared permission-gated tools
server/runs.ts          Durable per-run journals
server/connections.ts   Named connection credentials
server/probe.ts         Isolated model capability checks
server/agents.ts        Agent validation and memory/skill scope
server/engines/         Deep Agents and OpenAI SDK adapters
server/context.ts      Memory and on-demand skill context
server/tasks.ts        Shared task lifecycle
server/app.ts          HTTP API and streaming
server/settings.ts     Model configuration and credentials
server/compatible.ts   Custom Chat Completions adapter
server/ollama.ts       Local Ollama adapter and discovery
server/telegram.ts     Telegram transport and owner pairing
server/share-gateway.ts Password-protected remote proxy
server/store.ts        Local state persistence
server/workspace.ts    Restricted file operations
shared/                Shared types and conversation export
scripts/               Build, development, sharing, and real-model checks
test/                  Node test runner suites
```

To add a tool, define it in `createTools()` in `server/tools.ts`, provide a schema, and return structured tool content. Apply the existing write-permission gate to mutations. Keep provider credentials and integrations server-side.

## Upstream projects

- [Pi](https://github.com/earendil-works/pi): agent runtime and model abstraction.
- [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview): planning-oriented JavaScript agent framework.
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/): TypeScript agent runtime.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent): reference for memory and skill architecture.

Apsis is an independent project and is not affiliated with the upstream projects.
