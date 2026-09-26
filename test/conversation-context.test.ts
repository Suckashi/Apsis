import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { checkpoint, restoreCheckpoint } from "../server/context-checkpoint.ts";
import { contextBudget } from "../server/context-budget.ts";
import { ConversationStore } from "../server/conversations.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { changeMemory, selectMemories } from "../server/memory.ts";
import { runDeep } from "../server/engines/deep.ts";
import { createApp } from "../server/app.ts";
import { Type } from "typebox";
import { scratchBackend } from "../server/scratch-backend.ts";
import type { Session, StoreState } from "../shared/types.ts";

const session = (id = "owner"): Session => ({
  id,
  title: id,
  mode: "deepagents",
  createdAt: "2026-01-01",
  messages: [],
});
test("context budgets default to 256K and reserve output with explicit 8K/32K/128K limits", () => {
  for (const window of [8192, 32768, 131072]) {
    const b = contextBudget("ollama", "gpt-4o", {
      contextWindowTokens: window,
      maxOutputTokens: 1024,
    });
    assert.equal(
      b.input,
      window - 1024 - Math.max(1024, Math.ceil(window * 0.05)),
    );
    assert.ok(
      b.keep <= 12000 && b.memory <= 1600 && b.memory <= b.input * 0.15,
    );
  }
  for (const provider of ["ollama", "openai-compatible", "openai", "anthropic"]) {
    for (const model of ["gpt-4o", "unknown-model"]) {
      for (const settings of [undefined, {}, { contextWindowTokens: undefined }]) {
        const budget = contextBudget(provider, model, settings);
        assert.equal(budget.windowTokens, 262144);
        assert.equal(budget.input, 262144 - 4096 - Math.ceil(262144 * 0.05));
      }
    }
  }
  for (const invalid of [0, -1, NaN, Infinity, 8192.5]) {
    assert.throws(
      () => contextBudget("ollama", "small", { contextWindowTokens: invalid }),
      /格式錯誤/,
    );
  }
  assert.throws(
    () => contextBudget("ollama", "small", { contextWindowTokens: 2048 }),
    /不足/,
  );
});
test("checkpoint normalizes three compactions without applying stale cutoffs and rejects incomplete tools", () => {
  let messages = [new HumanMessage("Goal: keep constraint")];
  for (let i = 0; i < 3; i++) {
    const saved = checkpoint({
      messages: [
        ...messages,
        new AIMessage("done"),
        new HumanMessage("latest correction"),
      ],
      _summarizationEvent: {
        cutoffIndex: messages.length,
        summaryMessage: new HumanMessage("Goal, constraint, pending work " + i),
        filePath: "/archive",
      },
      todos: [{ content: "pending proof", status: "pending" }],
    })!;
    const restored = restoreCheckpoint(JSON.parse(JSON.stringify(saved)))!;
    assert.equal(restored.messages.length, 3);
    assert.equal(restored._summarizationEvent, undefined);
    assert.equal(restored.todos?.[0].content, "pending proof");
    messages = restored.messages as HumanMessage[];
  }
  const call = new AIMessage({
    content: "",
    tool_calls: [{ name: "write", args: {}, id: "call" }],
  });
  assert.equal(checkpoint({ messages: [call] }), undefined);
  assert.ok(
    checkpoint({
      messages: [
        call,
        new ToolMessage({ content: "saved", tool_call_id: "call" }),
      ],
    }),
  );
});
test("10,000-message history is paged, searchable in Chinese/English, isolated and independently checkpointed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-history-"));
  const db = new ConversationStore(dir);
  t.after(() => db.db.close());
  db.saveSession(session());
  db.saveSession(session("other"));
  db.transaction(() => {
    for (let i = 0; i < 10000; i++)
      db.append("owner", {
        id: "m" + i,
        role: "user",
        content: `台灣專案 evidence ${i}`,
        status: "complete",
      });
  });
  db.append("other", {
    id: "secret",
    role: "user",
    content: "台灣專案 secret",
    status: "complete",
  });
  const page = db.page("owner");
  assert.equal(page.messages.length, 50);
  assert.ok(page.olderCursor);
  assert.equal(db.page("owner", page.olderCursor).messages.at(-1)?.id, "m9949");
  for (const q of ["台灣", "灣專案", "evidence"]) {
    const hits = db.search(q, ["owner"]);
    assert.equal(hits.length, 20);
    assert.ok(hits.every((h) => h.sessionId === "owner"));
  }
  const secret = db.search("secret", ["other"])[0];
  assert.throws(() => db.around(["owner"], secret.sequence));
  const chat = db.activeId("owner"),
    job = db.createContext("owner", "routine");
  assert.equal(db.activeId("owner"), chat);
  db.saveCheckpoint("owner", job.id, { marker: "job only" });
  assert.equal(db.load("owner").engineState, undefined);
  assert.deepEqual(db.load("owner", job.id).engineState, {
    marker: "job only",
  });
  const fresh = db.createContext("owner");
  assert.equal(db.load("owner").messages.length, 0);
  assert.notEqual(fresh.id, chat);
  assert.equal(db.cachedSessions()[1].messages.length, 50);
  assert.equal(db.message("owner", "m0")?.content, "台灣專案 evidence 0");
});
test("legacy migration is retryable and keeps IDs, scratch and originals without storing history in JSON", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-migration-"));
  const old = session();
  old.messages = [
    { id: "original", role: "user", content: "保留歷史", status: "complete" },
  ];
  old.engineState = {
    messages: checkpoint({ messages: [new HumanMessage("old")] })!.messages,
    files: { "/proof.txt": { content: ["proof", "second"] } },
  };
  const original = JSON.stringify({
    schemaVersion: 2,
    sessions: [old],
    memories: [],
    skills: [],
  });
  await writeFile(join(dir, "state.json"), original);
  const db = new ConversationStore(dir);
  await db.migrate([old], "retry");
  await db.migrate([old], "retry");
  db.db.close();
  const store = await new Store(dir).init();
  assert.equal(store.conversations.page(old.id).messages.length, 1);
  assert.equal(store.conversations.message(old.id, "original")?.id, "original");
  assert.equal(
    (store.conversations.load(old.id).engineState as any).files,
    undefined,
  );
  assert.equal(
    await readFile(
      join(
        store.conversations.scratchRoot(
          old.id,
          store.conversations.activeId(old.id),
        ),
        "proof.txt",
      ),
      "utf8",
    ),
    "proof\nsecond",
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(dir, "state.json"), "utf8")).sessions,
    [],
  );
  store.conversations.db.close();
  const reopened = await new Store(dir).init();
  t.after(() => reopened.conversations.db.close());
  assert.equal(reopened.conversations.page(old.id).messages.length, 1);
});
test("partially imported history retries after a scratch conflict without duplication or lost content", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-migrate-retry-"));
  const db = new ConversationStore(dir);
  t.after(() => db.db.close());
  const old = session();
  old.messages = [
    { id: "same-id", role: "user", content: "original", status: "complete" },
  ];
  old.engineState = {
    messages: [],
    files: { "/proof": { content: ["original proof"] } },
  };
  db.saveSession(old);
  const root = db.scratchRoot(old.id, db.activeId(old.id));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "proof"), "conflicting file");
  await assert.rejects(db.migrate([old], "same-import"));
  assert.equal(
    db.db.prepare("SELECT 1 FROM meta WHERE key='import:same-import'").get(),
    undefined,
  );
  assert.equal(await readFile(join(root, "proof"), "utf8"), "conflicting file");
  await writeFile(join(root, "proof"), "original proof");
  await db.migrate([old], "same-import");
  await db.migrate([old], "same-import");
  assert.equal(db.page(old.id).messages.length, 1);
  assert.equal(db.message(old.id, "same-id")?.content, "original");
});
test("scratch rejects traversal and links to other contexts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-scratch-scope-"));
  const root = join(dir, "private"),
    other = join(dir, "other");
  await mkdir(root);
  await mkdir(other);
  await writeFile(join(other, "secret"), "not yours");
  const backend = scratchBackend(root);
  assert.throws(() => backend.read("../other/secret"), /路徑/);
  assert.throws(() => backend.write("C:/outside", "no"), /路徑/);
  await symlink(
    other,
    join(root, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => backend.read("/escape/secret"), /符號連結/);
  assert.throws(() => backend.grep("not yours", "/"), /符號連結/);
});
test("memory enforces scope, revisions, manual protection, capacity, dedup and next assembly", () => {
  const state: StoreState = { sessions: [], skills: [], memories: [] };
  const auto = { kind: "agent" as const, runId: "run" };
  const m = changeMemory(
    state,
    "bot",
    { content: "durable", tier: "core" },
    auto,
  );
  assert.equal(
    changeMemory(state, "bot", { content: "durable" }, auto).id,
    m.id,
  );
  assert.throws(() =>
    changeMemory(state, "other", { id: m.id, revision: 1 }, auto),
  );
  changeMemory(
    state,
    "bot",
    { id: m.id, revision: 1, content: "new preference" },
    { kind: "manual" },
  );
  assert.throws(
    () =>
      changeMemory(
        state,
        "bot",
        { id: m.id, revision: 1, content: "stale" },
        auto,
      ),
    /重新載入/,
  );
  assert.throws(
    () =>
      changeMemory(
        state,
        "bot",
        { id: m.id, revision: 2, content: "overwrite" },
        auto,
      ),
    /不能自動覆寫/,
  );
  changeMemory(state, "bot", { content: "x".repeat(4000), tier: "core" }, auto);
  assert.throws(
    () =>
      changeMemory(
        state,
        "bot",
        { content: "y".repeat(3000), tier: "core" },
        auto,
      ),
    /6,000/,
  );
  const selected = selectMemories(state.memories, "preference", 100);
  assert.equal(selected.selected[0].content, "new preference");
  assert.equal(selected.omittedCoreIds.length, 1);
});
test("new task conflicts while busy; chat, routine and delegation contexts stay pinned and references survive", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-context-jobs-"));
  const calls: {
    prompt: string;
    context?: string;
    state?: unknown;
    quoted?: string;
  }[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await createApp({
    dataDir: dir,
    workspaceDir: join(dir, "work"),
    runner: async (options) => {
      calls.push({
        prompt: options.prompt,
        context: options.session.workContextId,
        state: options.session.engineState,
        quoted: options.executionContext,
      });
      if (options.prompt === "hold") await gate;
      return {
        text: "done",
        engineState: checkpoint({
          messages: [new HumanMessage(options.prompt), new AIMessage("done")],
        }),
      };
    },
  });
  t.after(() => app.product.close());
  const c = await app.connections.save({
    name: "fixture",
    provider: "openai-compatible",
    model: "fixture",
    url: "http://127.0.0.1:1/v1",
    modelSettings: { fixture: { contextWindowTokens: 32768 } },
  });
  await app.connections.setDefault({ connectionId: c.id, model: c.model });
  const bot = await app.product.create("Context Bot");
  const initial = app.tasks.store.conversations.activeId(bot.sessionId);
  const wait = async () => {
    for (let i = 0; i < 500 && app.product.active.size; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(app.product.active.size, 0);
  };
  await app.product.submit(bot.id, { requestId: "hold", prompt: "hold" });
  assert.throws(() => app.product.newContext(bot.id), /排隊/);
  const queued = await app.product.submit(bot.id, {
    requestId: "queued",
    prompt: "queued",
  });
  assert.equal(queued.workContextId, initial);
  release();
  await wait();
  const oldMessage = app.tasks.store.conversations.page(bot.sessionId)
    .messages[0];
  const fresh = app.product.newContext(bot.id);
  assert.equal(
    app.tasks.store.conversations.load(bot.sessionId).engineState,
    undefined,
  );
  const routine = await app.product.submit(bot.id, {
    requestId: "routine",
    prompt: "routine",
    contextKind: "routine",
  });
  await wait();
  assert.notEqual(routine.workContextId, fresh.id);
  assert.equal(app.tasks.store.conversations.activeId(bot.sessionId), fresh.id);
  await app.product.submit(bot.id, {
    requestId: "chat",
    prompt: "reference",
    replyTo: oldMessage.id,
  });
  await wait();
  const resumed = calls.find((c) => c.prompt === "reference")!;
  assert.equal(resumed.context, fresh.id);
  assert.equal(resumed.state, undefined);
  assert.match(resumed.quoted!, /hold/);
  app.product.db.put("job", {
    ...queued,
    status: "failed",
    permissionBotIds: [bot.id],
  });
  const retried = await app.product.submit(bot.id, {
    requestId: "retry",
    prompt: "recheck evidence before retry",
    retryOf: queued.id,
  });
  await wait();
  assert.equal(retried.workContextId, initial);
  assert.equal(app.tasks.store.conversations.activeId(bot.sessionId), fresh.id);
  assert.deepEqual(retried.permissionBotIds, [bot.id]);
  const delegated = await app.product.submit(
    bot.id,
    { requestId: "child", prompt: "assigned" },
    { delegatedBy: "source" },
  );
  await wait();
  assert.notEqual(delegated.workContextId, fresh.id);
  assert.equal(calls.at(-1)?.state, undefined);
  let exported = "";
  for await (const chunk of app.tasks.store.conversations.exportChunks())
    exported += chunk;
  assert.ok(JSON.parse(exported).contexts.length >= 4);
  await app.product.remove(bot.id);
  assert.throws(() => app.tasks.store.conversations.metadata(bot.sessionId));
});
test("real Deep Agents compacts three times, suppresses summary streams and resumes normalized checkpoints", async (t) => {
  let summaries = 0;
  const requests: any[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const isSummary = !body.tools?.length;
    if (isSummary) summaries++;
    const content = isSummary
      ? "INTERNAL_SUMMARY Goal: proof; constraint: never replay; todo: verify /proof.txt"
      : "PUBLIC_DONE";
    if (!body.stream) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "sum" + summaries,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ id: "reply" + requests.length, object: "chat.completion.chunk", model: "fixture", usage: { prompt_tokens: 1234, completion_tokens: 10, total_tokens: 1244 }, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }] })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const dir = await mkdtemp(join(tmpdir(), "apsis-compaction-"));
  let store = await new Store(dir).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  await store.mutate((s) => s.sessions.push(session()));
  const contextId = store.conversations.activeId("owner");
  for (let cycle = 0; cycle < 3; cycle++) {
    const previous =
      restoreCheckpoint(store.conversations.load("owner").engineState)
        ?.messages || [];
    const messages = [...previous];
    for (let i = 0; i < 30; i++)
      messages.push(
        new HumanMessage("Goal constraint proof " + "history ".repeat(500)),
        new AIMessage("ack"),
      );
    store.conversations.saveCheckpoint(
      "owner",
      contextId,
      checkpoint({
        messages,
        todos: [{ content: "verify", status: "pending" }],
      }),
    );
    const deltas: string[] = [];
    let steer: ((text: string) => Promise<void>) | undefined;
    let steered = false;
    const result = await runDeep({
      store,
      workspace,
      session: store.conversations.load("owner"),
      mode: "deepagents",
      allowWrites: false,
      prompt: "Keep the latest correction and verify proof",
      modelSettings: { contextWindowTokens: 32768, maxOutputTokens: 1024 },
      env: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_ID: "fixture",
        COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      },
      signal: AbortSignal.timeout(15000),
      source: { sessionId: "owner", runId: "run" + cycle },
      registerSteer: (fn) => {
        steer = fn;
      },
      emit: (e) => {
        if (e.type === "delta") {
          deltas.push(e.text);
          if (cycle === 1 && !steered) {
            steered = true;
            void steer!("Latest correction: preserve the proof path");
          }
        }
      },
    });
    const expected = cycle === 1 ? "PUBLIC_DONEPUBLIC_DONE" : "PUBLIC_DONE";
    assert.equal(result.text, expected);
    assert.equal(deltas.join(""), expected);
    if (cycle === 1)
      assert.match(
        JSON.stringify(requests.at(-1).messages),
        /Latest correction: preserve the proof path/,
      );
    assert.ok(result.engineState!.messages.length < messages.length);
    assert.match(JSON.stringify(result.engineState), /INTERNAL_SUMMARY/);
    assert.equal(result.engineState?.todos?.[0].content, "verify");
    store.conversations.db.close();
    store = await new Store(dir).init();
  }
  assert.ok(summaries >= 3);
  assert.equal(store.conversations.compactions("owner").length, 3);
  assert.equal(store.conversations.context("owner").usage?.source, "provider");
  assert.equal(store.conversations.context("owner").usage?.inputTokens, 1234);
  store.conversations.db.close();
});
test("overflow retries once, oversized input and summary failure preserve the last valid checkpoint", async (t) => {
  let normalCalls = 0,
    summaryCalls = 0,
    failSummary = false;
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (!body.tools?.length) {
      summaryCalls++;
      if (failSummary) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "summary failed" } }));
        return;
      }
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              id: "summary",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: "Preserve goal and unfinished proof",
                  },
                  finish_reason: "stop",
                },
              ],
            }) +
            "\n\n",
        );
        res.end("data: [DONE]\n\n");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "summary",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Preserve goal and unfinished proof",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    normalCalls++;
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: "maximum context length exceeded",
          code: "context_length_exceeded",
          type: "invalid_request_error",
        },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const dir = await mkdtemp(join(tmpdir(), "apsis-overflow-"));
  const store = await new Store(dir).init();
  t.after(() => store.conversations.db.close());
  const workspace = await new Workspace(join(dir, "work")).init();
  await store.mutate((s) => s.sessions.push(session()));
  const id = store.conversations.activeId("owner");
  const saved = checkpoint({
    messages: Array.from({ length: 20 }, (_, i) =>
      i % 2 ? new AIMessage("ack") : new HumanMessage("history ".repeat(500)),
    ),
  })!;
  store.conversations.saveCheckpoint("owner", id, saved);
  const options = {
    store,
    workspace,
    session: store.conversations.load("owner"),
    mode: "deepagents" as const,
    allowWrites: false,
    prompt: "latest",
    modelSettings: { contextWindowTokens: 32768, maxOutputTokens: 1024 },
    env: {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_ID: "fixture",
      COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
    },
    signal: AbortSignal.timeout(15000),
    emit: () => {},
  };
  await assert.rejects(runDeep(options), /本步已停止/);
  assert.equal(normalCalls, 2);
  assert.equal(summaryCalls, 1);
  assert.deepEqual(
    store.conversations.load("owner").engineState,
    JSON.parse(JSON.stringify(saved)),
  );
  const requests = normalCalls + summaryCalls;
  await assert.rejects(
    runDeep({ ...options, prompt: "巨大輸入".repeat(20000) }),
    /最新使用者輸入/,
  );
  assert.equal(normalCalls + summaryCalls, requests);
  failSummary = true;
  await assert.rejects(
    runDeep({
      ...options,
      modelSettings: { contextWindowTokens: 16384, maxOutputTokens: 1024 },
    }),
    /summary failed/,
  );
  assert.deepEqual(
    store.conversations.load("owner").engineState,
    JSON.parse(JSON.stringify(saved)),
  );
  assert.ok(
    Number(
      store.conversations.db
        .prepare("SELECT count(*) AS n FROM messages WHERE channel='engine'")
        .get()!.n,
    ) >= 20,
  );
});
test("large tool output survives cancellation on disk with a complete tool checkpoint", async (t) => {
  const controller = new AbortController();
  let requests = 0,
    effects = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume request */
    }
    requests++;
    if (requests === 2) {
      controller.abort();
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      "data: " +
        JSON.stringify({
          id: "tool-plan",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "large-result",
                    type: "function",
                    function: { name: "large_result", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const dir = await mkdtemp(join(tmpdir(), "apsis-tool-offload-"));
  const store = await new Store(dir).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  await store.mutate((s) => s.sessions.push(session()));
  const text = "工具完整證據".repeat(5000);
  await assert.rejects(
    runDeep({
      store,
      workspace,
      session: store.conversations.load("owner"),
      mode: "deepagents",
      prompt: "fetch proof",
      allowWrites: false,
      modelSettings: { contextWindowTokens: 32768, maxOutputTokens: 1024 },
      env: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_ID: "fixture",
        COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      },
      signal: controller.signal,
      emit: () => {},
      extraTools: [
        {
          name: "large_result",
          label: "large",
          description: "Get proof",
          parameters: Type.Object({}),
          execute: async () => {
            effects++;
            return { content: [{ type: "text", text }], details: {} };
          },
        },
      ],
    }),
  );
  assert.equal(effects, 1);
  const saved = store.conversations.load("owner").engineState;
  const restored = restoreCheckpoint(saved)!;
  assert.equal(restored.messages.at(-1)?.type, "tool");
  assert.ok(checkpoint(restored));
  const path = String(restored.messages.at(-1)?.content).match(
    /\/tool-results\/[^ ]+\.txt/,
  )![0];
  const root = store.conversations.scratchRoot(
    "owner",
    store.conversations.activeId("owner"),
  );
  assert.equal(await readFile(join(root, path.slice(1)), "utf8"), text);
  store.conversations.db.close();
  const reopened = await new Store(dir).init();
  assert.deepEqual(reopened.conversations.load("owner").engineState, saved);
  assert.equal(await readFile(join(root, path.slice(1)), "utf8"), text);
  reopened.conversations.db.close();
});
