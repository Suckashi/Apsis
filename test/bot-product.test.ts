import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import type { RunOptions } from "../server/runtime.ts";
import type { Job, Approval, Draft } from "../shared/product.ts";
import { createTools } from "../server/tools.ts";
import { randomUUID } from "node:crypto";
import type { TaskRun } from "../shared/types.ts";

async function until(fn: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for state");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function fixture(
  runner: (o: RunOptions) => Promise<{ text: string }> = async (o) => ({
    text: `完成：${o.prompt}`,
  }),
) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-bots-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    runner,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return { response, data };
  };
  const connection = await app.tasks.connections!.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture-model",
    modelSettings: { "fixture-model": { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:1/v1",
  });
  await app.tasks.connections!.setDefault({
    connectionId: connection.id,
    model: connection.model,
  });
  const close = async () => {
    await app.product!.close();
    await until(() => !app.tasks.running.size);
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  };
  return { ...app, dir, base, request, close, product: app.product! };
}

test("task summaries cover old runs while scoped history loads only on request", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const owner = await f.product.create("owner"),
    other = await f.product.create("other");
  const records: TaskRun[] = [];
  for (let i = 0; i < 32; i++) {
    const record: TaskRun = {
      id: randomUUID(),
      sessionId: owner.sessionId,
      engine: "deepagents",
      agentName: owner.name,
      model: "test",
      permissions: { files: true, memory: true, skills: true },
      createdAt: new Date(i * 1000).toISOString(),
      endedAt: new Date(i * 1000 + 500).toISOString(),
      status: "completed",
      text: "result",
      activity: [],
      operations: [
        {
          id: randomUUID(),
          name: "read_file",
          status: "succeeded",
          startedAt: new Date(i * 1000).toISOString(),
          mutating: false,
          evidence: { output: "historic evidence" },
        },
      ],
    };
    records.push(record);
    await f.tasks.runs.save(record);
  }
  const detail = await f.request(`/api/v2/bots/${owner.id}?view=summary`);
  assert.equal(detail.data.runSummaries.length, 32);
  assert.equal(detail.data.runs.length, 0);
  assert.doesNotMatch(JSON.stringify(detail.data), /historic evidence/);
  assert.equal(
    (await f.request(`/api/v2/bots/${owner.id}`)).data.runs.length,
    30,
  );
  const history = await f.request(
    `/api/v2/bots/${owner.id}/runs/${records[0].id}`,
  );
  assert.equal(history.response.status, 200);
  assert.equal(
    history.data.run.operations[0].evidence.output,
    "historic evidence",
  );
  assert.equal(
    (await f.request(`/api/v2/bots/${other.id}/runs/${records[0].id}`)).response
      .status,
    404,
  );
});

test("durable tool boundaries notify SSE subscribers before the task finishes", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (o) => {
    await o.recordOperation!({
      id: "long-read",
      name: "read_file",
      target: "report.pdf",
      status: "started",
      startedAt: new Date().toISOString(),
      mutating: false,
    });
    await gate;
    await o.recordOperation!({
      id: "long-read",
      name: "read_file",
      target: "report.pdf",
      status: "succeeded",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      mutating: false,
    });
    return { text: "done" };
  });
  t.after(async () => {
    release();
    await f.close();
  });
  const owner = await f.product.create("owner");
  const controller = new AbortController();
  const response = await fetch(`${f.base}/api/v2/events`, {
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  await reader.read();
  const before = Number(f.product.db.events(0).at(-1)!.id);
  await f.product.submit(owner.id, { requestId: randomUUID(), prompt: "read" });
  await until(
    () =>
      f.product.detail(owner.id).currentProgress?.label ===
      "正在讀取文件 report.pdf",
  );
  assert.equal(f.product.detail(owner.id).runSummaries[0].status, "running");
  assert.ok(f.product.db.events(before).length > 0);
  const event = await reader.read();
  assert.match(new TextDecoder().decode(event.value), /data:/);
  controller.abort();
  release();
  await until(() => !f.product.active.size);
  const reconnect = new AbortController();
  const resumed = await fetch(`${f.base}/api/v2/events`, {
    headers: { "Last-Event-ID": String(before) },
    signal: reconnect.signal,
  });
  const resumedReader = resumed.body!.getReader();
  assert.match(
    new TextDecoder().decode((await resumedReader.read()).value),
    /data:/,
  );
  assert.equal(f.product.detail(owner.id).runSummaries[0].status, "completed");
  reconnect.abort();
});

