# Apsis architecture

Apsis is a single-owner, single-process Node.js application. `npm run dev` builds the React Bot interface and starts the server. Deep Agents and Codex are separate Bot runtimes selected by the model connection.

## Boundaries

- **ProductService** (`server/product.ts`) owns Bot profiles, per-Bot queues, cross-Bot delegation, schedules, approvals, results, MCP connectors, and browser tabs. Bots are peers. `list_bots` discovers available peers; `delegate_task` submits a job to a recipient's queue and waits for that job's result. The recipient uses its own role and model.
- **TaskService** (`server/tasks.ts`) owns conversation transcripts, run IDs, cancellation, model selection, operation journaling, and recovery evidence. A run belongs to the server rather than the HTTP connection.
- **Deep Agents adapter** (`server/engines/deep.ts`) connects a selected model and Apsis tools to `createDeepAgent`. Its built-in todo list, virtual filesystem, subagents, and summarization handle work inside one Bot. Conversation-local Deep Agents state is saved only after a successful run.
- **Codex adapter** (`server/codex.ts`) starts a local Codex App Server for a Bot job using the owner's ChatGPT sign-in. A per-run, random local MCP URL exposes Apsis tools through the same authorization and operation journal. Codex is run in read-only host mode; real workspace changes go through Apsis tools. The Codex process and MCP URL end with the job.
- **Tools and authorization** (`server/tools.ts`, `server/coding-tools.ts`) expose real workspace files, memory, skills, shell, browser, documents, schedules, and MCP. Apsis checks each tool invocation before it runs and records started/completed/failed operations. Shell, MCP calls, and browser changes await owner approval.
- **Knowledge** (`server/context.ts`, `server/agents.ts`) supplies scoped memories and selected skills. A Bot's memory and history search are private; shared skills are selected on demand. Virtual Deep Agents files do not grant access to host files.

## Execution

Web and paired Telegram send messages to the same Bot queues. Each Bot executes one job at a time. A new message during a run queues for later; a steering message is applied at the next Deep Agents invocation boundary. Separate Bots may run concurrently. A delegated job is bounded by depth and root-job count, and cyclic waits are rejected.

Deep Agents uses `@langchain/openai` or `@langchain/anthropic` depending on the saved model connection. Ollama and custom compatible endpoints use their OpenAI-compatible Chat Completions endpoint. Credentials remain server-side. Codex uses the local CLI's ChatGPT sign-in and requires no API key in Apsis. The Codex connection test checks authentication and model availability; a full delegation job verifies MCP tool execution.

Tools touching the real workspace use restricted relative paths; symlinks and traversal are rejected. Shell runs from the workspace but can reach the host. A tool result or document is task data, not a source of instructions or new permission.

Run records save operation evidence at tool boundaries. An interrupted run is not replayed. A later task may receive a bounded excerpt of prior failure evidence and must inspect current state before repeating work. Failed or cancelled partial Deep Agents state is not adopted.

## Storage

`.apsis/product.sqlite` stores product records and events using SQLite WAL. `.apsis/state.json` stores conversations and knowledge with schema validation and atomic replacement; `.apsis/runs/` stores run journals. `.apsis/connections.json` and `.apsis/telegram.json` hold credentials and owner pairing. `.apsis/workspace/` holds user files. These files are excluded from Git. Stop the app before copying `.apsis/` for a complete backup.

The app is intended for one owner and one writing process. It does not provide multi-user isolation, exactly-once execution of external side effects, or an operating-system sandbox for shell commands.
