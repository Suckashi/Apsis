import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { createApp } from "../server/app.ts";
import type { RunOptions } from "../server/runtime.ts";
import { createTools } from "../server/tools.ts";
import type { Approval, Draft, Job, Routine } from "../shared/product.ts";
import type { PermissionRule } from "../shared/settings.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for job completion");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(
  runner: (options: RunOptions) => Promise<{ text: string }> = async () => ({
    text: "done",
  }),
) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-policy-integration-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner,
  });
  const connection = await app.tasks.connections!.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture",
    modelSettings: { fixture: { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:1/v1",
  });
  await app.tasks.connections!.setDefault({
    connectionId: connection.id,
    model: connection.model,
  });
  // Tests drive the scheduler explicitly so assertions cannot race its timer.
  clearInterval(app.product.timer);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return {
    ...app,
    directory,
    async post(path: string, body: unknown) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    async close() {
      await app.product.close();
      await until(() => !app.product.active.size && !app.tasks.running.size);
      app.server.closeAllConnections();
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
      app.product.db.db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function deny(tool: string, path?: string): PermissionRule {
  return {
    id: randomUUID(),
    scope: "global",
    tool,
    effect: "deny",
    ...(path === undefined ? {} : { path }),
  };
}

test("yolo executes guarded tools through the shared gate without model review or approval", async (t) => {
  const effects: string[] = [];
  const f = await fixture(async (options) => {
    for (const [name, args] of [
      ["shell", { command: "npm install fixture" }],
      ["mcp_call", { tool: "send", arguments: "{}" }],
      ["browser", { action: "click", selector: "#submit" }],
    ] as const) {
      const tools = createTools({
        ...options,
        extraTools: [
          {
            name,
            label: name,
            description: "fake effect",
            parameters: Type.Object({}),
            execute: async () => {
              effects.push(name);
              return { content: [{ type: "text", text: "done" }], details: {} };
            },
          },
        ],
      });
      await tools
        .filter((tool) => tool.name === name)
        .at(-1)!
        .execute(name, args, options.signal);
    }
    return { text: "done" };
  });
  t.after(f.close);
  const bot = await f.product.create();
  await f.product.submit(bot.id, {
    requestId: randomUUID(),
    prompt: "run fixtures",
  });
  await until(() => !f.product.active.size);
  assert.deepEqual(effects, ["shell", "mcp_call", "browser"]);
  assert.equal(f.product.db.all("approval").length, 0);
  const operations = [...f.tasks.runs.records.values()].flatMap(
    (run) => run.operations,
  );
  assert.equal(operations.length, 3);
  assert.ok(
    operations.every(
      (operation) => operation.authorization?.reason === "yolo-mode",
    ),
  );
});

test("dangerous commands stop before effects and cannot be remembered; preview uses the same policy", async (t) => {
  let effects = 0;
  const f = await fixture(async (options) => {
    await options.authorize!(
      "shell",
      { command: "rm -rf important" },
      options.signal,
    );
    effects++;
    return { text: "done" };
  });
  t.after(f.close);
  const bot = await f.product.create();
  const preview = await f.post("/api/v2/permissions/preview", {
    botId: bot.id,
    tool: "shell",
    args: { command: "rm -rf important" },
  });
  assert.equal(preview.data.reason, "dangerous-command");
  assert.equal(f.product.pending.size, 0);
  for (let i = 0; i < 2; i++) {
    await f.product.submit(bot.id, {
      requestId: randomUUID(),
      prompt: "fake destructive operation",
    });
    await until(() => f.product.pending.size === 1);
    assert.equal(effects, i);
    const approval = f.product.db
      .all<Approval>("approval")
      .find((a) => a.status === "pending")!;
    assert.equal(approval.rememberAllowed, false);
    f.product.decide(approval.id, { approved: true, remember: true });
    await until(() => !f.product.active.size);
  }
  assert.equal(f.product.db.all("session-allow").length, 0);
  assert.equal(effects, 2);
});

test("task grants inherit down delegation, survive retries, and do not leak into new contexts", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const parent = await f.product.create(),
    child = await f.product.create();
  f.product.settings.update({ approvalMode: "manual" }, 0);
  const args = { command: "echo granted" };
  const root = {
    ...job(parent.id, "root"),
    workContextId: f.tasks.store.conversations.activeId(parent.sessionId),
  };
  f.product.db.put("job", root);
  const pending = f.product.authorize(parent.id, "root", "shell", args);
  f.product.decide(f.product.db.all<Approval>("approval").at(-1)!.id, {
    approved: true,
    remember: true,
  });
  await pending;
  f.product.db.put("job", {
    ...job(child.id, "child", [parent.id, child.id]),
    parentJobId: root.id,
  });
  assert.equal(
    f.product.policy(child.id, "child", "shell", args).reason,
    "session-approval",
  );
  assert.equal(
    f.product.policy(child.id, "independent", "shell", args).effect,
    "ask",
  );
  f.product.db.put("job", {
    ...job(parent.id, "retry"),
    workContextId: root.workContextId,
    retryOf: root.id,
  });
  assert.equal(
    f.product.policy(parent.id, "retry", "shell", args).reason,
    "session-approval",
  );
  f.product.newContext(parent.id);
  assert.equal(f.product.policy(parent.id, "new", "shell", args).effect, "ask");
  assert.equal(
    f.product.policy(parent.id, "root", "shell", args).effect,
    "allow",
  );
  await f.product.update(parent.id, { permissionRules: [deny("shell")] });
  assert.equal(
    f.product.policy(child.id, "child", "shell", args).effect,
    "deny",
  );
});

test("legacy permanent grants are inert and current grants can be revoked", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create();
  f.product.settings.update({ approvalMode: "manual" }, 0);
  const args = { command: "echo fixture" };
  f.product.db.put("allow", {
    id: "old",
    botId: bot.id,
    key: f.product.approvalKey(bot.id, "one", "shell", args),
  });
  assert.equal(f.product.policy(bot.id, "one", "shell", args).effect, "ask");
  const pending = f.product.authorize(bot.id, "one", "shell", args);
  f.product.decide(f.product.db.all<Approval>("approval").at(-1)!.id, {
    approved: true,
    remember: true,
  });
  const receipt = await pending;
  const grant = f.product.db.all<{ id: string }>("session-allow")[0];
  f.product.db.remove("session-allow", grant.id);
  assert.notEqual(
    receipt.fingerprint,
    f.product.permissionFingerprint(bot.id, "one", "shell", args),
  );
  assert.equal(f.product.policy(bot.id, "one", "shell", args).effect, "ask");
});