test("Bot customization validates before creation and persists edits", async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal((await f.request("/api/sessions")).response.status, 404);
  const invalid = await f.request("/api/v2/bots", "POST", {
    name: "Test",
    avatar: "invalid",
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(f.product.snapshot().bots.length, 0);
  assert.equal(f.store.state.sessions.length, 0);
  const created = await f.request("/api/v2/bots", "POST", {
    name: "研究員",
    avatar: "cloud",
    description: "每次附上來源。",
  });
  assert.equal(created.response.status, 201);
  const id = created.data.id;
  assert.equal(f.product.bot(id).avatar, "cloud");
  assert.equal(f.product.bot(id).description, "每次附上來源。");
  await f.request(`/api/v2/bots/${id}`, "PATCH", {
    avatar: "bloom",
    name: "寫作助理",
  });
  const invalidEdit = await f.request(`/api/v2/bots/${id}`, "PATCH", {
    avatar: "invalid",
    name: "不應保存",
  });
  assert.equal(invalidEdit.response.status, 400);
  assert.equal(f.product.bot(id).name, "寫作助理");
  assert.equal(f.product.bot(id).avatar, "bloom");
});

test("interrupted task notice can be dismissed without deleting the task", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create("測試 Bot");
  const other = await f.product.create("另一個 Bot");
  const job: Job = {
    id: "interrupted-notice",
    botId: bot.id,
    prompt: "尚未完成的任務",
    createdAt: new Date().toISOString(),
    status: "interrupted",
    error: "服務重新啟動。",
  };
  f.product.db.put("job", job);
  const path = `/api/v2/bots/${bot.id}/jobs/${job.id}/dismiss`;
  assert.equal(
    (
      await f.request(
        `/api/v2/bots/${other.id}/jobs/${job.id}/dismiss`,
        "POST",
        {},
      )
    ).response.status,
    404,
  );
  assert.equal((await f.request(path, "POST", {})).response.status, 200);
  assert.equal((await f.request(path, "POST", {})).response.status, 200);
  const saved = f.product.db.get<Job>("job", job.id)!;
  assert.equal(saved.status, "interrupted");
  assert.ok(saved.dismissedAt);
  assert.equal(
    f.product.detail(bot.id).jobs.find((j) => j.id === job.id)?.dismissedAt,
    saved.dismissedAt,
  );
});

