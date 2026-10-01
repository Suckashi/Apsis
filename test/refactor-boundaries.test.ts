import { once } from "node:events";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { ProductDB } from "../server/product-db.ts";
import { restoreCheckpoint } from "../server/context-checkpoint.ts";
import { parseMessage } from "../server/message-schema.ts";
import type { RunOptions } from "../server/runtime.ts";
import type { Bot } from "../shared/product.ts";

async function directory(
  t: TestContext,
  close: () => void | Promise<void> = () => {},
) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-refactor-"));
  t.after(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("old state is rejected before opening databases or rewriting user files", async (t) => {
  const dir = await directory(t);
  const original = JSON.stringify({
    schemaVersion: 3,
    agents: [],
    sessions: [],
    memories: [],
    skills: [],
  });
  await writeFile(join(dir, "state.json"), original);
  await assert.rejects(new Store(dir).init(), /schema 4/);
  assert.equal(await readFile(join(dir, "state.json"), "utf8"), original);
  assert.deepEqual(await readdir(dir), ["state.json"]);
});

test("a missing current conversation database never creates empty replacement history", async (t) => {
  const dir = await directory(t);
  await writeFile(
    join(dir, "state.json"),
    JSON.stringify({
      schemaVersion: 4,
      projects: [],
      memories: [],
      skills: [],
    }),
  );
  await assert.rejects(new Store(dir).init(), /對話資料庫遺失/);
  assert.deepEqual(await readdir(dir), ["state.json"]);
});

test("a missing knowledge file never resets an existing store", async (t) => {
  const dir = await directory(t);
  const store = await new Store(dir).init();
  store.conversations.db.close();
  await rm(join(dir, "state.json"));
  await assert.rejects(new Store(dir).init(), /知識資料檔遺失/);
  assert.ok(!(await readdir(dir)).includes("state.json"));
});

test("Bot config resolves afresh between runs and transcripts never rewrite knowledge", async (t) => {
  let app: Awaited<ReturnType<typeof createApp>>;
  const dir = await directory(t, () => app.close());
  const seen: { name?: string; model?: string; displayName?: string }[] = [];
  let first!: RunOptions;
  app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    globalSkillsDirectory: join(dir, "global-skills"),
    runner: async (options) => {
      first ||= options;
      seen.push({
        name: options.agent?.name,
        model: options.agent?.model,
        displayName: options.modelSettings?.displayName,
      });
      return { text: "done" };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const connection = await app.connections.save({
    name: "Fixture",
    provider: "ollama",
    model: "first",
    url: "http://127.0.0.1:1",
    modelSettings: { first: { displayName: "First model" } },
  });
  await app.connections.setDefault({
    connectionId: connection.id,
    model: "first",
  });
  const bot = await app.product.bots.create("First Bot");
  const knowledge = await readFile(app.store.file, "utf8");
  await app.tasks.run(bot.sessionId, "first prompt", false);
  await app.product.bots.update(bot.id, { name: "Renamed Bot" });
  await app.connections.save(
    {
      name: "Fixture",
      provider: "ollama",
      model: "second",
      url: "http://127.0.0.1:1",
      modelSettings: { second: { displayName: "Second model" } },
    },
    connection.id,
  );
  await app.connections.setDefault({
    connectionId: connection.id,
    model: "second",
  });
  await app.tasks.run(bot.sessionId, "second prompt", false);
  assert.deepEqual(seen, [
    { name: "First Bot", model: "first", displayName: "First model" },
    { name: "Renamed Bot", model: "second", displayName: "Second model" },
  ]);
  assert.equal(first.agent?.name, "First Bot");
  assert.equal(first.modelSettings?.displayName, "First model");
  assert.equal(await readFile(app.store.file, "utf8"), knowledge);
  assert.ok(!(await readdir(app.store.directory)).includes("state.json.bak"));
  const session = app.store.conversations.metadata(bot.sessionId);
  assert.equal(session.botId, bot.id);
  for (const field of ["agent", "provider", "connectionId", "model", "mode"])
    assert.ok(!Object.hasOwn(session, field));
  assert.equal(app.store.conversations.page(bot.sessionId).messages.length, 4);
  const response = await fetch(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/storage/backup`,
  );
  assert.equal(response.status, 200);
  const backup = await response.json();
  assert.equal(backup.version, 4);
  assert.equal(backup.state.schemaVersion, 4);
  assert.ok(!Object.hasOwn(backup.state, "sessions"));
  assert.ok(!Object.hasOwn(backup.state, "agents"));
  assert.ok(JSON.stringify(backup.conversations).includes("second prompt"));
});

test("repository filters isolate Bot records and failed transactions roll back", async (t) => {
  let db: ProductDB;
  const dir = await directory(t, () => db.db.close());
  db = await new ProductDB().init(dir);
  const bot = (id: string, sessionId: string): Bot => ({
    id,
    sessionId,
    name: id,
    readAt: new Date().toISOString(),
    description: "",
    avatar: "orbit",
    pinned: false,
    hidden: false,
    createdAt: new Date().toISOString(),
  });
  db.bots.put(bot("a", "session-a"));
  db.bots.put(bot("b", "session-b"));
  assert.deepEqual(
    db.bots.list({ sessionId: "session-a" }).map((b) => b.id),
    ["a"],
  );
  assert.deepEqual(db.bots.list({ id: "' OR 1=1 --" }), []);
  assert.throws(
    () =>
      db.transaction(() => {
        db.bots.remove("a");
        db.bots.put(bot("c", "session-c"));
        throw new Error("abort");
      }),
    /abort/,
  );
  assert.deepEqual(
    db.bots.list().map((b) => b.id),
    ["a", "b"],
  );
});

test("message and checkpoint boundaries accept only the current contract", () => {
  assert.deepEqual(parseMessage({ requestId: "id", prompt: "hello" }), {
    requestId: "id",
    prompt: "hello",
  });
  for (const input of [
    { requestId: "id", prompt: "hello", mode: "codex" },
    { requestId: "id", prompt: "hello", fileReferences: [null] },
    { requestId: "id", prompt: "hello", artifactIds: [123] },
  ]) {
    assert.throws(
      () => parseMessage(input),
      (error: unknown) => (error as { status?: number }).status === 400,
    );
  }
  assert.throws(() => restoreCheckpoint({ messages: [] }), /引擎版本/);
  assert.throws(
    () =>
      restoreCheckpoint({
        version: 0,
        engine: "deepagents@1.14.0",
        messages: [],
      }),
    /checkpoint 版本/,
  );
  assert.deepEqual(
    restoreCheckpoint({ version: 1, engine: "deepagents@1.14.0", messages: [] })
      ?.messages,
    [],
  );
});
