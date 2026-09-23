# Talaria

**English** | [繁體中文](README.zh-TW.md)

A local-first personal AI assistant with a Web interface and a Telegram bot. Talaria uses **TypeScript and Node.js**, with Pi as its agent runtime and a local memory architecture inspired by Hermes Agent.

Start development with `npm run dev`. Python, Docker, Redis, and a separate database server are not required. Ollama is optional for local models; cloud APIs can be used instead.

## What Talaria does

- Chat with one persistent assistant through the Web or a paired Telegram account.
- Stream model replies and show expandable tool activity in Web conversations.
- Read workspace files, and optionally modify files or save knowledge with write permission.
- Keep durable memories, load reusable skills on demand, and search previous conversations.
- Connect OpenAI, Anthropic, local Ollama, or a custom OpenAI-compatible API.
- Use a compact messenger interface with dark, light, and system themes, mobile navigation, searchable history, Markdown, and code copying.

The Web layout follows [xAI's Grok Bot design reference](https://x.ai/news/designing-grok-bot), while retaining Talaria's identity and capabilities. The application UI currently uses Traditional Chinese; this repository provides documentation in both languages.

## Architecture and responsibilities

| Component                       | Responsibility                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `@earendil-works/pi-ai`         | Model providers, model abstraction, and streamed model responses.                            |
| `@earendil-works/pi-agent-core` | The agent loop: ask the model, execute tools, return tool results, and continue.             |
| Talaria                         | Web and Telegram interfaces, task lifecycle, permissions, local storage, memory, and skills. |
| Hermes Agent                    | A reference for memory handling and on-demand skills, implemented locally in TypeScript.     |

Both Pi packages are pinned to `0.87.0`. Pi is the only live agent runtime. Talaria neither installs Hermes Agent nor connects to a Hermes Gateway. The current memory implementation follows selected architectural ideas; it is not a complete port of Hermes.

```text
Web browser ── HTTP / NDJSON ──┐
Telegram ─── long polling ────┤
                              ▼
                      Shared task service
                       ├─ history, progress, cancellation
                       ├─ memories + skill index
                       ├─ pi-agent-core → pi-ai → model
                       ├─ permission-gated local tools
                       └─ atomic JSON storage
```

## Quick start

Requires **Node.js 22.19 or later** and npm.

```sh
git clone https://github.com/Suckashi/Talaria.git
cd Talaria
npm ci
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

In **Bot settings (Bot 設定)**, connect a model and save. The next task uses the new settings without restarting. If no model is configured, select **Demo mode (示範模式)** under the input's **Task options (任務選項)** to try scripted streaming responses without an API call.

Development starts the server and browser build together. Browser assets are rebuilt on changes, and the backend restarts automatically. Refresh the browser after frontend changes.

## Model connections

| Service                      | Configuration                                                        | Transport                                    |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| OpenAI                       | A supported model ID and an OpenAI API key                           | Pi's OpenAI provider                         |
| Anthropic                    | A supported model ID and an Anthropic API key                        | Pi's Anthropic provider                      |
| Ollama                       | A loopback HTTP URL and an installed model                           | OpenAI-compatible Chat Completions           |
| Custom OpenAI-compatible API | Base URL, model ID, and an optional key for unauthenticated services | Chat Completions with SSE and function tools |

### OpenAI and Anthropic

Select the service in **Bot settings**, choose a model from the supported suggestions, enter its API key, and save. Their credentials are stored independently.

Configuration status means the settings are present; it does not prove successful authentication or generation. A chat task exercises the actual model connection.

### Local Ollama

1. Start your existing Ollama installation.
2. Select **Ollama (local)** in Bot settings.
3. Enter `http://127.0.0.1:11434`, or your local Ollama port.
4. Use **Load installed models (讀取已安裝模型)**, select a model with tool support, and save.

Talaria does not install Ollama or download models. This connector accepts loopback HTTP addresses only and filters cloud models from discovery. API keys are not required. `qwen3.5:9b` has been used for local integration testing.

The adapter requests thinking off and up to 2,048 output tokens. Its context metadata is 8,192 tokens; the actual context configuration is controlled by Ollama.

### Custom OpenAI-compatible API

Choose **OpenAI-compatible API — custom (OpenAI 相容 API（自訂）)** and enter:

- **Base URL:** the service's complete API base path, such as `https://api.example.com/v1`, `https://gateway.example.com/api/v1`, or `http://127.0.0.1:1234/v1`.
- **Model:** the exact model ID supplied by the service. Custom names are accepted.
- **API key:** the key for that endpoint. Leave it empty only when the service requires no authentication.

Talaria appends `/chat/completions`. A pasted full Chat Completions URL is also normalized. The service and model must support SSE streaming and function tools. Responses-only and Azure-specific protocols are not implemented by this connector.

The custom endpoint has its own credential. Leaving the key empty preserves it at the same URL. Changing the URL without supplying a replacement clears the previous key. For an unauthenticated service, the SDK sends a non-secret placeholder.

The adapter supports text input and requests up to 4,096 output tokens. Its context metadata is 32,768 tokens and does not configure the server's actual context window.

### Settings and environment variables

Saved settings apply to the next Web or Telegram task; an already-running task keeps its settings snapshot. Keys are never returned by the settings API or repopulated into password fields. To remove one, select the explicit key-removal option and save.

UI settings are stored in `.loom/settings.json` and take precedence over environment values. Removing a key also masks the environment fallback. The UI does not edit `.env`; restart the server after changing environment variables manually.

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

- The **＋** beside Talaria opens a new topic. It keeps saved memories and skills and creates a conversation when the first message is sent.
- The **＋** inside the input opens task options. File writes and saving memories or skills require **Allow modifications and saving (允許修改與保存)**.
- **Ctrl/Cmd + K** searches conversation titles and opens quick navigation. **Conversation history (對話紀錄)** expands the saved list.
- On desktop, Enter sends and Shift+Enter adds a line. On mobile, Enter adds a line; use the send button or Ctrl/Cmd+Enter to send. IME confirmation does not submit.
- Tool activity can be expanded while a task runs. Stop controls cancel the current local task.
- Replies render Markdown, tables, and code blocks. Code copying preserves whitespace. Use **Export Markdown (匯出 Markdown)** in the conversation menu to download visible messages.
- Drafts are saved per conversation in this browser. Failed tasks restore the prompt for editing without automatic resubmission.
- Scrolling up preserves your reading position; **Latest messages (最新訊息)** resumes following the output.
- The workspace panel opens alongside chat on wide desktops and as a drawer on mobile.

Raw HTML in replies is not executed. Unsafe link schemes are blocked, and referenced images are not loaded automatically.

## Telegram

1. Create a dedicated bot with [Telegram's BotFather](https://t.me/BotFather).
2. In **Bot settings → Telegram Bot**, enter the token, enable the bot, and save.
3. Once connected, generate a pairing code and privately send the displayed `/pair …` command to your bot. Codes expire after ten minutes and can be used once.
4. Send a task. Its conversation appears in Web history, where you can inspect progress, stop it, or continue chatting.

The bot shares Talaria's configured model, workspace, memories, and skills. Web conversations can also be resumed in a private bot chat using the conversation menu's Telegram resume command.

Supported commands: `/help`, `/new`, `/stop`, `/status`, and `/resume <conversation-id>` in private chats.

Telegram uses outbound long polling and needs no public URL or tunnel. `npm run dev` starts an enabled bot alongside the Web server. Your computer and model must remain running. Existing webhooks or another polling process produce a visible conflict; Talaria does not remove another application's webhook.

Only one paired owner is supported. Unpaired users and unrelated group traffic are ignored. Unpairing or changing the token removes account bindings without deleting conversation history. Write permission for Telegram tasks is configured separately and defaults to off.

Groups are opt-in. After pairing, send `/where@YourBotUsername` in the target group and save its negative group ID. Only the owner's mentions or replies in that group trigger tasks. Replies return to the group and original topic and can include workspace information. Each chat/topic has a separate conversation, while memories and skills remain shared.

Telegram currently accepts text and sends completed plain-text replies. Voice, images, and attachments are not supported. Update offsets are recorded before execution to avoid repeating writes after a crash; interrupted work and failed delivery are not automatically retried. Saved results remain available in Web history.

## Remote preview

Ordinary development uses `npm run dev`. For optional remote access, install [Cloudflare's cloudflared client](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) and run:

```sh
npm run dev:share
```

On Windows, the project also detects the official executable at `.tools/cloudflared.exe`. This binary is not committed and is unnecessary for local development.

The command reuses an existing Talaria server or starts one, then creates a password-protected proxy and a temporary Cloudflare URL. It prints the URL and random password and saves them in Git-ignored `.loom/share-connection.json`. Do not commit or share that file publicly.

Remote login grants **full owner access**, including model settings, conversations, and task execution. All application pages and APIs require authentication. Sessions use an HttpOnly, Secure, SameSite cookie and expire after eight hours; remote logout ends the session. The proxy checks the assigned hostname and request origin and limits failed logins. Model streaming reaches the browser through fetch and NDJSON.

This uses Talaria's password authentication. A fixed domain and Cloudflare Access are separate setup work and are not provided by this command. Cloudflare carries the remote traffic; your computer must stay awake and online.

Ctrl+C closes sharing. An existing development server stays running; one started by the sharing command stops with it. Restarting sharing replaces the URL, password, and sessions.

## Memory, skills, and local data

| Knowledge            | Current behavior                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Durable memory       | Inject complete entries into each task's system context, within a 16,000-character budget.                      |
| Reusable skills      | Include up to 50 index entries with 120-character descriptions; load the full procedure with tools when needed. |
| Conversation history | Search completed messages with case-insensitive substring matching and return up to ten bounded excerpts.       |

Available tools: `list_files`, `read_file`, `write_file`, `remember`, `update_memory`, `save_skill`, `list_skills`, `read_skill`, and `search_history`.

The model decides when to save knowledge, subject to write permission. There is no background learning worker, automatic memory deduplication, or relevance ranking. Memory entries that do not fit the prompt budget are skipped in stored order. Skill descriptions are text prefixes, not generated summaries.

| Location              | Contents                                                           |
| --------------------- | ------------------------------------------------------------------ |
| `.loom/state.json`    | Conversations, Pi transcripts, memories, and skills                |
| `.loom/settings.json` | Model configuration and API credentials                            |
| `.loom/telegram.json` | Bot token, owner pairing, conversation bindings, and update offset |
| `workspace/`          | Files accessible to the agent's file tools                         |

Local data is created on demand and ignored by Git. Settings and tokens are stored as local plaintext; configuration APIs do not expose the secrets. Files use mode 0600 where supported. Conversation writes are serialized and use atomic JSON replacement within one server process.

Older Hermes/hybrid conversations migrate to Pi mode while preserving their IDs, messages, and Pi transcripts. Retired gateway settings are ignored and removed from the settings file on the next save.

## Current scope and limits

- One local owner and one bot; no multi-user isolation, multiple bot personas, or hosted computers.
- The server binds to `127.0.0.1`, checks Host/Origin, requires a custom header for API mutations, and sets a restrictive Content Security Policy. Use the authenticated sharing proxy for remote access.
- File tools stay inside `workspace/`, reject hidden paths, traversal, and symlinks, and limit file content to 256,000 bytes. They provide no terminal execution and are not an OS sandbox.
- Each task is limited to five minutes and twelve Pi model turns. Interrupted tasks are marked failed on restart rather than resumed automatically.
- Conversation context is not automatically compacted. Long conversations may require a new topic.
- The JSON store loads all state and rewrites it on each mutation. Use one server process per data directory.
- Scheduling, browser/computer control, MCP management, and media input are not implemented.

## Suggested improvement priorities

These are **proposals, not implemented features**, based on the current code.

| Priority | Improvement                                                                         | Why it matters                                                                                                  |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1        | Memory deduplication, source tracking, revision history, and retrieval by relevance | Reduce repeated or outdated facts and use the prompt budget for the task at hand.                               |
| 2        | Token-aware context budgets and conversation summarization                          | Keep longer conversations usable across models with different context limits.                                   |
| 3        | Connection testing and model capability controls                                    | Verify authentication, streaming, and tool support before a task; allow output/context limits to be configured. |
| 4        | Task checkpoints, clearer failure causes, and explicit resume/retry                 | Recover from interruptions while avoiding repeated file writes or other side effects.                           |
| 5        | Paginated history, storage validation, migrations, and backups                      | Keep growing local data responsive and easier to recover without complicating Node-based startup.               |

## Development and verification

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

`npm run test:ollama` requires a running local model. It uses an isolated temporary workspace to verify actual file-tool execution, streaming, and conversation recall. It defaults to `qwen3.5:9b`; override with `OLLAMA_MODEL` and `OLLAMA_URL`. It does not use existing Talaria data or cloud credentials.

A [GitHub Actions template](docs/github-actions.yml.example) covers Windows/Linux and Node 22/24. It is a template, not an enabled workflow; copy it to `.github/workflows/ci.yml` to enable it with an appropriately authorized GitHub credential.

### Source layout

```text
public/                Browser TypeScript, HTML, and CSS
server/agent.ts         Pi runtime integration and tools
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

To add a tool, define it in `createTools()` in `server/agent.ts`, provide a schema, and return structured tool content. Apply the existing write-permission gate to mutations. Keep provider credentials and integrations server-side.

## Upstream projects

- [Pi](https://github.com/earendil-works/pi): agent runtime and model abstraction.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent): reference for memory and skill architecture.

Talaria is an independent project and is not affiliated with either upstream.
