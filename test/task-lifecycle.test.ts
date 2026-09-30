import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp, type AppOptions } from "../server/app.ts";
import { RunStore } from "../server/runs.ts";
import {
  transitionJob,
  finishRun,
  finishDelivery,
} from "../server/task-lifecycle.ts";
import type { ChatMessage } from "../shared/types.ts";

async function fixture(t: TestContext, runner?: AppOptions["runner"]) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-lifecycle-"));
  const app = await createApp({
    dataDir: dir,
    globalSkillsDirectory: join(dir, "skills-global"),
    runner,
  });
  const cleanup = { expectedCloseFailure: false };
  t.after(async () => {
    if (cleanup.expectedCloseFailure)
      await assert.rejects(app.close(), /關機清理失敗/);
    else await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const connection = await app.connections.save({
    name: "Fixture",
    provider: "ollama",
    model: "fixture",
    url: "http://127.0.0.1:1",
  });
  await app.connections.setDefault({
    connectionId: connection.id,
    model: "fixture",
  });
  const bot = await app.product.bots.create("Fixture");
  return { dir, app, bot, cleanup };
}

test("shutdown waits for running jobs, cancels queued work and closes both databases once", async (t) => {
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const f = await fixture(t, async ({ signal }) => {
    resolveStarted();
    await new Promise<void>((_, reject) =>
      signal!.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      }),
    );
    return { text: "unreachable" };
  });
  f.app.server.listen(0, "127.0.0.1");
  await once(f.app.server, "listening");
  await f.app.product.jobs.submit(f.bot.id, {
    requestId: "running",
    prompt: "first",
  });
  await started;
  await f.app.product.jobs.submit(f.bot.id, {
    requestId: "queued",
    prompt: "second",
  });
  const closing = f.app.close();
  assert.equal(f.app.close(), closing);
  await closing;
  assert.equal(f.app.tasks.running.size, 0);
  assert.equal(f.app.tasks.runs.tails.size, 0);
  assert.equal(f.app.product.execution.active.size, 0);
  assert.equal(f.app.product.db.db.isOpen, false);
  assert.equal(f.app.store.conversations.db.isOpen, false);
  const reopened = await createApp({
    dataDir: f.dir,
    globalSkillsDirectory: join(f.dir, "skills-global"),
  });
  try {
    assert.equal(reopened.product.db.jobs.get("running")!.status, "cancelled");
    assert.equal(reopened.product.db.jobs.get("queued")!.status, "cancelled");
    assert.equal(reopened.tasks.runs.list()[0].status, "cancelled");
    assert.ok(
      reopened.store.conversations
        .page(f.bot.sessionId)
        .messages.every((m) => m.status !== "pending"),
    );
  } finally {
    await reopened.close();
  }
});

test("a progress journal write failure stops the run and never reports a successful reply", async (t) => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let entered = false;
  const f = await fixture(t, async ({ emit, signal }) => {
    entered = true;
    const blocked = join(app.store.directory, "blocked-journal");
    await writeFile(blocked, "not a directory");
    app.tasks.runs.directory = blocked;
    emit({ type: "commentary", id: "progress", text: "working" });
    await new Promise<void>((resolve) =>
      signal!.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { text: "must not be committed" };
  });
  app = f.app;
  await assert.rejects(app.tasks.run(f.bot.sessionId, "write failure", false));
  assert.ok(entered);
  const run = app.tasks.runs.list()[0];
  assert.equal(run.status, "failed");
  assert.match(run.error!, /任務日誌寫入失敗/);
  assert.equal(app.tasks.running.size, 0);
  const messages = app.store.conversations.page(f.bot.sessionId).messages;
  assert.equal(messages.find((m) => m.role === "user")!.status, "failed");
  assert.ok(!messages.some((m) => m.content === "must not be committed"));
  await assert.rejects(app.tasks.runs.flush(), /任務日誌寫入失敗/);
  app.tasks.runs.directory = join(f.dir, "runs");
  await app.tasks.runs.save(run);
  await app.tasks.runs.flush();
  assert.equal(app.tasks.runs.tails.size, 0);
  const journal = JSON.parse(
    await readFile(join(f.dir, "runs", run.id + ".json"), "utf8"),
  );
  assert.equal(journal.status, "failed");
});

test("shutdown exposes flush errors and still releases both database handles", async (t) => {
  const f = await fixture(t, async () => ({ text: "done" }));
  await f.app.tasks.run(f.bot.sessionId, "first", false);
  const run = f.app.tasks.runs.list()[0];
  const blocked = join(f.dir, "blocked");
  await writeFile(blocked, "not a directory");
  f.app.tasks.runs.directory = blocked;
  await assert.rejects(f.app.tasks.runs.save(run));
  const closing = f.app.product.close();
  assert.equal(f.app.product.close(), closing);
  await assert.rejects(closing, /關機清理失敗/);
  assert.equal(f.app.product.db.db.isOpen, false);
  assert.equal(f.app.store.conversations.db.isOpen, false);
  // The expected failure remains observable for repeat callers.
  f.cleanup.expectedCloseFailure = true;
});

