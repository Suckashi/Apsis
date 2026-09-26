import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp, type AppOptions } from "../server/app.ts";
import type {
  Approval,
  Bot,
  BotTemplate,
  Connector,
  Job,
  Routine,
} from "../shared/product.ts";
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
    await until(() => !app.tasks.running.size && !app.product.active.size);
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
  assert.equal(saved.data.revision, first.data.revision + 1);
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

test("templates copy preferences without secrets and per-bot choices reach the runner independently", async (t) => {
  const f = await fixture(t);
  await f.store.mutate((state) => {
    state.skills.push(
      { id: "skill-a", name: "A", content: "Skill A" },
      { id: "skill-b", name: "B", content: "Skill B" },
    );
  });
  for (const id of ["connector-a", "connector-b"])
    f.product.db.put<Connector>("connector", {
      id,
      name: id,
      url: "http://127.0.0.1:1/mcp",
      token: `${id}-secret`,
      enabled: true,
    });
  const alternate = await f.connections.save({
    name: "Alternate",
    provider: "ollama",
    model: "other-model",
    modelSettings: { "other-model": { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:1",
  });
  const response = await f.request("/api/v2/templates", "POST", {
    name: "Reusable",
    connectionId: f.connection.id,
    model: f.connection.model,
    skillIds: ["skill-a"],
    connectorIds: ["connector-a"],
    permissionMode: "workspace",
    apiKey: "fixture-api-secret",
    token: "connector-a-secret",
    messages: [{ content: "private-conversation" }],
  });
  assert.equal(response.status, 201);
  const template = response.data as BotTemplate;
  const stored = f.product.db.get<BotTemplate>("template", template.id)!;
  assert.deepEqual(stored, template);
  assert.deepEqual(
    Object.keys(stored).sort(),
    [
      "id",
      "name",
      "description",
      "avatar",
      "connectionId",
      "model",
      "skillIds",
      "connectorIds",
      "permissionMode",
      "permissionRules",
    ].sort(),
  );
  assert.doesNotMatch(
    JSON.stringify((await f.request("/api/v2/templates")).data),
    /fixture-api-secret|connector-a-secret|private-conversation/,
  );
  const a = await f.product.create("A", { templateId: template.id });
  const b = await f.product.create("B", { templateId: template.id });
  await f.product.update(b.id, {
    connectionId: alternate.id,
    model: alternate.model,
    skillIds: ["skill-b"],
    connectorIds: ["connector-b"],
  });
  assert.deepEqual(f.product.bot(a.id).skillIds, ["skill-a"]);
  assert.deepEqual(f.product.bot(a.id).connectorIds, ["connector-a"]);
  assert.deepEqual(f.product.db.get("template", template.id), stored);
  for (const bot of [a, b])
    await f.product.submit(bot.id, {
      requestId: randomUUID(),
      prompt: "verify choices",
    });
  await until(() => !f.product.active.size);
  assert.equal(f.calls.length, 2);
  for (const [bot, connection, skill, connector, excluded] of [
    [a, f.connection, "skill-a", "connector-a", "connector-b"],
    [b, alternate, "skill-b", "connector-b", "connector-a"],
  ] as const) {
    const call = f.calls.find((c) => c.session.id === bot.sessionId)!;
    assert.equal(call.agent?.connectionId, connection.id);
    assert.equal(call.env?.MODEL_ID, connection.model);
    assert.deepEqual(call.agent?.skillIds, [skill]);
    assert.ok(call.agent?.instructions.includes(connector));
    assert.ok(!call.agent?.instructions.includes(excluded));
    assert.doesNotMatch(
      call.agent!.instructions,
      /fixture-api-secret|connector-a-secret|connector-b-secret/,
    );
    await assert.rejects(
      f.product.authorize(bot.id, randomUUID(), "mcp_call", {
        connectorId: excluded,
      }),
      { status: 403 },
    );
  }
});

for (const inherited of [false, true]) {
  test(`legacy Codex ${inherited ? "default" : "explicit bot"} migration preserves history and requires reselection without resuming schedules`, async (t) => {
    const f = await fixture(t);
    const bot = await f.product.create(
      "Legacy",
      inherited
        ? {}
        : { connectionId: f.connection.id, model: f.connection.model },
    );
    const routine = await f.product.routine(bot.id, {
      name: "Scheduled",
      prompt: "routine",
      cron: "0 0 1 1 *",
      enabled: true,
    });
    await f.store.mutate((state) => {
      const session = state.sessions.find((s) => s.id === bot.sessionId)!;
      session.mode = "codex";
      session.agent!.engine = "codex";
      session.agent!.provider = "codex";
      session.messages.push({
        id: "historical",
        role: "assistant",
        content: "Keep this conversation",
        status: "complete",
      });
    });
    const history = structuredClone(f.tasks.view(bot.sessionId).messages);
    const rows = f.connections.rows.map((row) => ({
      ...row,
      provider: "codex",
    }));
    await f.close();
    // Only this isolated fixture's persisted connection is changed to emulate an old install.
    await writeFile(
      join(f.dir, "data", "connections.json"),
      JSON.stringify(rows),
    );
    const reopened = await fixture(t, undefined, f.dir);
    assert.equal(reopened.product.bot(bot.id).needsModelSelection, true);
    assert.equal(reopened.connections.defaultSelection(), null);
    assert.deepEqual(reopened.tasks.view(bot.sessionId).messages, history);
    assert.equal(
      reopened.product.db.get<Routine>("routine", routine.id)?.enabled,
      false,
    );
    await assert.rejects(
      reopened.product.submit(bot.id, {
        requestId: randomUUID(),
        prompt: "blocked",
      }),
      { status: 409 },
    );
    await assert.rejects(
      reopened.product.routine(bot.id, { enabled: true }, routine.id),
      { status: 409 },
    );
    await assert.rejects(
      reopened.product.routine(bot.id, {
        name: "New",
        prompt: "blocked",
        cron: "0 0 1 1 *",
        enabled: true,
      }),
      { status: 409 },
    );
    assert.equal(reopened.calls.length, 0);
    const selected = await reopened.connections.save({
      name: "Replacement",
      provider: "ollama",
      model: "replacement",
      modelSettings: { replacement: { contextWindowTokens: 128000 } },
      url: "http://127.0.0.1:1",
    });
    await reopened.product.update(bot.id, {
      connectionId: selected.id,
      model: selected.model,
    });
    assert.ok(!reopened.product.bot(bot.id).needsModelSelection);
    const job = await reopened.product.submit(bot.id, {
      requestId: randomUUID(),
      prompt: "resume explicitly",
    });
    await until(() => !reopened.product.active.size);
    assert.equal(
      reopened.product.db.get<Job>("job", job.id)?.status,
      "completed",
    );
    assert.equal(reopened.calls.length, 1);
    assert.equal(reopened.calls[0].env?.MODEL_ID, "replacement");
    assert.deepEqual(
      reopened.tasks.view(bot.sessionId).messages.slice(0, history.length),
      history,
    );
    assert.equal(
      reopened.product.db.get<Routine>("routine", routine.id)?.enabled,
      false,
    );
  });
}

async function rememberShell(
  f: Awaited<ReturnType<typeof fixture>>,
  bot: Bot,
  args: unknown,
) {
  f.product.settings.update(
    { approvalMode: "manual" },
    f.product.settings.read().revision,
  );
  const pending = f.product.authorize(bot.id, "remember-run", "shell", args);
  const approval = f.product.db
    .all<Approval>("approval")
    .find((a) => a.status === "pending")!;
  assert.ok(approval);
  f.product.decide(approval.id, { approved: true, remember: true });
  await pending;
  await f.product.authorize(bot.id, "reuse-run", "shell", args);
  assert.equal(f.product.db.all<Approval>("approval").length, 1);
}

test("permission deny defeats a remembered allow", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.create("Policy");
  const args = { command: "echo fixture", cwd: "." };
  await rememberShell(f, bot, args);
  f.product.settings.update({
    revision: f.product.settings.read().revision,
    permissionRules: [
      { id: "deny-shell", scope: "global", tool: "shell", effect: "deny" },
    ],
  });
  await assert.rejects(
    f.product.authorize(bot.id, "denied-run", "shell", args),
    { status: 403 },
  );
  assert.equal(f.product.pending.size, 0);
});

test("session approval precedes explicit ask, as in Kimi", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.create("Ask");
  const args = { command: "echo fixture", cwd: "." };
  await rememberShell(f, bot, args);
  await f.product.update(bot.id, {
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
  await f.product.authorize(bot.id, "fresh-run", "shell", args);
  assert.equal(f.product.pending.size, 0);
  assert.equal(f.product.db.all<Approval>("approval").length, 1);
});

test("a read-only parent's ceiling rejects child writes even when child policy allows them", async (t) => {
  const f = await fixture(t);
  const parent = await f.product.create("Parent", {
    permissionMode: "readonly",
  });
  const child = await f.product.create("Child", {
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
  await f.product.authorize(child.id, "independent-run", "write_file", {
    path: "proof.txt",
  });
  await assert.rejects(
    f.product.authorize(child.id, runId, "write_file", { path: "proof.txt" }),
    { status: 403 },
  );
  assert.equal(f.product.pending.size, 0);
});
