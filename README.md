# Talaria

A local-first agent workspace that combines **Pi's Node.js agent runtime**, persistent memory and reusable skills, with an **optional real Hermes Agent gateway**.

以 Node.js 啟動的 AI 工作台。Web 介面、API、agent 編排與資料保存都使用 JavaScript；開發本專案不用安裝 Python、Docker、Redis 或資料庫。

## Quick start / 三個步驟

Requires **Node.js 22.19+** (Node 24 LTS recommended) and npm.

```sh
git clone https://github.com/Suckashi/Talaria.git
cd Talaria
npm ci
npm run dev
```

Open **http://localhost:3100**. With no API keys, select **示範模式** to try the interface. Demo responses are clearly labelled deterministic examples, not AI output.

- `npm run dev` — starts the Node server with automatic restart when imported server modules change. Refresh the browser after editing frontend files.
- `npm start` — starts without file watching.
- `npm test` — Node's built-in test runner; no paid API calls.
- `npm run check` — checks JavaScript syntax.
- There is no frontend compilation or separate backend startup step.

## What works

| Mode        | What runs                                                       | Configuration           |
| ----------- | --------------------------------------------------------------- | ----------------------- |
| Demo / 示範 | Local scripted streaming response                               | None                    |
| Pi          | Official Pi SDK agent loop with local tools                     | OpenAI or Anthropic key |
| Pi × Hermes | Pi can delegate tasks to the real Hermes HTTP gateway as a tool | Pi key + Hermes gateway |
| Hermes      | Send the conversation directly to Hermes                        | Hermes gateway          |

Pi includes `list_files`, `read_file`, `write_file`, `remember`, and `save_skill`. Hybrid mode additionally exposes `delegate_to_hermes`; Pi chooses when delegation is useful. Selecting hybrid does **not** force a Hermes call on every message.

The Web UI provides streamed Pi output, activity events, saved conversations, memory/skill creation and deletion, connection status, and stop control. Mode changes create a new conversation so histories from different engines do not mix.

## Configure Pi

Copy `.env.example` to `.env` and set:

```dotenv
PI_PROVIDER=openai
PI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=your-key
```

Or use Anthropic:

```dotenv
PI_PROVIDER=anthropic
PI_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=your-key
```

Restart `npm run dev` after editing `.env`. Keys stay on the server and are not sent to the browser. The connection indicator means variables are configured; it does not claim the credentials have been validated.

## Connect a real Hermes Agent (optional)

Hermes is an independent upstream application. **Talaria does not reimplement or bundle the Python Hermes runtime.** Your Node.js development environment stays independent; point the connector at a local or remote Hermes installation.

On the Hermes host, configure its `~/.hermes/.env`:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=your-gateway-secret
```

Then run `hermes gateway` there. In Talaria's `.env`:

```dotenv
HERMES_URL=http://127.0.0.1:8642
HERMES_API_KEY=your-gateway-secret
HERMES_MODEL=hermes-agent
```

Both a gateway root URL and a URL ending in `/v1` are accepted. Select **Pi × Hermes** or **Hermes** and explicitly enable **允許修改 / 遠端工具**. The gateway may execute tools on its own host, using its own files, permissions, memory and skills. Its workspace is **not** automatically synchronized with Talaria's local workspace.

The connector uses the [documented Hermes Chat Completions API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/) with Bearer authentication. Direct Hermes mode sends successful conversation turns each time; delegated Pi tasks are self-contained. Hermes results currently arrive when the remote call finishes; Pi's own text streams live.

**Stop behavior:** stopping cancels the local request and Pi loop. Aborting an HTTP request does not guarantee an already-running Hermes task has stopped remotely; check the gateway for remote work. This version does not implement the Hermes Runs cancellation/approval protocol.

## Memory, skills and files

- `.loom/state.json` stores conversations, Pi transcripts, memories and skills using serialized atomic file replacement.
- `workspace/` is the only directory accessible through Pi file tools. Put the files you want the agent to work on there.
- Both paths are created on first start and ignored by Git.
- Memories and skills are included as reference context at the start of each Pi run. The current prompt budget includes up to 16,000 characters of memories and 24,000 characters of skills.
- These are **Talaria's own Node.js implementations**, inspired by durable agent workflows; they are not a port of Hermes' memory/skill engine. Hermes continues to use its own capabilities on the gateway.
- Pi can save new memories and skills when the model decides it is useful and writes are enabled. There is no automatic offline learning worker.
- File tools are UTF-8 oriented, limit content to 256 KB, reject hidden paths, traversal and symlinks, and offer no shell execution.

## Scope and boundaries

This first version is a **single-user local development product**. The server binds to `127.0.0.1`, validates Host/Origin headers, requires a custom header for mutations, and applies a restrictive Content Security Policy. Do not expose it through a public tunnel or change its bind address without adding authentication and authorization.

Writes and remote Hermes tools are off by default and enabled per run from the UI. This is not an OS sandbox: another local process can still modify files or race file operations. Only use trusted local workspaces. The project does not yet include multi-user login, terminal execution, schedules, MCP management, or cloud deployment.

Each run is capped at five minutes and Pi at twelve model turns. Errors and cancellation are visible and stored. Single-process storage prevents concurrent lost updates; do not run multiple server processes against the same data directory. Conversation histories are not automatically compacted; start a new session when a model's context limit is reached.

## Architecture

```text
Browser (native ES modules + CSS)
  └─ Node HTTP server + NDJSON streaming
      ├─ Pi SDK (@earendil-works/pi-agent-core + pi-ai)
      │   ├─ workspace file tools
      │   ├─ local memory / skill tools
      │   └─ delegate_to_hermes → HTTP → Hermes gateway (optional)
      ├─ direct Hermes connector
      └─ atomic JSON store
```

```text
public/           Browser interface; no bundler
server/agent.js   Pi orchestration, demo mode and tool definitions
server/hermes.js  Hermes HTTP integration
server/app.js     HTTP API, streaming and local access checks
server/store.js   Persistence
server/workspace.js  Restricted local file operations
test/            Built-in Node tests
```

### Add a tool

Add a definition to `createTools()` in `server/agent.js`. Give it a JSON schema and an async implementation; return tool content through the shared helper. Wrap any mutating or remote execution with the existing permission gate. Keep integrations behind server-side adapters so the browser never handles provider keys.

### Testing

The tests run the actual Pi SDK with a deterministic mock model transport to verify tool execution, transcript continuation and memory injection. They also cover persistence, file boundaries, permissions, Hermes request shape, streamed HTTP conversations, request isolation and cancellation. **Live provider responses and a real Hermes gateway require your credentials and are not exercised by the offline suite.**

## Upstream projects

- [Pi Agent Harness](https://github.com/earendil-works/pi) — official agent runtime and model abstraction (MIT).
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — independently operated optional gateway.
- [Hermes API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/).

Talaria is an independent integration and is not affiliated with either upstream project.

## Optional GitHub Actions

A Windows/Linux Node 22/24 CI template is included at `docs/github-actions.yml.example`. To enable it, copy the file to `.github/workflows/ci.yml` and commit using a GitHub credential that permits workflow changes. Local validation is available immediately through `npm run check` and `npm test`.