test("deleting Bot cancels approval and queue, removes owned data and leaves other Bots intact", async (t) => {
  let effects = 0;
  const f = await fixture(async (o) => {
    await o.authorize?.("shell", { command: o.prompt }, o.signal);
    effects++;
    return { text: "done" };
  });
  t.after(f.close);
  f.product.settings.update(
    {
      permissionRules: [
        { id: "fixture-shell", scope: "global", tool: "shell", effect: "ask" },
      ],
    },
    f.product.settings.read().revision,
  );
  const bot = await f.product.create("刪除測試");
  const other = await f.product.create("保留");
  await f.product.routine(bot.id, {
    name: "排程",
    prompt: "工作",
    cron: "0 9 * * *",
  });
  for (const kind of ["allow", "artifact", "draft", "preferences"])
    f.product.db.put(kind, { id: `delete-${kind}`, botId: bot.id });
  await f.product.submit(bot.id, {
    requestId: "delete-running",
    prompt: "wait",
  });
  await until(() => f.product.pending.size === 1);
  await f.product.submit(bot.id, {
    requestId: "delete-queued",
    prompt: "never",
  });
  const removed = await f.request(`/api/v2/bots/${bot.id}`, "DELETE");
  assert.equal(removed.response.status, 200);
  assert.equal(effects, 0);
  assert.equal(f.product.pending.size, 0);
  assert.equal(f.product.active.has(bot.id), false);
  assert.deepEqual(
    f.product.snapshot().bots.map((b) => b.id),
    [other.id],
  );
  assert.equal(
    f.store.state.sessions.some((s) => s.id === bot.sessionId),
    false,
  );
  assert.equal(
    f.store.state.agents?.some((a) => a.id === bot.id),
    false,
  );
  for (const kind of [
    "job",
    "approval",
    "allow",
    "artifact",
    "draft",
    "routine",
    "preferences",
  ])
    assert.equal(
      f.product.db
        .all<{ botId?: string }>(kind)
        .some((row) => row.botId === bot.id),
      false,
    );
  assert.equal(
    (await f.request(`/api/v2/bots/${bot.id}`)).response.status,
    404,
  );
  assert.equal(
    (await f.request(`/api/v2/bots/${bot.id}`, "DELETE")).response.status,
    404,
  );
  await f.product.tick();
  assert.equal(effects, 0);
});

test("Bot deletion waits for outgoing draft to settle", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create();
  f.product.db.put("draft", {
    id: "outgoing",
    botId: bot.id,
    status: "sending",
  });
  assert.equal(
    (await f.request(`/api/v2/bots/${bot.id}`, "DELETE")).response.status,
    409,
  );
  assert.equal(f.product.bot(bot.id).id, bot.id);
});

test("secretary delegates through real tools, waits for approval and receives only the assigned result", async (t) => {
  let workerId = "";
  let workerCalls = 0;
  const f = await fixture(async (o) => {
    const tools = createTools(o);
    if (o.prompt === "coordinate") {
      const roster = await tools
        .find((tool) => tool.name === "list_bots")!
        .execute("roster", {}, o.signal);
      assert.ok(JSON.stringify(roster).includes(workerId));
      assert.ok(!JSON.stringify(roster).includes("hidden-worker"));
      assert.ok(!JSON.stringify(roster).includes("private-note"));
      const delegate = tools.find((tool) => tool.name === "delegate_task")!;
      const args = { botId: workerId, prompt: "research precisely" };
      const first = await delegate.execute("assignment-1", args, o.signal);
      const repeated = await delegate.execute("assignment-1", args, o.signal);
      assert.deepEqual(first, repeated);
      assert.match(JSON.stringify(first), /verified-research-result/);
      assert.ok(!JSON.stringify(first).includes("private-note"));
      return { text: "Summary: verified-research-result" };
    }
    workerCalls++;
    await o.authorize?.("shell", { command: "research" }, o.signal);
    return { text: "verified-research-result" };
  });
  t.after(f.close);
  f.product.settings.update(
    {
      permissionRules: [
        { id: "fixture-shell", scope: "global", tool: "shell", effect: "ask" },
      ],
    },
    f.product.settings.read().revision,
  );
  const secretary = await f.product.create("Secretary");
  const worker = await f.product.create("Researcher");
  workerId = worker.id;
  const hidden = await f.product.create("hidden-worker");
  await f.product.update(hidden.id, { hidden: true });
  await f.store.mutate((state) =>
    state.sessions
      .find((s) => s.id === worker.sessionId)!
      .messages.push({
        id: "private",
        role: "user",
        content: "private-note",
        status: "complete",
      }),
  );
  await f.product.submit(secretary.id, {
    prompt: "coordinate",
    requestId: "secretary-job",
  });
  await until(() => f.product.pending.size === 1);
  assert.equal(
    f.product.detail(secretary.id).delegations[0].waitingApproval,
    true,
  );
  const approval = f.product.db
    .all<Approval>("approval")
    .find((a) => a.status === "pending")!;
  f.product.decide(approval.id, { approved: true });
  await until(() => !f.product.active.size);
  assert.equal(
    f.product.db.get<Job>("job", "secretary-job")!.status,
    "completed",
  );
  assert.equal(workerCalls, 1);
  const child = f.product.detail(secretary.id).delegations[0];
  assert.equal(child.status, "completed");
  assert.equal(child.result, "verified-research-result");
  assert.equal(child.parentJobId, "secretary-job");
  assert.match(
    f.tasks.view(secretary.sessionId).messages.at(-1)!.content,
    /Summary/,
  );
});

