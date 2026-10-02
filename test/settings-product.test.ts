import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp, type AppOptions } from "../server/app.ts";
import type { Approval, Bot, BotTemplate, Job } from "../shared/product.ts";
import type { RunOptions } from "../server/runtime.ts";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for product state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(
  t: TestContext,
  runner?: AppOptions["runner"],
  directory?: string,
) {
  const dir =
    directory || (await mkdtemp(join(tmpdir(), "apsis-settings-product-")));
  const calls: RunOptions[] = [];
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    runner: async (options) => {
      calls.push(options);
      return runner ? runner(options) : { text: "Fixture completed" };
    },
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.product.close();
    await until(
      () => !app.tasks.running.size && !app.product.execution.active.size,
    );
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  };
  t.after(close);
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-apsis-client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const connection =
    app.connections.view()[0] ||
    (await app.connections.save({
      name: "Fixture",
      provider: "openai-compatible",
      model: "fixture-model",
      modelSettings: { "fixture-model": { contextWindowTokens: 128000 } },
      url: "http://127.0.0.1:1/v1",
      apiKey: "fixture-api-secret",
    }));
  if (!directory)
    await app.connections.setDefault({
      connectionId: connection.id,
      model: connection.model,
    });
  return { ...app, dir, calls, request, close, connection };
}

test("settings GET/PATCH persists updates and rejects stale revisions without overwriting", async (t) => {
  const f = await fixture(t);
  const first = await f.request("/api/v2/settings");
  assert.equal(first.status, 200);
  const saved = await f.request("/api/v2/settings", "PATCH", {
    revision: first.data.revision,
    locale: "en",
    maxTurns: 17,
  });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.data.revision, first.data.revision);
  assert.equal(saved.data.maxTurns, 17);
  const conflict = await f.request("/api/v2/settings", "PATCH", {
    revision: first.data.revision,
    locale: "zh-Hant",
    maxTurns: 99,
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual((await f.request("/api/v2/settings")).data, saved.data);
  await f.close();
  const reopened = await fixture(t, undefined, f.dir);
  assert.deepEqual(
    (await reopened.request("/api/v2/settings")).data,
    saved.data,
  );
});

async function rememberShell(
  f: Awaited<ReturnType<typeof fixture>>,
  bot: Bot,
  args: unknown,
) {
  f.product.settings.update(
    { approvalMode: "manual" },
    f.product.settings.read().revision,
  );
  const pending = f.product.approvals.authorize(
    bot.id,
    "remember-run",
    "shell",
    args,
  );
  const approval = f.product.db
    .all<Approval>("approval")
    .find((a) => a.status === "pending")!;
  assert.ok(approval);
  f.product.approvals.decide(approval.id, { approved: true, remember: true });
  await pending;
  await f.product.approvals.authorize(bot.id, "remember-run", "shell", args);
  assert.equal(f.product.db.all<Approval>("approval").length, 1);
}

test("permission deny defeats a remembered allow", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.bots.create("Policy");
  const args = { command: "pwd", cwd: "." };
  await rememberShell(f, bot, args);
  f.product.settings.update({
    revision: f.product.settings.read().revision,
    permissionRules: [
      { id: "deny-shell", scope: "global", tool: "shell", effect: "deny" },
    ],
  });
  await assert.rejects(
    f.product.approvals.authorize(bot.id, "denied-run", "shell", args),
    { status: 403 },
  );
  assert.equal(f.product.execution.pending.size, 0);
});

test("session approval precedes explicit ask, as in Kimi", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.bots.create("Ask");
  const args = { command: "pwd", cwd: "." };
  await rememberShell(f, bot, args);
  await f.product.bots.update(bot.id, {
    permissionRules: [
      {
        id: "ask-shell",
        scope: "bot",
        botId: bot.id,
        tool: "shell",
        effect: "ask",
      },
    ],
  });
  await f.product.approvals.authorize(bot.id, "remember-run", "shell", args);
  assert.equal(f.product.execution.pending.size, 0);
  assert.equal(f.product.db.all<Approval>("approval").length, 1);
});

test("a read-only parent's ceiling rejects child writes even when child policy allows them", async (t) => {
  const f = await fixture(t);
  const parent = await f.product.bots.create("Parent", {
    permissionMode: "readonly",
  });
  const child = await f.product.bots.create("Child", {
    permissionMode: "workspace",
    permissionRules: [
      {
        id: "allow-write",
        scope: "global",
        tool: "write_file",
        effect: "allow",
      },
    ],
  });
  // A child job carries the parent's ancestry even if delegated before the parent became read-only.
  const runId = randomUUID();
  f.product.db.put<Job>("job", {
    id: randomUUID(),
    botId: child.id,
    runId,
    status: "running",
    createdAt: new Date().toISOString(),
    prompt: "write",
    delegatedBy: parent.id,
    delegationPath: [parent.id, child.id],
  });
  await f.product.approvals.authorize(
    child.id,
    "independent-run",
    "write_file",
    {
      path: "proof.txt",
    },
  );
  await assert.rejects(
    f.product.approvals.authorize(child.id, runId, "write_file", {
      path: "proof.txt",
    }),
    { status: 403 },
  );
  assert.equal(f.product.execution.pending.size, 0);
});
