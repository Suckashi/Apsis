import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { Settings } from "../server/settings.ts";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/agent.ts";

test("retired gateway conversations migrate without losing messages, transcripts, memories or skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-migrate-"));
  const original = {
    sessions: ["hermes", "hybrid"].map((mode, i) => ({
      id: String(i),
      title: "Saved conversation",
      mode,
      createdAt: "2026-09-23",
      messages: [
        {
          id: "u",
          role: "user",
          content: "Keep this message",
          status: "complete",
        },
      ],
      piMessages: [
        { role: "user", content: "Keep this transcript", timestamp: 1 },
      ],
    })),
    memories: [{ id: "m", content: "Keep this fact" }],
    skills: [{ id: "s", name: "Procedure", content: "Keep these steps" }],
  };
  await writeFile(join(dir, "state.json"), JSON.stringify(original));
  const store = await new Store(dir).init();
  const expected = {
    ...original,
    schemaVersion: 1,
    sessions: original.sessions.map((s) => ({ ...s, mode: "pi" })),
  };
  assert.deepEqual(store.state, expected);
  assert.deepEqual((await new Store(dir).init()).state, expected);
});

test("retired settings are ignored and removed on save while active credentials survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-retired-settings-"));
  await writeFile(
    join(dir, "settings.json"),
    JSON.stringify({
      PI_PROVIDER: "openai",
      PI_MODEL: "gpt-4.1-mini",
      OPENAI_API_KEY: "keep-key",
      HERMES_URL: "http://127.0.0.1:8642",
      HERMES_MODEL: "old",
      HERMES_API_KEY: "retired-key",
    }),
  );
  const settings = await new Settings(dir, {
    HERMES_API_KEY: "ignored-env",
  }).init();
  assert.equal(settings.environment().HERMES_API_KEY, undefined);
  assert.equal(settings.environment().OPENAI_API_KEY, "keep-key");
  assert.ok(!JSON.stringify(settings.view()).includes("hermes"));
  await assert.rejects(settings.update("hermes", {}), { status: 400 });
  await settings.update("pi", { provider: "openai", model: "gpt-4.1-mini" });
  const persisted = await readFile(join(dir, "settings.json"), "utf8");
  assert.ok(!persisted.includes("HERMES"));
  assert.ok(!persisted.includes("retired-key"));
  assert.equal(
    (await new Settings(dir, {}).init()).environment().OPENAI_API_KEY,
    "keep-key",
  );
});

test("HTTP and tools no longer expose gateway execution", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-retired-api-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    env: {},
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
  });
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const post = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      body: JSON.stringify(data),
    });
  assert.equal((await post("/api/settings/hermes", {})).status, 404);
  for (const mode of ["hermes", "hybrid"])
    assert.equal((await post("/api/sessions", { mode })).status, 400);
  const status = await (await fetch(base + "/api/status")).json();
  assert.ok(!Object.hasOwn(status, "hermesReady"));
  const names = createTools({
    store: app.store,
    workspace: app.workspace,
    allowWrites: true,
  }).map((tool) => tool.name);
  assert.ok(!names.includes("delegate_to_hermes"));
  for (const name of [
    "remember",
    "update_memory",
    "read_skill",
    "search_history",
  ])
    assert.ok(names.includes(name));
});