test("stopping secretary cancels its delegated work and releases approval", async (t) => {
  let workerId = "";
  let effects = 0;
  const f = await fixture(async (o) => {
    if (o.prompt === "coordinate") {
      await createTools(o)
        .find((tool) => tool.name === "delegate_task")!
        .execute("cancel-child", { botId: workerId, prompt: "wait" }, o.signal);
    } else {
      await o.authorize?.("shell", { command: "wait" }, o.signal);
      effects++;
    }
    return { text: "done" };
  });
  t.after(f.close);
  f.product.settings.update(
    {
      permissionRules: [
        { id: "fixture-shell", scope: "global", tool: "shell", effect: "ask" },
      ],
    },
    f.product.settings.read().revision,
  );
  const secretary = await f.product.create("Secretary");
  workerId = (await f.product.create("Worker")).id;
  await f.product.submit(secretary.id, {
    prompt: "coordinate",
    requestId: "cancel-parent",
  });
  await until(() => f.product.pending.size === 1);
  await f.request(`/api/v2/bots/${secretary.id}/stop`, "POST", {});
  await until(() => !f.product.active.size);
  assert.equal(effects, 0);
  assert.equal(f.product.pending.size, 0);
  assert.equal(
    f.product.detail(secretary.id).delegations[0].status,
    "cancelled",
  );
});

test("cancelling queued delegation does not stop the receiver's unrelated task", async (t) => {
  let workerId = "",
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let unrelatedAborted = false;
  const f = await fixture(async (o) => {
    if (o.prompt === "unrelated") {
      o.signal.addEventListener(
        "abort",
        () => {
          unrelatedAborted = true;
        },
        { once: true },
      );
      await gate;
    } else if (o.prompt === "coordinate") {
      await createTools(o)
        .find((tool) => tool.name === "delegate_task")!
        .execute(
          "queued-child",
          { botId: workerId, prompt: "queued-child" },
          o.signal,
        );
    } else assert.fail("Cancelled queued child must never run");
    return { text: "done" };
  });
  t.after(async () => {
    release();
    await f.close();
  });
  const secretary = await f.product.create("Secretary");
  workerId = (await f.product.create("Worker")).id;
  await f.product.submit(workerId, {
    prompt: "unrelated",
    requestId: "unrelated-job",
  });
  await f.product.submit(secretary.id, {
    prompt: "coordinate",
    requestId: "queued-parent",
  });
  await until(() => f.product.detail(secretary.id).delegations.length === 1);
  await f.request(`/api/v2/bots/${secretary.id}/stop`, "POST", {});
  await until(() => !f.product.active.has(secretary.id));
  assert.equal(
    f.product.detail(secretary.id).delegations[0].status,
    "cancelled",
  );
  assert.equal(unrelatedAborted, false);
  release();
  await until(() => !f.product.active.size);
  assert.equal(
    f.product.db.get<Job>("job", "unrelated-job")!.status,
    "completed",
  );
});

