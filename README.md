# Apsis

[繁體中文](README.zh-TW.md)

Apsis is a local Bot workspace built with TypeScript and Node.js. Bots can run with **Deep Agents** and an API or Ollama model, or with **Codex** using the owner's ChatGPT sign-in. Each Bot has its own role, model selection, conversation, private memory, schedules, browser tab, and results. Bots can discover teammates and delegate work; Apsis handles the queue, approvals, persistence, and cross-Bot coordination.

## Start

Requires Node.js 22.19 or newer.

```sh
npm ci
npm run dev
```

Open <http://localhost:3100>. In **Settings & Tools → Model connections**, add an OpenAI, Anthropic, Ollama, or OpenAI-compatible endpoint and test its streaming and tool calls. Then create a Bot and give it a task. API keys stay on the server in `.apsis/connections.json`.

To use your ChatGPT Codex allowance instead, install the Codex CLI, choose **Sign in to ChatGPT** in Model connections, finish browser sign-in, and save a **ChatGPT Codex** model connection. This path needs no OpenAI API key. The Codex client runs locally and calls Apsis Bot tools through a short-lived local MCP bridge; Apsis does not read or store ChatGPT tokens. Connection testing checks login and model availability. Verify delegation by inspecting the actual `list_bots` and `delegate_task` operations and the receiving Bot's completed job.

For local Ollama, use `http://127.0.0.1:11434` and an installed model ID such as `qwen3.5:9b`. The Ollama server must already be running. Larger tool-capable models are recommended for complex planning and delegation.

## Architecture

```text
Web / paired Telegram
        ↓
Bot profiles and durable job queues (ProductService)
        ↓
TaskService → Deep Agents or Codex App Server → selected model
        ↓
Apsis tools: workspace, memory, skills, browser, documents, MCP, schedules
        ↓
approval gate and operation journal
```

Deep Agents handles planning, context management, virtual scratch files, and internal subagents **within** one Bot. Codex is a separate Bot execution path and uses the locally installed Codex App Server. Apsis owns Bot identity, cross-Bot delegation, permissions, schedules, and saved results in both paths. `delegate_task` runs a job in the receiving Bot's own conversation and returns its result to the sender.

The Deep Agents virtual filesystem is conversation scratch space. Real files use `workspace_*` tools in `.apsis/workspace/`. Shell runs on the host after owner approval; the workspace is not an operating-system sandbox. Browser changes and MCP calls also require approval.

Data lives in `.apsis/`: SQLite stores Bots, jobs, approvals, schedules, and event records; validated JSON stores conversations and knowledge; run journals are separate files. Restart marks unfinished work interrupted and never replays external actions automatically. Back up `.apsis/` while the app is stopped.

See [Bot workspace](docs/bot-workspace.md) for the user flow and [architecture](docs/architecture.md) for implementation boundaries.

## Verify

```sh
npm run build
npm test
npm run test:bots:browser
```

The browser test uses an isolated deterministic model fixture. `npm run test:bots:ollama` optionally checks real local-model delegation; model behavior can vary.
After signing in to ChatGPT locally, `npm run test:bots:codex` runs the same delegation through Codex in isolated Bot data and checks both tool calls and the child job.
