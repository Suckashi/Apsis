import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../server/app.ts";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-codex-retired-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner: async () => {
      assert.fail("Retired Codex must never dispatch to another runner");
    },
  });
  t.after(async () => {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await app.product.close();
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  return { app, base };
}

const headers = {
  "content-type": "application/json",
  "x-apsis-client": "1",
};

test("Codex runtime and routes are removed, including the MCP header exemption", async (t) => {
  const { app, base } = await fixture(t);
  assert.equal("codex" in app, false);
  assert.equal("codex" in app.tasks, false);
  const status = await fetch(base + "/api/status");
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).runtimes, ["deepagents"]);

  for (const [path, method] of [
    ["/api/codex/status", "GET"],
    ["/api/codex/login", "POST"],
    [`/api/codex/mcp/${randomUUID()}`, "POST"],
  ]) {
    const response = await fetch(base + path, {
      method,
      headers,
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.equal(response.status, 404, path);
    assert.match((await response.json()).error, /找不到此頁面/);
  }

  const mcp = await fetch(base + "/api/codex/mcp/" + randomUUID(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(mcp.status, 403);
  assert.match((await mcp.json()).error, /請求標頭/);
});

test("Codex connections remain readable but cannot be created, tested, or selected", async (t) => {
  const { app, base } = await fixture(t);
  const id = randomUUID();
  // Model the persisted legacy row without enabling a new Codex connection.
  app.connections.rows.push({
    id,
    name: "Legacy Codex",
    provider: "codex",
    model: "legacy-model",
  });
  const listed = await fetch(base + "/api/connections");
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).some((row: { id: string }) => row.id === id));

  for (const [path, method, body] of [
    [
      "/api/connections",
      "POST",
      { name: "Codex", provider: "codex", model: "legacy-model" },
    ],
    [`/api/connections/${id}/test`, "POST", {}],
    [
      "/api/connections/default",
      "PUT",
      { connectionId: id, model: "legacy-model" },
    ],
  ] as const) {
    const response = await fetch(base + path, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, path);
    assert.match((await response.json()).error, /Codex.*(?:移除|停止支援)/);
  }
  assert.equal(app.connections.rows.length, 1);
  assert.equal(app.connections.rows[0].provider, "codex");
  assert.equal(app.connections.savedDefault, null);
});