test("cross-conversation delegation cycles fail without deadlocking", async (t) => {
  let aId = "",
    bId = "";
  const f = await fixture(async (o) => {
    const tool = createTools(o).find((item) => item.name === "delegate_task")!;
    if (o.prompt === "A-root")
      await tool.execute("a-to-b", { botId: bId, prompt: "child" }, o.signal);
    if (o.prompt === "B-root") {
      await until(() =>
        f.product.db.all<Job>("job").some((j) => j.delegatedBy === aId),
      );
      await assert.rejects(
        tool.execute("b-to-a", { botId: aId, prompt: "cycle" }, o.signal),
        /互相等待/,
      );
    }
    return { text: "done" };
  });
  t.after(f.close);
  aId = (await f.product.create("A")).id;
  bId = (await f.product.create("B")).id;
  await f.product.submit(bId, { prompt: "B-root", requestId: "root-b" });
  await f.product.submit(aId, { prompt: "A-root", requestId: "root-a" });
  await until(() => !f.product.active.size);
  assert.equal(f.product.db.get<Job>("job", "root-a")!.status, "completed");
  assert.equal(f.product.db.get<Job>("job", "root-b")!.status, "completed");
});

test("persistent Bot uses one conversation, queues and deduplicates requests, inherits defaults and preserves reply context", async (t) => {
  const calls: RunOptions[] = [];
  const f = await fixture(async (o) => {
    calls.push(o);
    await new Promise((r) => setTimeout(r, 25));
    o.emit({ type: "delta", text: o.prompt });
    return { text: o.prompt };
  });
  t.after(f.close);
  const bot = await f.product.create("研究助理");
  const first = { prompt: "研究趨勢", requestId: "req-1" };
  await f.product.submit(bot.id, first);
  await f.product.submit(bot.id, first);
  await f.product.submit(bot.id, { prompt: "接續分析", requestId: "req-2" });
  await until(
    () =>
      f.product.db.all<Job>("job").filter((j) => j.status === "completed")
        .length === 2,
  );
  assert.equal(calls.length, 2);
  assert.equal(f.store.state.sessions.length, 1);
  assert.equal(f.tasks.view(bot.sessionId).messages.length, 4);
  assert.equal(calls[1].session.messages.length, 2);
  const replyTo = f.tasks.view(bot.sessionId).messages[1].id;
  const next = await f.tasks.connections!.save({
    name: "Second",
    provider: "openai-compatible",
    model: "next-model",
    modelSettings: { "next-model": { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:2/v1",
  });
  await f.tasks.connections!.setDefault({
    connectionId: next.id,
    model: next.model,
  });
  await f.product.submit(bot.id, {
    prompt: "針對這一點補充",
    requestId: "req-3",
    replyTo,
  });
  await until(() => calls.length === 3 && !f.product.active.size);
  assert.equal(calls[2].agent?.model, "next-model");
  assert.match(calls[2].executionContext!, /replying to this earlier message/);
  assert.equal(
    f.tasks.view(bot.sessionId).messages.at(-2)?.content,
    "針對這一點補充",
  );
  await assert.rejects(
    f.product.submit(bot.id, { prompt: "different", requestId: "req-1" }),
    /已使用/,
  );
  const response = await fetch(f.base + `/api/v2/bots/${bot.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "bad" }),
  });
  assert.equal(response.status, 403);
  await f.product.update(bot.id, { hidden: true, pinned: true });
  assert.equal(f.product.bot(bot.id).hidden, true);
});

test("approval gates actual tool execution, supports exact allow rules, denial, cancellation and steering", async (t) => {
  let effects = 0;
  let steer = "";
  const f = await fixture(async (o) => {
    o.registerSteer?.(async (text) => {
      steer = text;
    });
    await o.authorize?.("shell", { command: o.prompt }, o.signal);
    effects++;
    return { text: "執行完成" };
  });
  t.after(f.close);
  f.product.settings.update(
    {
      permissionRules: [
        { id: "fixture-shell", scope: "global", tool: "shell", effect: "ask" },
      ],
    },
    f.product.settings.read().revision,
  );
  const bot = await f.product.create();
  await f.product.submit(bot.id, {
    prompt: "same-command",
    requestId: "approval-1",
  });
  await until(() => f.product.pending.size === 1);
  assert.equal(effects, 0);
  const first = f.product.db.all<Approval>("approval").at(-1)!;
  assert.equal(f.product.snapshot().bots[0].status, "waiting");
  await f.request(`/api/v2/bots/${bot.id}/steer`, "POST", {
    prompt: "補充限制",
  });
  assert.equal(steer, "補充限制");
  f.product.decide(first.id, { approved: true, remember: true });
  await until(() => !f.product.active.size);
  assert.equal(effects, 1);
  await f.product.submit(bot.id, {
    prompt: "same-command",
    requestId: "approval-2",
  });
  await until(() => !f.product.active.size);
  assert.equal(effects, 2);
  assert.equal(f.product.pending.size, 0);
  await f.product.submit(bot.id, {
    prompt: "different-command",
    requestId: "approval-3",
  });
  await until(() => f.product.pending.size === 1);
  const denied = f.product.db.all<Approval>("approval").at(-1)!;
  f.product.decide(denied.id, { approved: false });
  await until(() => !f.product.active.size);
  assert.equal(effects, 2);
  await f.product.submit(bot.id, {
    prompt: "cancel-command",
    requestId: "approval-4",
  });
  await until(() => f.product.pending.size === 1);
  f.tasks.stop(bot.sessionId);
  await until(() => !f.product.active.size);
  assert.equal(
    f.product.db.all<Approval>("approval").at(-1)?.status,
    "expired",
  );
  assert.equal(effects, 2);
});

test("attachments, published snapshots and generated documents round-trip through protected HTTP endpoints", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create();
  const upload = await fetch(f.base + `/api/v2/bots/${bot.id}/attachments`, {
    method: "POST",
    headers: {
      "X-Apsis-Client": "1",
      "X-File-Name": encodeURIComponent("研究.txt"),
    },
    body: "example text",
  });
  assert.equal(upload.status, 201);
  const attachment = await upload.json();
  assert.equal(await f.product.readDocument(attachment.path), "example text");
  await f.workspace.write("report.md", "original");
  const artifact = await f.product.publish(bot, "run", "report.md", "報告.md");
  await f.workspace.write("report.md", "changed");
  const downloaded = await fetch(f.base + `/api/v2/artifacts/${artifact.id}`);
  assert.equal(await downloaded.text(), "original");
  assert.match(downloaded.headers.get("content-disposition")!, /attachment/);
  await assert.rejects(f.product.publish(bot, "run", "../outside.txt", "bad"));
  const doc = await f.product.createDocument(bot, "run", {
    format: "docx",
    name: "報告",
    content: "繁體中文文件\n第二行",
  });
  assert.match(String(await f.product.readDocument(doc.path)), /繁體中文文件/);
  const sheet = await f.product.createDocument(bot, "run", {
    format: "xlsx",
    name: "數據",
    content: '[["項目","值"],["總計",42]]',
  });
  assert.match(
    JSON.stringify(await f.product.readDocument(sheet.path)),
    /總計/,
  );
  assert.ok(
    (await readFile(await f.workspace.resolve(doc.path))).length > 1000,
  );
});

test("routine ticks are idempotent, hidden Bots keep schedules, restart expires work without replay", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create();
  await f.product.update(bot.id, { hidden: true });
  const routine = await f.product.routine(bot.id, {
    name: "日報",
    prompt: "整理日報",
    cron: "0 9 * * *",
    timezone: "Asia/Taipei",
  });
  routine.nextAt = "2020-01-01T00:00:00.000Z";
  f.product.db.put("routine", routine);
  await Promise.all([f.product.tick(), f.product.tick()]);
  await until(() => !f.product.active.size);
  assert.equal(f.product.db.all<Job>("job").length, 1);
  assert.equal(f.product.detail(bot.id).routines[0].history.length, 1);
  f.product.db.put("job", {
    id: "restart",
    botId: bot.id,
    prompt: "never replay",
    createdAt: new Date().toISOString(),
    status: "running",
  });
  f.product.db.put("approval", {
    id: "pending-restart",
    botId: bot.id,
    runId: "old",
    tool: "shell",
    args: {},
    createdAt: new Date().toISOString(),
    status: "pending",
  });
  const reopened = await createApp({
    dataDir: join(f.dir, "data"),
    workspaceDir: join(f.dir, "work"),
  });
  t.after(() => reopened.product!.close());
  assert.equal(
    reopened.product!.db.get<Job>("job", "restart")?.status,
    "interrupted",
  );
  assert.equal(
    reopened.product!.db.get<Approval>("approval", "pending-restart")?.status,
    "expired",
  );
  assert.equal(reopened.product!.bot(bot.id).sessionId, bot.sessionId);
  assert.equal(reopened.tasks.running.size, 0);
});

test("MCP drafts edit arguments, call the connector once, hide credentials and never retry ambiguous sends", async (t) => {
  const invocations: unknown[] = [];
  const upstream = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    assert.equal(req.headers.authorization, "Bearer connector-secret");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (input.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    let result: unknown;
    if (input.method === "initialize")
      result = {
        protocolVersion: input.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    if (input.method === "tools/list")
      result = {
        tools: [
          {
            name: "send_note",
            description: "Send a note",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      };
    if (input.method === "tools/call") {
      invocations.push(input.params);
      result = { content: [{ type: "text", text: "sent" }] };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => upstream.close());
  const f = await fixture();
  t.after(f.close);
  const bot = await f.product.create();
  const added = await f.request("/api/v2/connectors", "POST", {
    name: "Notes",
    url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`,
    token: "connector-secret",
  });
  assert.equal(added.response.status, 200);
  await f.product.update(bot.id, { connectorIds: [added.data.id] });
  assert.ok(!JSON.stringify(f.product.snapshot()).includes("connector-secret"));
  const tool = f.product
    .tools(bot, "run")
    .find((x) => x.name === "create_draft")!;
  await tool.execute("draft", {
    title: "寄送筆記",
    connectorId: added.data.id,
    tool: "send_note",
    arguments: '{"text":"original"}',
  });
  const draft = f.product.db.all<Draft>("draft")[0];
  assert.equal(invocations.length, 0);
  const sent = await f.request(`/api/v2/drafts/${draft.id}`, "POST", {
    action: "send",
    arguments: '{"text":"edited"}',
  });
  assert.equal(sent.data.status, "sent");
  assert.deepEqual(invocations, [
    { name: "send_note", arguments: { text: "edited" } },
  ]);
  const duplicate = await f.request(`/api/v2/drafts/${draft.id}`, "POST", {
    action: "send",
    arguments: '{"text":"again"}',
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(invocations.length, 1);
});

test("Deep Agents product tools pass through the common gate and preserve operation evidence", async (t) => {
  const f = await fixture(async (options) => {
    const tools = createTools(options);
    await tools
      .find((t) => t.name === "write_file")!
      .execute(
        "write",
        { path: "note.md", content: "real file" },
        options.signal,
      );
    await tools
      .find((t) => t.name === "publish_file")!
      .execute("publish", { path: "note.md", name: "筆記" }, options.signal);
    return { text: "筆記已完成" };
  });
  t.after(f.close);
  const bot = await f.product.create();
  await f.product.submit(bot.id, {
    prompt: "製作筆記",
    requestId: "tool-flow",
  });
  await until(() => !f.product.active.size);
  const detail = f.product.detail(bot.id);
  assert.equal(detail.artifacts.length, 1);
  assert.equal(detail.runs[0].operations.length, 2);
  assert.equal(detail.runs[0].operations[0].status, "succeeded");
  assert.match(detail.runs[0].operations[0].evidence?.patch || "", /real file/);
  assert.equal(
    await f.product.telegram(`/bot ${bot.id}`),
    `已切換至 ${bot.name}，會接續同一段對話。`,
  );
  assert.match(await f.product.telegram("/status"), /待命/);
});
