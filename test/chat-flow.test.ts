import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { git } from "../server/git-workspaces.ts";
import { discardCodingTasks } from "../server/retired-tasks.ts";
import type { RunOptions } from "../server/runtime.ts";
import type { Job } from "../shared/product.ts";

async function until(fn: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out");
}
async function fixture(
  t: TestContext,
  runner: (o: RunOptions) => Promise<{ text: string }> = async () => ({
    text: "done",
  }),
) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-chat-flow-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    worktreeRoot: join(dir, "trees"),
    runner,
  });
  const c = await app.connections.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture",
    url: "http://127.0.0.1:1/v1",
  });
  await app.connections.setDefault({ connectionId: c.id, model: c.model });
  const bot = await app.product.create("Builder");
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v2`;
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { "x-apsis-client": "1", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => {
    await app.product.close();
    app.server.closeAllConnections();
    await new Promise<void>((r) => app.server.close(() => r()));
    app.product.db.db.close();
  });
  return {
    ...app,
    bot,
    dir,
    request,
    send: (body: unknown) => request(`/bots/${bot.id}/messages`, "POST", body),
  };
}

test("one message endpoint handles chat, steering, retries and state races without creating tasks", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const adopted: (() => Promise<void>)[] = [];
  let deliveries = 0;
  const f = await fixture(t, async (o) => {
    o.registerSteer?.(async (_text, callback) => {
      deliveries++;
      if (callback) adopted.push(callback);
    });
    await gate;
    return { text: "done" };
  });
  t.after(() => release());
  const first = await f.send({ requestId: "first", prompt: "Build it" });
  assert.equal(first.status, 202);
  await until(() => f.product.steers.has(f.bot.id));
  const input = { requestId: "follow", prompt: "Make it smaller" };
  const replies = await Promise.all([f.send(input), f.send(input)]);
  assert.equal(deliveries, 1);
  assert.equal(replies[0].data.delivery.state, "pending");
  assert.equal(replies[0].data.messageId, replies[1].data.messageId);
  assert.equal((await f.send({ ...input, prompt: "different" })).status, 409);
  assert.equal(
    (await f.request(`/bots/${f.bot.id}/contexts`, "POST", {})).status,
    409,
  );
  await adopted[0]();
  assert.equal(
    f.store.conversations.message(f.bot.sessionId, replies[0].data.messageId)
      ?.delivery?.state,
    "applied",
  );
  assert.equal(f.product.db.all("job").length, 1);
  release();
  await until(() => !f.product.active.size);
  assert.equal(
    (await f.send({ requestId: "after", prompt: "Next" })).status,
    202,
  );
  await until(() => !f.product.active.size);
  assert.equal(f.product.db.all("job").length, 2);
  assert.equal(
    (await f.request("/coding-tasks", "POST", { prompt: "old" })).status,
    404,
  );
  assert.ok(!("codingTasks" in f.product.snapshot()));
  assert.ok(
    !f.product
      .tools(f.bot, "unused")
      .some((tool) => tool.name === "create_coding_task"),
  );
  const oldContext = f.store.conversations.activeId(f.bot.sessionId);
  const next = f.product.newContext(f.bot.id);
  assert.notEqual(next.id, oldContext);
  assert.ok(f.store.conversations.page(f.bot.sessionId).messages.length);
  assert.equal(
    (
      await f.send({
        requestId: "stale",
        prompt: "oops",
        workContextId: oldContext,
      })
    ).status,
    409,
  );
});

test("steering rejects foreign attachments and changed files; unconsumed messages remain visible", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = await fixture(t, async (o) => {
    o.registerSteer?.(async () => {});
    await gate;
    return { text: "done" };
  });
  t.after(() => release());
  await f.send({ requestId: "start", prompt: "begin" });
  await until(() => f.product.steers.has(f.bot.id));
  assert.equal(
    (
      await f.send({
        requestId: "foreign",
        prompt: "read",
        artifactIds: ["missing"],
      })
    ).status,
    409,
  );
  const location = f.product.workLocation(f.bot);
  await mkdir(location.path, { recursive: true });
  await writeFile(join(location.path, "a.txt"), "changed");
  assert.equal(
    (
      await f.send({
        requestId: "stale-file",
        prompt: "read",
        fileReferences: [
          { locationId: location.id, path: "a.txt", revision: "old" },
        ],
      })
    ).status,
    409,
  );
  const follow = await f.send({
    requestId: "pending",
    prompt: "remember this",
  });
  release();
  await until(() => !f.product.active.size);
  assert.equal(
    f.store.conversations.message(f.bot.sessionId, follow.data.messageId)
      ?.delivery?.state,
    "not-applied",
  );
});

test("Git folder and isolated worktree remain in the same chat; source edits and file evidence survive", async (t) => {
  const f = await fixture(t),
    repo = join(f.dir, "repo");
  await mkdir(repo);
  await git(repo, "init");
  await git(repo, "config", "user.name", "Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "a.txt"), "before\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  await writeFile(join(repo, "a.txt"), "dirty\n");
  const contextId = f.store.conversations.activeId(f.bot.sessionId);
  const route = `/bots/${f.bot.id}/work-location`;
  assert.equal(
    (await f.request(route, "PUT", { contextId, path: repo, worktree: true }))
      .status,
    409,
  );
  const set = await f.request(route, "PUT", {
    contextId,
    path: repo,
    worktree: true,
    dirty: "include",
  });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.id, contextId);
  assert.equal(set.data.location.kind, "worktree");
  assert.notEqual(set.data.location.path, repo);
  assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "dirty\n");
  assert.match(
    await readFile(join(set.data.location.path, "a.txt"), "utf8"),
    /dirty/,
  );
  const changes = await f.request(`/bots/${f.bot.id}/changes?path=a.txt`);
  assert.equal(changes.status, 200);
  assert.match(changes.data.files[0].before, /before/);
  await f.send({ requestId: "work", prompt: "check" });
  await until(() => !f.product.active.size);
  assert.equal(
    (await f.request(route, "PUT", { contextId, path: repo })).status,
    409,
  );
  assert.equal(f.product.db.all<Job>("job")[0].workContextId, contextId);
});

test("retired tasks and dependent records are discarded without an archive", async (t) => {
  const f = await fixture(t);
  f.product.db.put("coding-task", {
    id: "old",
    botId: f.bot.id,
    contextId: "old-context",
    sessionId: "old-session",
  });
  f.product.db.put("job", { id: "old-job", taskId: "old", status: "running" });
  f.product.db.put("job", {
    id: "child",
    parentJobId: "old-job",
    workContextId: "child-context",
    runId: "child-run",
  });
  f.product.db.put("approval", { id: "approval", runId: "child-run" });
  f.product.db.put("artifact", {
    id: "artifact",
    workContextId: "child-context",
  });
  f.product.db.put("job", {
    id: "chat-job",
    botId: f.bot.id,
    status: "completed",
  });
  await writeFile(join(f.dir, "work", "retained.txt"), "keep");
  await discardCodingTasks(f.product.db, f.store);
  assert.equal(f.product.db.all("coding-task").length, 0);
  assert.deepEqual(
    f.product.db.all<{ id: string }>("job").map((j) => j.id),
    ["chat-job"],
  );
  assert.equal(f.product.db.all("approval").length, 0);
  assert.equal(f.product.db.all("artifact").length, 0);
  assert.equal(f.product.db.all("archived:job").length, 0);
  assert.equal(f.product.db.get("migration", "chat-only-v1"), undefined);
  await assert.rejects(readFile(join(f.store.directory, "archives")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(f.dir, "work", "retained.txt"), "utf8"),
    "keep",
  );
  await discardCodingTasks(f.product.db, f.store);
  assert.equal(f.product.bot(f.bot.id).name, "Builder");
});

test("scheduled code work has its own context and worktree without changing active chat", async (t) => {
  const f = await fixture(t),
    repo = join(f.dir, "scheduled-repo");
  await mkdir(repo);
  await git(repo, "init");
  await git(repo, "config", "user.name", "Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "a.txt"), "initial");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  const branch = (await git(repo, "branch", "--show-current")).trim();
  const project = await f.tasks.projects.add({ name: "Scheduled", path: repo });
  const active = f.store.conversations.activeId(f.bot.sessionId);
  const routine = await f.product.routine(f.bot.id, {
    name: "Review",
    prompt: "Review code",
    cron: "0 9 * * *",
    timezone: "Asia/Taipei",
    projectId: project.id,
    branch,
  });
  const job = await f.product.runRoutine(routine, "routine-run");
  await until(() => !f.product.active.size);
  assert.notEqual(job.workContextId, active);
  assert.equal(job.contextKind, "routine");
  assert.equal(job.location?.kind, "worktree");
  assert.notEqual(job.location?.path, repo);
  assert.equal(f.store.conversations.activeId(f.bot.sessionId), active);
  assert.equal((await f.product.runRoutine(routine, "routine-run")).id, job.id);
  assert.equal(f.product.db.all("job").length, 1);
});

test("PR follow-ups use the active conversation, deduplicate evidence and stop at three", async (t) => {
  const f = await fixture(t);
  let fingerprint = "first";
  f.product.workspaces.readRemote = async () => ({
    status: "OPEN",
    actionable: true,
    evidence: { failure: true },
    fingerprint,
  });
  const contextId = f.store.conversations.activeId(f.bot.sessionId);
  await f.product.workspaces.track(
    f.bot.id,
    contextId,
    "https://github.com/example/repo/pull/1",
  );
  const poll = async () => {
    const context = f.store.conversations.context(f.bot.sessionId);
    f.store.conversations.updateContext(f.bot.sessionId, context.id, {
      pullRequest: { ...context.pullRequest!, checkedAt: "2000-01-01" },
    });
    await f.product.workspaces.checkPullRequests();
    await until(() => !f.product.active.size);
  };
  await poll();
  await poll();
  assert.equal(f.product.db.all("job").length, 1);
  fingerprint = "second";
  await poll();
  fingerprint = "third";
  await poll();
  fingerprint = "fourth";
  await poll();
  assert.equal(f.product.db.all("job").length, 3);
  assert.ok(
    f.product.db.all<Job>("job").every((j) => j.workContextId === contextId),
  );
  f.product.newContext(f.bot.id);
  await f.product.workspaces.checkPullRequests();
  assert.equal(f.product.db.all("job").length, 3);
});
