# Talaria

A local-first assistant with **Web and Telegram bot entry points**, powered by Pi's Node.js runtime and a TypeScript architecture inspired by Hermes' persistent memory, on-demand skills, and messaging adapters. No separate Hermes installation is required.

以 Node.js 啟動的 AI 夥伴。Web 介面、API、agent 編排與資料保存都使用 TypeScript；開發本專案不用安裝 Python、Docker、Redis 或資料庫。

The Web interface is organized around one persistent Talaria bot: conversations with inline, expandable work records; shared memories and skills; and an on-demand workspace panel. The mobile layout keeps messages and the composer in view, with history and settings behind the navigation menu. **開啟新話題** keeps saved memory and skills, and creates a conversation only when the first message is sent. Model selection and write permission live under **任務選項**; credentials and Telegram pairing live in **Bot 設定**. This is a single-bot, single-owner product; multiple bots, hosted computers and scheduled routines are not implemented.

The interface supports light, dark and system appearance, saved per browser. Use **Ctrl/Cmd + K** to find a conversation by title or jump to a feature. Desktop Enter sends; Shift+Enter adds a line. On mobile, Enter adds a line and the send button submits. Chinese IME confirmation does not submit. Code blocks have language labels and exact-text copy controls. Work records stay expanded while progress streams, and a lost connection preserves drafts and reconnects automatically. New topics use the configured model; demo mode remains available under **任務選項**.

## Quick start / 三個步驟

Requires **Node.js 22.19+** (Node 24 LTS recommended) and npm.

```sh
git clone https://github.com/Suckashi/Talaria.git
cd Talaria
npm ci
npm run dev
```

Open **http://localhost:3100**. With no API keys, select **示範模式** to try the interface. Demo responses are clearly labelled deterministic examples, not AI output.

- `npm run dev` — type-checks the project, builds and watches browser TypeScript with esbuild, and starts the Node server with automatic restart. Refresh the browser after frontend edits.
- `npm start` — builds the browser assets and starts without file watching.
- `npm test` — Node's built-in test runner; no paid API calls.
- `npm run check` — runs strict TypeScript checks.
- `npm run build` — checks types and compiles browser assets to `dist/public/`.
- `npm run dev` handles frontend compilation and backend startup together. Node.js 22.19+ executes server TypeScript natively.

## Remote preview with a password

Local development still uses `npm run dev`. Optional sharing uses:

```sh
npm run dev:share
```

