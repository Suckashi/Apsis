# Apsis architecture

[English README](../README.md) · [繁體中文說明](../README.zh-TW.md)

Apsis is a single-owner, single-process TypeScript application. `npm run dev` starts the browser build and Node server. Optional models and remote sharing do not change the development entry point.

## Domain boundaries

- **Agent**: versioned instructions, engine, model connection, tool allowlist, skill selection and immutable private/shared memory scope. A conversation snapshots the definition. Editing an agent affects new conversations; credentials are resolved at the start of each task.
- **Conversation**: user-visible transcript plus a versioned, engine-specific runtime envelope. Legacy Pi and engine transcripts are accepted and converted after successful execution. The runtime envelope is excluded from normal conversation APIs.
- **Run**: durable ID, status, agent/model/permission snapshot, reply, activity, tool operations and available token usage. A run belongs to the server, not an HTTP connection.
- **Connection**: independent provider, model default, URL and credential. Public views expose only credential presence. Changing provider/URL clears the old key; edits invalidate capability verification.
- **Knowledge**: scoped memories and on-demand skills. Source conversation/run, enabled status and bounded content revisions support inspection and correction.

## Execution

`server/runtime.ts` defines the adapter contract. `server/engines/index.ts` dispatches lazily to Pi, Deep Agents or OpenAI Agents SDK. Each uses the same `server/tools.ts` implementations and `server/context.ts` scoped knowledge. Framework-specific state stays inside its adapter/envelope. No cross-engine handoff is implemented.

The Web UI submits `POST /api/sessions/:id/runs` with explicit `files`, `memory` and `skills` booleans. The response is HTTP 202 with the run ID after the initial journal is written. It polls `GET /api/runs/:id`; closing a tab has no cancellation side effect. An explicit stop endpoint requests cancellation. Existing NDJSON and Telegram entry points use the same task service.

Per-conversation concurrency is rejected. Requests are not automatically retried or assigned client idempotency keys: if an HTTP response is lost after acceptance, consult run history before sending another message. Different conversations may run concurrently, subject to model capacity.

Tools first persist a `started` record, execute, then persist `succeeded` or `failed`. If execution finishes but final logging fails, the result is `unknown`. A crash can occur between a side effect and its journal update, so the log is evidence, not an exactly-once guarantee. Restart marks active runs interrupted and outstanding operations unknown. It never replays them automatically. A completed conversation reply with the same run ID reconciles a crash between transcript and run finalization.

Successful native state is retained for continuation. Failed/aborted partial state is not adopted. A subsequent user message starts a new run against the last successful native state plus a bounded journal excerpt from the same conversation since its latest completed run. This includes at most eight failed/cancelled/interrupted attempts in a 16,000-character JSON budget, newest first. All engines receive the excerpt as explicitly untrusted evidence with instructions to verify current state and honor current grants; nothing is automatically replayed. Recovery source IDs are saved on the new run. An execution marked completed ends this recovery window, even if the model did not fulfill every part of the user's objective.

Operation evidence stores bounded text, Shell commands and exit codes, and unified patches for file write/edit tools. The active connection's known API keys are redacted before journal persistence. Each field is capped at 24,000 characters; truncation is visible. This is not general secret discovery or a Git change tracker. Shell writes may affect arbitrary files and have no automatic patch. Write tools join the SDK's per-file mutation queue; Shell commands and separate processes are outside that queue.

Projects are a backward-compatible optional collection in the main store. Registration requires an existing absolute directory, canonicalizes it with realpath, and deduplicates roots. New conversations snapshot a project; legacy conversations without a snapshot use the original default workspace. The runtime and file-list endpoint resolve that snapshot and reject missing/repointed roots without creating them. The project is immutable for that conversation. Project selection does not isolate concurrent conversations or confine Shell. Telegram new conversations use the default project; resuming a Web conversation retains its project.

## Memory and permissions

Tool availability and per-run permission are separate checks. Granting memory writes does not grant file or skill writes. Legacy chat/Telegram boolean grants remain compatible and map to all three categories; the Web UI uses independent grants.

Memory retrieval filters by agent scope and enabled/merged status, then ranks normalized lexical matches including CJK bigrams within a 16,000-character budget. Deduplication compares normalized text within the same scope. It is not semantic deduplication. Manual merge is restricted to matching scopes and retains the disabled source entry. Revisions retain at most 20 previous contents. No external embedding database is required.

Deep Agents virtual files are conversation scratch state. `workspace_*` tools access actual workspace files. The shared shell tool requires explicit per-run shell and file grants; it executes on the host, starting in the workspace, without filesystem confinement. Its planning and internal delegation are framework capabilities, not a separate trust boundary.

The default Pi adapter embeds `pi-coding-agent` with host-owned resources, in-memory settings and credentials, and an explicit tool allowlist. Apsis persists SDK session headers and entries (including compaction) inside its runtime envelope. Old Pi message arrays are imported on first continuation. Precise edits reuse the SDK edit tool through the existing workspace path checks. Shell uses the SDK PowerShell/Bash tool with a bounded timeout, cancellation and a filtered environment; this is not an OS sandbox. Telegram write permission does not grant shell access.

## Persistence decision

Version 1 uses validated atomic JSON replacement for conversation/agent/knowledge state, separate per-run files, and independent credential files. Migration preserves `state.pre-v1.json`; each subsequent state mutation keeps `state.json.bak`. A schema mismatch stops loading without replacing the original. This is an application-level atomic replacement strategy, not fsync-backed transactional durability or a multi-process database.

The run journal is saved initially, at tool boundaries, and at completion. Live text is held in memory between these checkpoints, so a crash can lose the latest partial text. Streaming tokens do not rewrite the conversation database. Run history is paginated in the API/UI; journals are still loaded into memory at startup. Conversation history still uses full-state storage.

SQLite is a suitable next storage adapter when indexed conversation retrieval, incremental writes or multiple processes become necessary. It is deliberately not added in this iteration: the current Node minimum, migration complexity and existing deployment should remain stable. No external database service is needed. Backups and schema validation are implemented now; a database migration and restore UI are not.

Stop the server before copying `.loom/`, `workspace/` and any registered project directories for a complete backup. Project registration stores paths, not copies of project files. The downloadable state snapshot excludes credential files and run journals but can still contain private transcript/knowledge content. Restore while stopped, after preserving a copy of current data. Only one server may write to a data directory.

## Verification boundary

Automated tests use real SDK transports against local deterministic servers, including continuation, tool enforcement, probe success/failure, connection isolation, server-owned runs, cancellation, crash journals, migrations and knowledge edits. Local Ollama checks exercise real model behavior without cloud credentials. Passing transport tests does not guarantee a model will choose a tool or follow instructions; capability checks report incomplete tool behavior honestly. Provider usage is observational, not a bill or price estimate; Deep Agents internal subagent usage may be absent.