test("restart interrupts in-flight journals and marks unfinished operations unknown", async (t) => {
  const f = await fixture(t, async ({ recordOperation }) => {
    await recordOperation!({
      id: "write",
      name: "write_file",
      status: "started",
      mutating: true,
      startedAt: new Date().toISOString(),
    });
    throw new Error("fixture failure");
  });
  await assert.rejects(f.app.tasks.run(f.bot.sessionId, "first", false));
  const run = f.app.tasks.runs.list()[0];
  // Simulate the durable snapshot left by abrupt process termination.
  await f.app.tasks.runs.save({
    ...run,
    status: "running",
    endedAt: undefined,
    operations: run.operations.map((op) => ({ ...op, status: "started" })),
  });
  const recovered = await new RunStore(f.dir).init();
  assert.equal(recovered.list()[0].status, "interrupted");
  assert.equal(recovered.list()[0].operations[0].status, "unknown");
  assert.ok(recovered.list()[0].operations[0].endedAt);
  assert.throws(
    () => finishRun(recovered.list()[0], "completed"),
    /Invalid run transition/,
  );
  assert.throws(
    () =>
      transitionJob(
        {
          id: "a",
          botId: "b",
          prompt: "p",
          createdAt: "now",
          status: "completed",
        },
        "running",
      ),
    /Invalid job transition/,
  );
  const message: ChatMessage = {
    id: "steer",
    role: "user",
    content: "p",
    status: "complete",
    delivery: { kind: "steer", state: "pending", updatedAt: "now" },
  };
  const applied = finishDelivery(message, "applied");
  assert.equal(finishDelivery(applied, "not-applied"), applied);
});

test("restart reconciles completion between journals, transcripts and queued job records", async (t) => {
  const f = await fixture(t, async () => ({ text: "committed reply" }));
  await f.app.tasks.run(f.bot.sessionId, "committed", false);
  const committed = f.app.tasks.runs.list()[0];
  f.app.product.db.jobs.put({
    id: "finished-job",
    botId: f.bot.id,
    prompt: "committed",
    createdAt: committed.createdAt,
    status: "running",
    runId: committed.id,
  });
  // Model result journal landed, but process died before the transcript transaction.
  const incomplete = {
    ...committed,
    id: "00000000-0000-4000-8000-000000000001",
    text: "uncommitted reply",
  };
  f.app.store.conversations.append(f.bot.sessionId, {
    id: "pending-user",
    runId: incomplete.id,
    role: "user",
    content: "uncommitted",
    status: "pending",
  });
  await f.app.tasks.runs.save(incomplete);
  f.app.product.db.jobs.put({
    id: "incomplete-job",
    botId: f.bot.id,
    prompt: "uncommitted",
    createdAt: incomplete.createdAt,
    status: "running",
    runId: incomplete.id,
  });
  await f.app.close();
  const reopened = await createApp({
    dataDir: f.dir,
    globalSkillsDirectory: join(f.dir, "skills-global"),
  });
  try {
    assert.equal(
      reopened.tasks.runs.records.get(committed.id)!.status,
      "completed",
    );
    assert.equal(
      reopened.product.db.jobs.get("finished-job")!.status,
      "completed",
    );
    assert.equal(
      reopened.product.db.jobs.get("finished-job")!.result,
      "committed reply",
    );
    assert.equal(
      reopened.tasks.runs.records.get(incomplete.id)!.status,
      "interrupted",
    );
    assert.equal(
      reopened.product.db.jobs.get("incomplete-job")!.status,
      "interrupted",
    );
    const messages = reopened.store.conversations.page(
      f.bot.sessionId,
    ).messages;
    assert.equal(
      messages.find((m) => m.id === "pending-user")!.status,
      "failed",
    );
    assert.ok(!messages.some((m) => m.content === "uncommitted reply"));
  } finally {
    await reopened.close();
  }
});

test("a final journal failure leaves a failed request and no committed success reply", async (t) => {
  const f = await fixture(t, async () => ({ text: "uncommitted success" }));
  const save = f.app.tasks.runs.save.bind(f.app.tasks.runs);
  let failed = false;
  f.app.tasks.runs.save = (run) => {
    if (run.status === "completed" && !failed) {
      failed = true;
      return Promise.reject(new Error("injected final write failure"));
    }
    return save(run);
  };
  await assert.rejects(
    f.app.tasks.run(f.bot.sessionId, "final write", false),
    /任務日誌寫入失敗/,
  );
  const messages = f.app.store.conversations.page(f.bot.sessionId).messages;
  assert.ok(
    !messages.some((message) => message.content === "uncommitted success"),
  );
  assert.equal(
    messages.find((message) => message.role === "user")!.status,
    "failed",
  );
  assert.equal(f.app.tasks.runs.list()[0].status, "failed");
  await f.app.tasks.runs.flush();
});

test("application shutdown drains admitted HTTP mutations before releasing storage", async (t) => {
  const f = await fixture(t);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mutate = f.app.store.mutate.bind(f.app.store);
  f.app.store.mutate = async (operation) => {
    entered();
    await gate;
    return mutate(operation);
  };
  f.app.server.listen(0, "127.0.0.1");
  await once(f.app.server, "listening");
  const base = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
  const request = fetch(base + `/api/v2/bots/${f.bot.id}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
    body: JSON.stringify({ content: "admitted mutation" }),
  });
  await started;
  const closing = f.app.close();
  assert.ok(f.app.store.conversations.db.isOpen);
  assert.ok(f.app.product.db.db.isOpen);
  release();
  assert.equal((await request).status, 200);
  await closing;
  assert.equal(f.app.product.db.db.isOpen, false);
  assert.equal(f.app.store.state.memories[0].content, "admitted mutation");
});