Install [Cloudflare's official cloudflared client](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) first. On Windows, use `winget install --id Cloudflare.cloudflared --exact`, or put the official standalone executable at `.tools/cloudflared.exe`. The project detects that location without changing your system PATH. The executable is not committed to Git and is not required for ordinary development.

The share command reuses a running Talaria on `PORT` (default 3100), or starts the development server. It launches a separate password-protected gateway on loopback `SHARE_PORT` (default 3102), then connects a Quick Tunnel to that gateway. It never tunnels directly to the unprotected app or Ollama.

The terminal prints the random HTTPS URL and a newly generated 144-bit password. Both are also saved locally in the Git-ignored `.loom/share-connection.json`; keep that file private. Someone with both can log in and use the full workspace, including conversations, settings, agent runs, file-tool permissions and exports. This is **full owner access**, not a read-only preview. Cloudflare carries the remote traffic. This mode uses Talaria password authentication, **not Cloudflare Access**.

Remote login uses an HttpOnly, Secure, SameSite cookie, expires after eight hours and can be ended using **登出遠端**. Authentication is required for all app pages and APIs. The gateway validates the exact assigned hostname, validates request origins, limits failed login attempts and forwards a restricted header set to the local app. Changing a forwarded Host header does not bypass authentication.

Press Ctrl+C in the sharing terminal to close the tunnel and its gateway. A pre-existing local dev server stays running; a dev server started by the share command stops with it. Restarting sharing replaces the URL, password and all login sessions. Your computer must remain awake and online; Ollama must also be running for local-model tasks.

Quick Tunnels are intended for development, have no uptime guarantee, and do not support SSE. Talaria uses fetch with NDJSON instead. A live Quick Tunnel test verified password login/logout, anonymous and cross-origin rejection, Qwen replies, and incremental delivery (25 received chunks in a short demo run). For a permanent URL with Cloudflare Access, configure an owned domain and an Access policy separately. That deployment is not included in this temporary-sharing command.

## What works

| Mode                          | What runs                                                   | Configuration                        |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Demo / 示範                   | Local scripted streaming response                           | None                                 |
| Talaria                       | Pi SDK agent loop, memory, on-demand skills and local tools | OpenAI/Anthropic key or local Ollama |
| External Hermes collaboration | Optional legacy gateway delegation                          | Model + Hermes gateway               |
| External Hermes               | Optional legacy direct gateway conversation                 | Hermes gateway                       |

Talaria includes `list_files`, `read_file`, `write_file`, `remember`, `update_memory`, `save_skill`, `list_skills`, `read_skill`, and `search_history`. The shared task service handles execution, history, progress and cancellation for both Web and Telegram. Existing internal mode IDs (`pi`, `hybrid`, `hermes`) remain compatible with saved conversations. Advanced gateway settings are collapsed in the UI; they are not required for Talaria or Telegram.

## Telegram Bot / Web 與 bot 一起用

1. Create a dedicated bot with [Telegram's @BotFather](https://t.me/BotFather). Keep its token private; enter it in Talaria's **Bot 設定 → Telegram Bot**, not in a conversation.
2. Save the token with **啟用 Telegram Bot** checked. Talaria uses the model from **Talaria 模型**, including your local Ollama model.
3. Once the status is **已連線**, click **產生配對碼** and privately send the displayed `/pair …` command to your bot. It expires in ten minutes and is single use.
4. Send a task. Its conversation appears in Web history with a **Telegram** label; open it to see progress, stop the task, or continue chatting. **複製 Telegram 續聊指令** lets you resume a Web Talaria conversation in a private bot chat.

`npm run dev` starts the Web server, common task service and any enabled bot together. A bot without credentials stays disabled. Telegram uses the official [long-polling API](https://core.telegram.org/bots/api#getupdates), so it needs outbound Internet access but no public URL, webhook, or Cloudflare Tunnel. Your computer and model must stay running. Existing webhooks or a second polling process cause a visible error; Talaria never deletes another application's webhook automatically.

Commands: `/help`, `/new`, `/stop`, `/status`, `/resume <conversation-id>` (private chats only). The initial implementation supports text messages and returns completed replies as plain text, split into safe-sized messages. Web continues to render Markdown and shows live progress. It does not yet process voice, images, attachments, or X/Discord events.

Only one paired Telegram account can access this **single-owner workspace**. Unpaired users, bots, anonymous group senders and unrelated group traffic are ignored. Pairing authorizes access to the owner's workspace, conversations, memories and skills; it is not a separate tenant. Unpairing stops bot tasks and removes bindings without deleting conversation history. Changing the token also removes account pairing. Write permission is off by default and can be enabled separately for bot tasks in the Web settings.

Groups are off by default. After pairing, add your bot to a group, send `/where@YourBotUsername`, and save the returned negative group ID in Talaria. Only your own mentions/replies in that specified group trigger tasks. Replies go to the group (and original forum topic), and may contain private workspace or remembered information. Each chat/topic gets a separate conversation; owner memory and skills are shared. Telegram's [privacy mode](https://core.telegram.org/bots/features#privacy-mode) controls which group messages the platform delivers; address commands to your bot or reply to one of its messages.

Bot credentials, pairing identity, conversation bindings and consumed-update offset are saved atomically in Git-ignored `.loom/telegram.json` (local plaintext; mode 0600 on POSIX). Configuration reads never return the token. Pairing codes exist only in memory and expire on restart. Enabling a disabled bot or changing its token skips earlier queued messages. Consumed updates are recorded before execution to avoid automatically repeating writes after a crash; a crash can therefore interrupt/lose a reply, and failed deliveries are not automatically resent. Results remain available in Web once saved. Interrupted pending tasks are marked failed on restart and need manual retry.

The Web UI provides streamed Pi output, activity events, saved conversations, memory/skill creation and deletion, connection status, and stop control. Mode changes create a new conversation so histories from different engines do not mix.

## Everyday workspace experience

- New conversations include starter tasks and guidance for connecting a model. Selecting an unconfigured engine explains what is missing before a request is sent.
- Search saved conversations by title; mobile users can expand **最近的對話** to browse the same history.
- Unsent drafts are stored per conversation in this browser, and restored after switching conversations or refreshing. A failed task restores its prompt for editing; it is never retried automatically.
- Follow elapsed task time, copy individual messages, and download the current conversation as Markdown with **匯出對話**. Exports contain visible messages, not internal Pi transcripts or credentials.
- Agent replies render Markdown during streaming and when reopening conversations: headings, lists, quotes, links, code blocks, and tables. Copy preserves the original Markdown. Raw HTML is displayed as text, unsafe link schemes are rejected, and image references display their description without loading remote images.
- Reading earlier messages during streaming keeps your scroll position. Use **回到最新訊息** to resume following the response.
- Drafts use browser local storage; they are separate from server conversation history and are not shared between browsers. If browser storage is unavailable, the UI reports that drafts cannot be saved.

## Local Qwen / Ollama

Talaria can run real Pi conversations and tools against an existing local Ollama installation without a cloud API key. The app uses Ollama's [OpenAI-compatible Chat Completions API](https://docs.ollama.com/api/openai-compatibility); the rest of the development setup remains Node.js and TypeScript.

1. Start your installed Ollama application (or run `ollama serve`).
2. In **Bot 設定**, choose **Ollama（本機）** and keep `http://127.0.0.1:11434` unless you use a different local port.
3. Click **讀取已安裝模型**, choose an installed model such as `qwen3.5:9b`, then **儲存模型設定**.
4. Return to the workspace and select **Talaria**. Local tools keep the same per-run permissions; Telegram uses the same model with its own write-permission setting.

This does not download models or install Ollama. The connector accepts loopback HTTP addresses only. Model discovery filters cloud entries; use an installed local model with tool support. The UI hides cloud key fields for Ollama, and switching providers preserves existing cloud credentials. Saved status is configuration state; reading models verifies the server, and a task verifies generation. Initial model loading may take longer than subsequent replies.

The local adapter uses text input, a 2,048-token output limit, and requests thinking off. Ollama controls the actual context size; the SDK's 8,192-token metadata does not change the server configuration. Long conversations may require a new session or a larger context configured in Ollama.

Run the optional real-model test with `npm run test:ollama`. It creates an isolated temporary workspace, checks file-tool execution and streamed output through the actual Talaria API, then checks conversation recall. It defaults to `qwen3.5:9b`; override with `OLLAMA_MODEL` and `OLLAMA_URL`. This test needs your running local model and is separate from the offline `npm test` suite. No cloud keys or existing Talaria settings are used.

## Configure the model from the UI

1. Open **Bot 設定** in the sidebar.
2. Choose **OpenAI** or **Anthropic**, select a supported model, and enter your API key.
3. Click **儲存模型設定**. The next task uses the saved connection immediately; no restart is needed.
4. Return to the workspace and select **Talaria**.

Keys are never returned by the settings API or populated into password fields. Leave a key field blank to keep its value, enter a new value to replace it, or check the explicit removal option and save to disable that provider key. OpenAI and Anthropic keys are stored independently. Configuration indicators report saved state, not successful live authentication.

Settings are stored in `.loom/settings.json`, separate from conversation history and excluded from Git. This is a local plaintext configuration file; on POSIX systems it is created with mode 0600. Protect your OS user account and backups. A running task keeps its original settings snapshot.

Existing `.env` settings still work as a fallback. UI-saved fields take priority. Removing a key explicitly masks the environment key; entering a new key enables it again. The UI does not modify `.env`. If you edit environment variables manually, restart the server.

## Connect a real Hermes Agent (optional)

Hermes is an independent upstream application. **Talaria does not reimplement or bundle the Python Hermes runtime.** Your Node.js development environment stays independent; point the connector at a local or remote Hermes installation.

On the Hermes host, configure its `~/.hermes/.env`:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=your-gateway-secret
```

Then run `hermes gateway` there. In Talaria, expand **Bot 設定 → 進階：連接既有外部 Hermes 服務**, enter the gateway URL, model name and gateway API key, then click **儲存 Hermes 設定**. Changes apply to the next task. For environment-based configuration, these fields remain supported:

```dotenv
HERMES_URL=http://127.0.0.1:8642
HERMES_API_KEY=your-gateway-secret
HERMES_MODEL=hermes-agent
```

Both a gateway root URL and a URL ending in `/v1` are accepted. Under **任務選項**, select **外部 Hermes 協作（進階）** or **外部 Hermes（進階）** and explicitly enable **允許修改與保存**. The gateway may execute tools on its own host, using its own files, permissions, memory and skills. Its workspace is **not** automatically synchronized with Talaria's local workspace.

The connector uses the [documented Hermes Chat Completions API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/) with Bearer authentication. Direct Hermes mode sends successful conversation turns each time; delegated Pi tasks are self-contained. Hermes results currently arrive when the remote call finishes; Pi's own text streams live.

**Stop behavior:** stopping cancels the local request and Pi loop. Aborting an HTTP request does not guarantee an already-running Hermes task has stopped remotely; check the gateway for remote work. This version does not implement the Hermes Runs cancellation/approval protocol.

## Memory, skills and files

- `.loom/state.json` stores conversations, Pi transcripts, memories and skills using serialized atomic file replacement.
- `workspace/` is the only directory accessible through Pi file tools. Put the files you want the agent to work on there.
- These local data paths are created on first start and ignored by Git.
- Complete memory entries fit within a 16,000-character prompt budget. Skills use brief index entries (first 50 in the prompt), with `list_skills` for discovery and `read_skill` for the full procedure on demand. `update_memory` replaces outdated facts with write permission. `search_history` returns bounded excerpts of completed Web/bot messages.
- These are **Talaria's own Node.js implementations**, inspired by durable agent workflows; they are not a port of Hermes' memory/skill engine. Hermes continues to use its own capabilities on the gateway.
- Pi can save new memories and skills when the model decides it is useful and writes are enabled. There is no automatic offline learning worker.
- File tools are UTF-8 oriented, limit content to 256 KB, reject hidden paths, traversal and symlinks, and offer no shell execution.

## Scope and boundaries

This first version is a **single-user local development product**. The server binds to `127.0.0.1`, validates Host/Origin headers, requires a custom header for mutations, and applies a restrictive Content Security Policy. Keep this app bound to loopback. Optional remote previews must use the authenticated sharing gateway described above; do not point a tunnel directly at port 3100.

Writes and remote Hermes tools are off by default and enabled per run from the UI. This is not an OS sandbox: another local process can still modify files or race file operations. Only use trusted local workspaces. The project does not yet include multi-user login, terminal execution, schedules, MCP management, or cloud deployment.

Each run is capped at five minutes and Pi at twelve model turns. Errors and cancellation are visible and stored. Single-process storage prevents concurrent lost updates; do not run multiple server processes against the same data directory. Conversation histories are not automatically compacted; start a new session when a model's context limit is reached.

## Architecture

```text
Browser (TypeScript → esbuild → ES modules + CSS)
  └─ Node HTTP API + NDJSON ──────┐
Telegram long polling + pairing ┤
                               ▼
                      TaskService (shared)
                         ├─ history, progress, cancellation
                         ├─ context: memories + skill index
                         ├─ Pi SDK → model + permission-gated tools
                         └─ atomic JSON store
Legacy external Hermes connector remains optional.
```

```text
public/           Browser TypeScript interface
server/agent.ts   Pi orchestration, demo mode and tool definitions
server/tasks.ts   Shared Web/bot task lifecycle and session service
server/context.ts  Memory and on-demand skill context
server/telegram.ts  Telegram transport, pairing, polling and delivery
server/hermes.ts  Hermes HTTP integration
server/app.ts     HTTP API, streaming and local access checks
server/store.ts   Persistence
server/workspace.ts  Restricted local file operations
server/settings.ts  Local credentials and configuration
shared/          API, session and event types
scripts/         TypeScript build and development entry points
test/            TypeScript tests using the built-in Node runner
```

### Add a tool

Add a definition to `createTools()` in `server/agent.ts`. Give it a JSON schema and an async implementation; return tool content through the shared helper. Wrap any mutating or remote execution with the existing permission gate. Keep integrations behind server-side adapters so the browser never handles provider keys.

### Testing

The tests run the actual Pi SDK with a deterministic mock model transport to verify tool execution, transcript continuation and memory injection. They also cover persistence, file boundaries, permissions, Hermes request shape, streamed HTTP conversations, cancellation, credentials, Telegram owner pairing/revocation, group gating, duplicate updates, shared Web/bot history, live progress, restart recovery and on-demand skills. Telegram tests use an injected transport and never message a real account. **A live Telegram account/token, cloud-provider credentials or Hermes gateway are not exercised by the offline suite.**

## Upstream projects

- [Pi Agent Harness](https://github.com/earendil-works/pi) — official agent runtime and model abstraction (MIT).
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — architecture inspiration; an external gateway connector is retained as an optional advanced integration.
- [Hermes API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/).

Talaria is an independent integration and is not affiliated with either upstream project.

## Optional GitHub Actions

A Windows/Linux Node 22/24 CI template is included at `docs/github-actions.yml.example`. To enable it, copy the file to `.github/workflows/ci.yml` and commit using a GitHub credential that permits workflow changes. Local validation is available through `npm run build` and `npm test`.
