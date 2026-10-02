import { createServer } from "node:http";
import { runDeep } from "../server/engines/deep.ts";
import { createTools } from "../server/tools.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import type { RunOptions } from "../server/runtime.ts";
import { evaluatePolicy } from "../server/policy.ts";
import { Store } from "../server/store.ts";

const until = async (check: () => boolean) => {
  const end = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < end, "condition timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
async function fixture(runner: (o: RunOptions) => Promise<{ text: string }>) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-single-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    runner,
  });
  const c = await app.connections.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture",
    url: "http://127.0.0.1:1/v1",
  });
  await app.connections.setDefault({ connectionId: c.id, model: c.model });
  await app.product.bootstrap();
  const bot = app.product.db.bots.list()[0];
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v2`;
  return {
    ...app,
    bot,
    dir,
    async post(path: string, body: unknown) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    async cleanup() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("background A has independent session, model snapshot, steering, approval and stop while chat B completes", async (t) => {
  const options = new Map<string, RunOptions>();
  const steered: string[] = [];
  const f = await fixture(async (o) => {
    options.set(o.prompt, o);
    o.registerSteer?.(async (text, applied) => {
      steered.push(o.prompt + ":" + text);
      await applied?.();
    });
    if (o.prompt === "A") {
      await o.authorize?.(
        "shell",
        { command: "rm -rf important", cwd: "." },
        o.signal,
      );
      await new Promise<void>((done) =>
        o.signal.addEventListener("abort", () => done(), { once: true }),
      );
    }
    return { text: "Answer " + o.prompt };
  });
  t.after(f.cleanup);
  f.product.settings.update({
    revision: f.product.settings.read().revision,
    approvalMode: "auto",
    dangerousCommandGuard: false,
  });
  const a = (await f.post("/work", { requestId: "work-A", prompt: "A" })).data;
  await until(() =>
    f.product.db.approvals.list().some((p) => p.status === "pending"),
  );
  assert.notEqual(a.sessionId, f.bot.sessionId);
  const approval = f.product.db.approvals.list()[0];
  assert.equal(approval.sessionId, a.sessionId);
  assert.equal(approval.jobId, a.id);
  assert.equal(approval.rememberAllowed, false);
  assert.ok(
    f.product.db.events(0).some((event) => {
      const data = JSON.parse(String(event.value));
      return (
        data.jobId === a.id &&
        data.sessionId === a.sessionId &&
        data.runId === approval.runId
      );
    }),
  );
  const before = options.get("A")!.agent!.model;
  await f.product.bots.update(f.bot.id, { name: "Personal assistant" });
  const b = await f.post(`/bots/${f.bot.id}/messages`, {
    requestId: "chat-B",
    prompt: "B",
  });
  assert.equal(b.status, 202);
  await until(() => f.product.db.jobs.get("chat-B")?.status === "completed");
  assert.equal(options.get("B")!.session.id, f.bot.sessionId);
  assert.equal(options.get("A")!.agent!.model, before);
  assert.notEqual(
    options.get("A")!.workspace.root,
    options.get("B")!.workspace.root,
  );
  const live = f.product.db.jobs.get(a.id)!;
  const bad = await f.post(`/work/${a.id}/stop`, {
    sessionId: f.bot.sessionId,
    runId: live.runId,
  });
  assert.equal(bad.status, 409);
  assert.equal(
    (
      await f.post(`/work/${a.id}/steer`, {
        sessionId: a.sessionId,
        runId: live.runId,
        prompt: "A only",
        requestId: "steer-A",
      })
    ).status,
    200,
  );
  assert.deepEqual(steered, ["A:A only"]);
  assert.equal(
    (
      await f.post(`/work/${a.id}/stop`, {
        sessionId: a.sessionId,
        runId: live.runId,
      })
    ).status,
    200,
  );
  await until(() => f.product.db.jobs.get(a.id)?.status === "cancelled");
  assert.equal(f.product.db.jobs.get("chat-B")?.status, "completed");
  assert.equal(f.product.db.approvals.get(approval.id)?.status, "expired");
  const completed = f.product.db.jobs.get(a.id)!;
  f.product.jobs.reportCompletion(completed);
  f.product.jobs.reportCompletion(completed);
  assert.equal(
    f.store.conversations
      .page(f.bot.sessionId)
      .messages.filter((m) => m.id === `work-result-${a.id}`).length,
    1,
  );
});

test("same request enqueues one session; completion survives restart without replay", async (t) => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { text: "Persisted result" };
  });
  t.after(async () => {
    await f.cleanup();
  });
  const [a, b] = await Promise.all([
    f.post("/work", { requestId: "same", prompt: "task" }),
    f.post("/work", { requestId: "same", prompt: "task" }),
  ]);
  assert.equal(a.data.sessionId, b.data.sessionId);
  await until(
    () => f.product.db.jobs.get("same")?.completionMessageId !== undefined,
  );
  assert.equal(calls, 1);
  await f.close();
  const reopened = await createApp({
    dataDir: join(f.dir, "data"),
    workspaceDir: join(f.dir, "work"),
    runner: async () => {
      throw new Error("No replay allowed");
    },
  });
  try {
    assert.equal(reopened.product.db.jobs.get("same")?.status, "completed");
    assert.equal(
      reopened.store.conversations
        .page(f.bot.sessionId)
        .messages.filter((m) => m.id === "work-result-same").length,
      1,
    );
  } finally {
    await reopened.close();
  }
});

test("critical and unknown effects cannot bypass via modes, grants, allow rules or disabled command guard", () => {
  const operations = [
    { tool: "shell", command: "sudo chmod -R 777 /etc" },
    { tool: "shell", command: "python untrusted.py" },
    { tool: "shell", command: "git push origin main" },
    { tool: "shell", command: "some-unknown-program" },
    { tool: "write_file", path: "important.txt" },
    { tool: "write_file", path: ".profile" },
    {
      tool: "write_file",
      path: "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/new.cmd",
    },
    { tool: "write_file", path: "AGENTS.md" },
    { tool: "read_file", path: ".env" },
    { tool: "browser", action: "click" },
    { tool: "browser", action: "navigate" },
    { tool: "mcp_call" },
    { tool: "fetch_url" },
    { tool: "verify_web" },
    { tool: "unknown_tool" },
  ];
  for (const request of operations)
    for (const approvalMode of ["auto", "yolo", "manual"] as const) {
      const d = evaluatePolicy(
        [{ id: "allow-all", scope: "global", tool: "*", effect: "allow" }],
        request,
        {
          approvalMode,
          remembered: true,
          dangerousCommandGuard: false,
          targetExists: request.path === "important.txt",
        },
      );
      assert.equal(d.effect, "ask", JSON.stringify({ request, approvalMode }));
      assert.equal(d.explicitAsk, true);
      assert.equal(
        evaluatePolicy(
          [{ id: "deny", scope: "global", tool: "*", effect: "deny" }],
          request,
          { approvalMode },
        ).effect,
        "deny",
      );
    }
});

test("changed exact file target requires new approval; repeated calls never reuse critical consent", async (t) => {
  const f = await fixture(async () => ({ text: "done" }));
  t.after(f.cleanup);
  const bot = f.bot,
    runId = randomUUID();
  const location = f.product.workLocation(bot);
  await mkdir(location.path, { recursive: true });
  await writeFile(join(location.path, "important.txt"), "before");
  const pending = f.product.approvals.authorize(bot.id, runId, "write_file", {
    path: "important.txt",
    content: "after",
  });
  await until(() =>
    f.product.db.approvals.list().some((a) => a.status === "pending"),
  );
  const first = f.product.db.approvals
    .list()
    .find((a) => a.status === "pending")!;
  await writeFile(
    join(location.path, "important.txt"),
    "changed target content",
  );
  f.product.approvals.decide(first.id, { approved: true, remember: true });
  await until(() =>
    f.product.db.approvals
      .list()
      .some((a) => a.status === "pending" && a.id !== first.id),
  );
  const second = f.product.db.approvals
    .list()
    .find((a) => a.status === "pending")!;
  f.product.approvals.decide(second.id, { approved: true });
  await pending;
  assert.equal(f.product.db.all("session-allow").length, 0);
});

test("schema 4 is rejected intact before SQLite opens; new namespace and single-assistant entry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-old-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = JSON.stringify({
    schemaVersion: 4,
    projects: [],
    memories: [],
    skills: [],
  });
  await writeFile(join(dir, "state.json"), original);
  await writeFile(join(dir, "product.sqlite"), "old bytes");
  await assert.rejects(new Store(dir).init(), /schema 5/);
  assert.equal(await readFile(join(dir, "state.json"), "utf8"), original);
  assert.equal(
    await readFile(join(dir, "product.sqlite"), "utf8"),
    "old bytes",
  );
  const f = await fixture(async () => ({ text: "hello" }));
  t.after(f.cleanup);
  assert.equal(f.product.db.bots.list().length, 1);
  assert.equal((await f.post("/bots", { name: "Other" })).status, 409);
  assert.equal((await f.post("/templates", { name: "role" })).status, 410);
  assert.equal(
    f.product.toolRegistry
      .tools(f.bot, "test")
      .some((tool) => ["list_bots", "delegate_task"].includes(tool.name)),
    false,
  );
});

test("shared workspace waits outside capacity; approval yields capacity, main chat retains admission and stopping a waiter never starts it", async (t) => {
  const entered: string[] = [];
  let finishA!: () => void;
  const f = await fixture(async (o) => {
    entered.push(o.prompt);
    if (o.prompt === "A") {
      await o.authorize?.(
        "shell",
        { command: "unknown-host-action" },
        o.signal,
      );
      await new Promise<void>((done) => {
        finishA = done;
        o.signal.addEventListener("abort", () => done(), { once: true });
      });
    }
    return { text: o.prompt };
  });
  t.after(f.cleanup);
  f.product.settings.update({
    revision: f.product.settings.read().revision,
    maxConcurrent: 1,
  });
  const location = f.product.workLocation(f.bot);
  const a = await f.product.jobs.submit(
    f.bot.id,
    { requestId: "A", prompt: "A", contextKind: "routine" },
    {},
    location,
  );
  await until(() =>
    f.product.db.approvals.list().some((p) => p.status === "pending"),
  );
  const b = await f.product.jobs.submit(
    f.bot.id,
    { requestId: "B", prompt: "B", contextKind: "routine" },
    {},
    location,
  );
  const c = await f.product.jobs.submit(f.bot.id, {
    requestId: "C",
    prompt: "C",
    contextKind: "routine",
  });
  await until(() => f.product.db.jobs.get(c.id)?.status === "completed");
  assert.deepEqual(entered, ["A", "C"]);
  const liveB = f.product.db.jobs.get(b.id)!;
  assert.equal(
    (
      await f.post(`/work/${b.id}/stop`, {
        sessionId: liveB.sessionId,
        runId: liveB.runId,
      })
    ).status,
    200,
  );
  await until(() => f.product.db.jobs.get(b.id)?.status === "cancelled");
  const approval = f.product.db.approvals
    .list()
    .find((p) => p.status === "pending")!;
  f.product.approvals.decide(approval.id, { approved: true });
  await until(() => !!finishA);
  finishA();
  await until(() => f.product.db.jobs.get(a.id)?.status === "completed");
  assert.deepEqual(entered, ["A", "C"]);
  assert.equal(f.product.execution.active.size, 0);
});

test("background cap bounds independent jobs, settings/model snapshots stay fixed and chat has its own admission", async (t) => {
  const releases = new Map<string, () => void>();
  const entered: RunOptions[] = [];
  let live = 0,
    peak = 0;
  const f = await fixture(async (o) => {
    entered.push(o);
    if (o.prompt.startsWith("work")) {
      live++;
      peak = Math.max(peak, live);
      await new Promise<void>((done) => {
        releases.set(o.prompt, done);
        o.signal.addEventListener("abort", () => done(), { once: true });
      });
      live--;
    }
    return { text: o.prompt };
  });
  t.after(f.cleanup);
  f.product.settings.update({
    revision: f.product.settings.read().revision,
    maxConcurrent: 1,
    maxTurns: 12,
  });
  const a = await f.product.jobs.submit(f.bot.id, {
    requestId: "work1",
    prompt: "work1",
    contextKind: "routine",
  });
  await until(() => releases.has("work1"));
  const c = await f.connections.save({
    name: "Second fixture",
    provider: "openai-compatible",
    model: "other-fixture",
    url: "http://127.0.0.1:1/v1",
  });
  await f.product.bots.update(f.bot.id, { connectionId: c.id, model: c.model });
  const b = await f.product.jobs.submit(f.bot.id, {
    requestId: "work2",
    prompt: "work2",
    contextKind: "routine",
  });
  await f.product.messages.receiveMessage(f.bot.id, {
    requestId: "chat",
    prompt: "Chat while capped",
  });
  await until(() => f.product.db.jobs.get("chat")?.status === "completed");
  assert.equal(
    entered.find((o) => o.prompt === "work1")?.agent?.model,
    "fixture",
  );
  assert.equal(
    entered.find((o) => o.prompt === "Chat while capped")?.agent?.model,
    "other-fixture",
  );
  assert.equal(releases.has("work2"), false);
  releases.get("work1")!();
  await until(() => releases.has("work2"));
  releases.get("work2")!();
  await until(() => f.product.db.jobs.get(b.id)?.status === "completed");
  assert.equal(peak, 1);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(
    f.tasks.runs.records.get(f.product.db.jobs.get(a.id)!.runId!)?.jobId,
    a.id,
  );
});

test("a changed browser target requires fresh consent inside the execution boundary", async (t) => {
  let effects = 0;
  const f = await fixture(async (o) => {
    const args = { action: "click", selector: "#submit", url: "", text: "" };
    const receipt = await o.authorize?.("browser", args, o.signal);
    await o.executeAuthorizedTool?.(
      "browser",
      async () => {
        await o.checkToolPermission?.(
          "browser",
          args,
          o.signal,
          receipt || undefined,
        );
        effects++;
      },
      o.signal,
    );
    return { text: "done" };
  });
  t.after(f.cleanup);
  let targetLabel = "Save draft";
  f.product.browser.target = async (sessionId) => ({
    sessionId,
    url: "https://fixture.invalid",
    target: [
      {
        tag: "BUTTON",
        id: "submit",
        name: null,
        type: null,
        href: null,
        action: "/submit",
        label: targetLabel,
      },
    ],
  });
  const job = await f.product.jobs.submit(f.bot.id, {
    requestId: "browser-target",
    prompt: "Inspect target",
    contextKind: "routine",
  });
  await until(() =>
    f.product.db.approvals.list().some((a) => a.status === "pending"),
  );
  const first = f.product.db.approvals
    .list()
    .find((a) => a.status === "pending")!;
  targetLabel = "Send externally";
  f.product.approvals.decide(first.id, { approved: true });
  await until(() =>
    f.product.db.approvals
      .list()
      .some((a) => a.status === "pending" && a.id !== first.id),
  );
  assert.equal(effects, 0);
  const second = f.product.db.approvals
    .list()
    .find((a) => a.status === "pending")!;
  assert.match(JSON.stringify(second.args), /Send externally/);
  f.product.approvals.decide(second.id, { approved: false });
  await until(() => f.product.db.jobs.get(job.id)?.status === "failed");
  assert.equal(effects, 0);
});

test("separator aliases cannot downgrade an existing-file overwrite in auto or yolo", async (t) => {
  for (const approvalMode of ["auto", "yolo"] as const) {
    let entered = false;
    const f = await fixture(async (o) => {
      await o.workspace.write("docs/report.txt", "original");
      entered = true;
      const write = createTools(o).find((tool) => tool.name === "write_file")!;
      await write.execute(
        "alias-write",
        { path: "docs\\report.txt", content: "replacement" },
        o.signal,
      );
      return { text: "done" };
    });
    t.after(f.cleanup);
    f.product.settings.update({
      revision: f.product.settings.read().revision,
      approvalMode,
    });
    const job = await f.product.jobs.submit(f.bot.id, {
      requestId: randomUUID(),
      prompt: "alias",
    });
    await until(
      () =>
        entered &&
        f.product.db.approvals.list().some((a) => a.status === "pending"),
    );
    const approval = f.product.db.approvals
      .list()
      .find((a) => a.status === "pending")!;
    assert.equal(approval.reason, "critical-action");
    const target = join(approval.location!.path, "docs", "report.txt");
    assert.equal(await readFile(target, "utf8"), "original");
    f.product.approvals.decide(approval.id, { approved: false });
    await until(() => f.product.db.jobs.get(job.id)?.status === "failed");
    assert.equal(await readFile(target, "utf8"), "original");
  }
});

test("parallel same-target writes recheck consent under one canonical lock and leave main chat usable", async (t) => {
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let target = "";
  const f = await fixture(async (o) => {
    if (o.prompt !== "parallel writes") return { text: "main answer" };
    target = join(o.workspace.root, "docs", "report.txt");
    const tools = createTools({
      ...o,
      authorize: async (...args) => {
        const receipt = await o.authorize!(...args);
        if (++arrivals === 2) release();
        await gate;
        return receipt;
      },
    });
    const write = tools.find((tool) => tool.name === "write_file")!;
    const results = await Promise.allSettled([
      write.execute(
        "writer-one",
        { path: "docs/report.txt", content: "first" },
        o.signal,
      ),
      write.execute(
        "writer-two",
        { path: "docs\\report.txt", content: "second" },
        o.signal,
      ),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    return { text: "one writer completed; overwrite denied" };
  });
  t.after(f.cleanup);
  f.product.settings.update({
    revision: f.product.settings.read().revision,
    approvalMode: "auto",
    maxConcurrent: 1,
  });
  const job = await f.product.jobs.submit(f.bot.id, {
    requestId: randomUUID(),
    prompt: "parallel writes",
    contextKind: "routine",
  });
  await until(() =>
    f.product.db.approvals.list().some((a) => a.status === "pending"),
  );
  const approval = f.product.db.approvals
    .list()
    .find((a) => a.status === "pending")!;
  assert.equal(arrivals, 2, "both preliminary checks saw a missing target");
  assert.equal(approval.reason, "critical-action");
  assert.equal(approval.jobId, job.id);
  const before = await readFile(target, "utf8");
  assert.ok(["first", "second"].includes(before));
  const main = await f.product.jobs.submit(f.bot.id, {
    requestId: randomUUID(),
    prompt: "answer B",
  });
  await until(() => f.product.db.jobs.get(main.id)?.status === "completed");
  f.product.approvals.decide(approval.id, { approved: false });
  await until(() => f.product.db.jobs.get(job.id)?.status === "completed");
  assert.equal(await readFile(target, "utf8"), before);
});

test("completed background work reaches the checkpointed main assistant without a history search", async (t) => {
  const requests: { messages: unknown[] }[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const knowsResult = JSON.stringify(body.messages).includes(
      "WORK_RESULT_314",
    );
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "close",
    });
    res.end(
      `data: ${JSON.stringify({ id: `turn-${requests.length}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: knowsResult ? "The background result is 314." : "Ready." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  let backgroundExecutions = 0;
  const f = await fixture(async (o) => {
    if (o.prompt === "run independent work") {
      backgroundExecutions++;
      return { text: "WORK_RESULT_314" };
    }
    return runDeep({
      ...o,
      agent: undefined,
      env: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_ID: "fixture",
        COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      },
    });
  });
  t.after(f.cleanup);
  const first = await f.product.jobs.submit(f.bot.id, {
    requestId: randomUUID(),
    prompt: "Begin main conversation",
  });
  await until(() => f.product.db.jobs.get(first.id)?.status === "completed");
  assert.ok(f.tasks.store.conversations.load(f.bot.sessionId).engineState);
  const work = await f.product.jobs.submit(f.bot.id, {
    requestId: randomUUID(),
    prompt: "run independent work",
    contextKind: "routine",
  });
  await until(() => !!f.product.db.jobs.get(work.id)?.completionMessageId);
  f.product.jobs.reportCompletion(f.product.db.jobs.get(work.id)!);
  const followup = await f.product.jobs.submit(f.bot.id, {
    requestId: randomUUID(),
    prompt: "What did the background work find?",
  });
  await until(() => f.product.db.jobs.get(followup.id)?.status === "completed");
  assert.equal(
    f.product.db.jobs.get(followup.id)?.result,
    "The background result is 314.",
  );
  assert.equal(
    JSON.stringify(requests[1].messages).split("WORK_RESULT_314").length - 1,
    1,
  );
  assert.equal(backgroundExecutions, 1);
  assert.equal(
    requests.length,
    2,
    "followup sees result immediately without search or replay",
  );
});
