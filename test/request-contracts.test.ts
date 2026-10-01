import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.ts";

test("HTTP mutations reject unknown fields and wrong types before changing stored data", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-contract-"));
  const app = await createApp({
    dataDir: dir,
    globalSkillsDirectory: join(dir, "global-skills"),
  });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const bot = await app.product.bots.create("Contract Bot");
  const location = app.tasks.locations.ensure(bot.sessionId);
  const project = await app.tasks.projects.add({ name: "Contract Project" });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const cases: [string, string, unknown][] = [
    ["/api/v2/bots", "POST", { name: "invalid", skillIds: [] }],
    [`/api/v2/bots/${bot.id}`, "PATCH", { pinned: "false" }],
    [`/api/v2/bots/${bot.id}`, "PATCH", { model: 42 }],
    ["/api/v2/templates", "POST", { name: "invalid", messages: [] }],
    [
      `/api/v2/bots/${bot.id}/routines`,
      "POST",
      { name: "invalid", prompt: "p", cron: "0 8 * * *", enabled: "true" },
    ],
    [
      `/api/v2/bots/${bot.id}/memories`,
      "POST",
      { content: "p", source: { kind: "manual" } },
    ],
    [
      `/api/v2/projects/${project.id}/memories`,
      "POST",
      { content: "p", locked: "false" },
    ],
    [`/api/v2/projects/${project.id}`, "PATCH", { description: 123 }],
    ["/api/v2/projects", "POST", { name: "p", description: false }],
    [
      "/api/v2/permissions/preview",
      "POST",
      { botId: bot.id, tool: "shell", args: [], extra: true },
    ],
    [
      "/api/v2/connectors",
      "POST",
      { name: "c", url: "http://127.0.0.1:1", token: false },
    ],
    [`/api/v2/bots/${bot.id}/takeover`, "POST", { take: "true" }],
    [
      `/api/v2/bots/${bot.id}/artifact-reference`,
      "POST",
      { contextId: "c", artifactId: 12 },
    ],
    [`/api/v2/bots/${bot.id}/steer`, "POST", { prompt: "p" }],
    [
      "/api/connections",
      "POST",
      {
        name: "invalid",
        provider: "ollama",
        model: "m",
        url: "http://127.0.0.1:1",
        messages: [],
      },
    ],
    ["/api/connections/default", "PUT", { connectionId: bot.id, model: false }],
    [
      "/api/ollama/models",
      "POST",
      { url: "http://127.0.0.1:1", token: "ignored" },
    ],
    [
      "/api/compatible/models",
      "POST",
      { url: "http://127.0.0.1:1", apiKey: false },
    ],
    ["/api/skills", "POST", { name: "n", content: "c", agentId: bot.id }],
    [
      `/api/v2/work-locations/${location.id}/content`,
      "PUT",
      { path: "a.txt", content: false, revision: "0".repeat(64) },
    ],
    [
      `/api/v2/work-locations/${location.id}/directory`,
      "POST",
      { path: "folder", overwrite: true },
    ],
    [
      `/api/v2/work-locations/${location.id}/move`,
      "POST",
      { path: "a.txt", to: "b.txt", revision: false },
    ],
    [
      `/api/v2/work-locations/${location.id}/restore`,
      "POST",
      { id: "trash", path: 42 },
    ],
  ];
  for (const [path, method, body] of cases) {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
      body: JSON.stringify(body),
    });
    assert.equal(
      response.status,
      400,
      `${method} ${path}: ${await response.text()}`,
    );
  }
  assert.equal(app.product.db.bots.list().length, 1);
  assert.equal(app.product.db.bots.get(bot.id)!.pinned, false);
  assert.deepEqual(app.product.db.templates.list(), []);
  assert.deepEqual(app.product.db.routines.list(), []);
  assert.deepEqual(app.store.state.memories, []);
  assert.deepEqual(app.connections.view(), []);
});