test("task approval survives process restart without authorizing a new context", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-approval-restart-"));
  const options = {
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner: async () => ({ text: "fixture" }),
  };
  let app = await createApp(options);
  clearInterval(app.product.timer);
  t.after(async () => {
    await app.product.close();
    app.product.db.db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const bot = await app.product.create();
  app.product.settings.update({ approvalMode: "manual" }, 0);
  const args = { command: "echo persisted" };
  const pending = app.product.authorize(
    bot.id,
    "before-restart",
    "shell",
    args,
  );
  app.product.decide(app.product.db.all<Approval>("approval").at(-1)!.id, {
    approved: true,
    remember: true,
  });
  await pending;
  await app.product.close();
  app.product.db.db.close();
  app = await createApp(options);
  clearInterval(app.product.timer);
  assert.equal(
    app.product.policy(bot.id, "resumed", "shell", args).reason,
    "session-approval",
  );
  assert.equal(
    app.product.policy(bot.id, "resumed", "shell", {
      command: "echo different",
    }).effect,
    "ask",
  );
  app.product.newContext(bot.id);
  assert.equal(app.product.policy(bot.id, "new", "shell", args).effect, "ask");
});

test("permission changes between authorization and execution are rechecked without effects", async (t) => {
  let effects = 0;
  const f = await fixture(async (options) => {
    const tool = createTools({
      ...options,
      executeAuthorizedTool: async (_name, execute) => {
        f.product.settings.update(
          { approvalMode: "manual" },
          f.product.settings.read().revision,
        );
        return execute();
      },
      extraTools: [
        {
          name: "shell",
          label: "fixture",
          description: "fixture",
          parameters: Type.Object({}),
          execute: async () => {
            effects++;
            return { content: [{ type: "text", text: "done" }], details: {} };
          },
        },
      ],
    })
      .filter((tool) => tool.name === "shell")
      .at(-1)!;
    await tool.execute("fixture", { command: "echo changed" }, options.signal);
    return { text: "done" };
  });
  t.after(f.close);
  const bot = await f.product.create();
  await f.product.submit(bot.id, {
    requestId: randomUUID(),
    prompt: "fixture",
  });
  await until(() => f.product.pending.size === 1);
  assert.equal(effects, 0);
  // A deny introduced while the user reviews must prevent execution too.
  f.product.settings.update(
    { permissionRules: [deny("shell")] },
    f.product.settings.read().revision,
  );
  f.product.decide(f.product.db.all<Approval>("approval").at(-1)!.id, {
    approved: true,
    remember: true,
  });
  await until(() => !f.product.active.size);
  assert.equal(effects, 0);
  assert.equal(f.product.db.all("session-allow").length, 0);
  assert.equal(f.product.db.all<Job>("job")[0].status, "failed");
});

function job(botId: string, runId: string, permissionBotIds?: string[]): Job {
  return {
    id: randomUUID(),
    botId,
    runId,
    permissionBotIds,
    prompt: "fixture",
    status: "completed",
    createdAt: new Date().toISOString(),
  };
}

const forbidden = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "status" in error &&
  error.status === 403;

test("delegated routines retain parent denies through scheduled/manual runs and further delegation", async (t) => {
  let childId = "",
    grandchildId = "";
  let blocked = 0;
  const f = await fixture(async (options) => {
    const execute = (name: string, args: unknown) =>
      createTools(options)
        .find((tool) => tool.name === name)!
        .execute(randomUUID(), args, options.signal);
    if (options.prompt === "root") {
      await execute("delegate_task", { botId: childId, prompt: "schedule" });
    } else if (options.prompt === "schedule") {
      await execute("create_routine", {
        name: "Inherited policy",
        prompt: "scheduled",
        cron: "0 0 1 1 *",
        timezone: "UTC",
      });
    } else if (options.prompt === "scheduled") {
      await execute("delegate_task", {
        botId: grandchildId,
        prompt: "attempt read",
      });
    } else {
      assert.equal(options.prompt, "attempt read");
      await assert.rejects(
        execute("read_file", { path: "private/secret.txt" }),
        forbidden,
      );
      blocked++;
    }
    return { text: "done" };
  });
  t.after(f.close);
  const parent = await f.product.create("parent");
  childId = (await f.product.create("child")).id;
  grandchildId = (await f.product.create("grandchild")).id;
  await f.tasks.workspace.write("private/secret.txt", "must not escape");
  await f.product.update(parent.id, {
    permissionRules: [deny("read_file", "private")],
  });
  await f.product.submit(parent.id, {
    requestId: randomUUID(),
    prompt: "root",
  });
  await until(() => !f.product.active.size);
  const routines = f.product.db.all<Routine>("routine");
  assert.equal(routines.length, 1);
  const routine = routines[0];
  assert.deepEqual(routine.permissionBotIds, [parent.id, childId]);
  f.product.db.put("routine", {
    ...routine,
    nextAt: "2000-01-01T00:00:00.000Z",
  });
  await f.product.tick();
  await until(() => !f.product.active.size);
  assert.equal(blocked, 1);
  const manual = await f.post(`/api/v2/routines/${routine.id}/test`, {});
  assert.equal(manual.status, 200);
  await until(() => !f.product.active.size);
  assert.equal(blocked, 2);
  const jobs = f.product.db.all<Job>("job");
  assert.ok(
    jobs.every((entry) => entry.status === "completed"),
    JSON.stringify(jobs),
  );
  const descendants = jobs.filter((entry) => entry.botId === grandchildId);
  assert.equal(descendants.length, 2);
  for (const entry of descendants)
    assert.deepEqual(entry.permissionBotIds, [
      parent.id,
      childId,
      grandchildId,
    ]);
});

test("generated document and published copy destinations are authorized before filesystem writes", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create();
  const setRules = (permissionRules: PermissionRule[]) =>
    f.product.settings.update({
      revision: f.product.settings.read().revision,
      permissionRules,
    });
  for (const tool of ["*", "write_file"]) {
    setRules([deny(tool, "results")]);
    await assert.rejects(
      f.product.createDocument(bot, "run", {
        format: "docx",
        name: "report",
        content: "blocked",
      }),
      forbidden,
    );
    assert.deepEqual(await readdir(join(f.directory, "work")), []);
    assert.equal(f.product.db.all("artifact").length, 0);
  }
  await f.tasks.workspace.write("source.txt", "original");
  setRules([deny("write_file", "published")]);
  await assert.rejects(
    f.product.publish(bot, "run", "source.txt", "report"),
    forbidden,
  );
  assert.deepEqual(await readdir(join(f.directory, "work")), ["source.txt"]);
  assert.equal(await f.tasks.workspace.read("source.txt"), "original");
  assert.equal(f.product.db.all("artifact").length, 0);
  setRules([]);
  const artifact = await f.product.publish(bot, "run", "source.txt", "report");
  assert.match(artifact.path, /^published\//);
  assert.equal(await f.tasks.workspace.read(artifact.path), "original");
});

test("draft send rechecks connector selection, readonly and ancestor/global denies before contacting MCP", async (t) => {
  let calls = 0,
    requests = 0;
  const upstream = createServer(async (req, res) => {
    requests++;
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (message.method === "tools/call") calls++;
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : { content: [{ type: "text", text: "sent" }] };
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  const f = await fixture();
  t.after(f.close);
  const parent = await f.product.create("parent"),
    child = await f.product.create("child");
  const connector = f.product.db.put("connector", {
    id: randomUUID(),
    name: "MCP fixture",
    enabled: true,
    url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`,
  });
  for (const bot of [parent, child])
    await f.product.update(bot.id, { connectorIds: [connector.id] });
  f.product.db.put("job", job(child.id, "draft-run", [parent.id, child.id]));
  await f.product
    .tools(child, "draft-run")
    .find((tool) => tool.name === "create_draft")!
    .execute("draft", {
      title: "Note",
      connectorId: connector.id,
      tool: "send_note",
      arguments: "{}",
    });
  const draft = f.product.db.all<Draft>("draft")[0];
  const send = () =>
    f.post(`/api/v2/drafts/${draft.id}`, {
      action: "send",
      arguments: '{"text":"edited"}',
    });
  for (const owner of [parent, child]) {
    for (const restriction of [
      { connectorIds: [] },
      { permissionMode: "readonly" },
      { permissionRules: [deny("mcp_call")] },
    ]) {
      await f.product.update(owner.id, restriction);
      assert.equal((await send()).status, 403);
      assert.equal(f.product.db.get<Draft>("draft", draft.id)?.status, "draft");
      assert.equal(
        requests,
        0,
        "Rejected sends must not contact the connector",
      );
      await f.product.update(owner.id, {
        connectorIds: [connector.id],
        permissionMode: "workspace",
        permissionRules: [],
      });
    }
  }
  f.product.settings.update({
    revision: 0,
    permissionRules: [deny("mcp_call")],
  });
  assert.equal((await send()).status, 403);
  assert.equal(requests, 0);
  f.product.settings.update({ revision: 1, permissionRules: [] });
  const sent = await send();
  assert.equal(sent.status, 200);
  assert.equal(sent.data.status, "sent");
  assert.equal(calls, 1);
});

test("remembered approvals are task-scoped, precede asks, and never override denies", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const parent = await f.product.create("parent"),
    child = await f.product.create("child");
  f.product.db.put("job", job(child.id, "solo"));
  f.product.db.put("job", job(child.id, "delegated", [parent.id, child.id]));
  const args = { command: "echo fixture", cwd: "", timeoutSeconds: 1 };
  const controller = new AbortController();
  t.after(() => controller.abort());
  const approve = async (runId: string) => {
    const result = f.product.authorize(
      child.id,
      runId,
      "shell",
      args,
      controller.signal,
    );
    // Attach a handler immediately so cleanup cannot create an unhandled rejection.
    const outcome = result.then(
      () => null,
      (error: unknown) => error,
    );
    const pending = f.product.db
      .all<Approval>("approval")
      .filter((entry) => entry.status === "pending");
    assert.equal(pending.length, 1, "A fresh approval must be requested");
    f.product.decide(pending[0].id, { approved: true, remember: true });
    assert.equal(await outcome, null);
  };
  f.product.settings.update(
    { approvalMode: "manual" },
    f.product.settings.read().revision,
  );
  await approve("solo");
  await f.product.authorize(child.id, "solo", "shell", args, controller.signal);
  assert.equal(f.product.db.all<Approval>("approval").length, 1);
  await approve("delegated");
  assert.equal(f.product.db.all<Approval>("approval").length, 2);
  await f.product.authorize(
    child.id,
    "delegated",
    "shell",
    args,
    controller.signal,
  );
  assert.equal(f.product.db.all<Approval>("approval").length, 2);
  await f.product.update(parent.id, {
    permissionRules: [{ ...deny("shell"), effect: "ask" }],
  });
  await f.product.authorize(
    child.id,
    "delegated",
    "shell",
    args,
    controller.signal,
  );
  assert.equal(f.product.db.all<Approval>("approval").length, 2);
  await f.product.update(parent.id, { permissionRules: [deny("shell")] });
  await assert.rejects(
    f.product.authorize(
      child.id,
      "delegated",
      "shell",
      args,
      controller.signal,
    ),
    forbidden,
  );
  assert.equal(f.product.db.all<Approval>("approval").length, 2);
});
