import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { git } from "../server/git-workspaces.ts";
import { codingTaskTitle } from "../server/coding-tasks.ts";
import type { RunOptions } from "../server/runtime.ts";
import type { Job } from "../shared/product.ts";
async function until(fn: () => boolean) {
  for (let i = 0; i < 600; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Timed out");
}
async function fixture(runner: (o: RunOptions) => Promise<{ text: string }>) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-coding-")),
    repo = join(dir, "repo");
  await mkdir(repo);
  await git(repo, "init");
  await git(repo, "config", "core.autocrlf", "false");
  await git(repo, "config", "user.name", "Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "code.txt"), "one\ntwo\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    worktreeRoot: join(dir, "isolated-worktrees"),
    runner,
  });
  const c = await app.tasks.connections!.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture",
    modelSettings: { fixture: { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:1/v1",
  });
  await app.tasks.connections!.setDefault({
    connectionId: c.id,
    model: c.model,
  });
  const bot = await app.product.create("Builder"),
    project = await app.tasks.projects.add({ name: "Repo", path: repo });
  return { ...app, dir, repo, bot, project };
}

test("task titles use the first request sentence and a short Unicode-safe limit", () => {
  assert.equal(
    codingTaskTitle("做一個分帳工具。請支援服務費與分配餘額。\n再補測試。"),
    "做一個分帳工具",
  );
  assert.equal(
    codingTaskTitle("Fix the login flow. Add tests."),
    "Fix the login flow",
  );
  assert.equal(
    codingTaskTitle("## 修正登入\n詳細需求不應放入標題"),
    "修正登入",
  );
  const title = codingTaskTitle("🧾".repeat(40));
  assert.equal(Array.from(title).length, 32);
  assert.equal(title, "🧾".repeat(31) + "…");
});

test("rename keeps the full prompt, task identity, run and workspace unchanged", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async () => {
    await gate;
    return { text: "done" };
  });
  t.after(async () => {
    release();
    await f.product.close();
  });
  const prompt = "做一個分帳工具。請支援服務費、金額驗證和重新計算。";
  const task = await f.product.coding.create(f.bot.id, {
    prompt,
    projectId: f.project.id,
  });
  assert.equal(task.title, "做一個分帳工具");
  assert.equal(task.prompt, prompt);
  assert.equal(task.location.name, task.title);
  const jobCount = f.product.db.all<Job>("job").length;
  const renamed = await f.product.coding.action(task.id, "rename", {
    title: "  午餐\n分帳  ",
  });
  assert.ok("title" in renamed);
  assert.equal(renamed.title, "午餐 分帳");
  assert.equal(renamed.prompt, prompt);
  assert.equal(renamed.id, task.id);
  assert.equal(renamed.sessionId, task.sessionId);
  assert.equal(renamed.location.path, task.location.path);
  assert.equal(f.product.db.all<Job>("job").length, jobCount);
  await assert.rejects(
    f.product.coding.action(task.id, "rename", { title: " " }),
    /內容為空/,
  );
  await assert.rejects(
    f.product.coding.action(task.id, "rename", { title: "字".repeat(81) }),
    /80/,
  );
  assert.equal(f.product.coding.get(task.id).title, "午餐 分帳");
});

test("retry restores only this task's interrupted requests and deduplicates concurrent clicks", async (t) => {
  const previousError = "Previous run reached its recursion limit";
  let attempts = 0;
  let releaseResume!: () => void;
  const resumed = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  const f = await fixture(async () => {
    if (++attempts === 1) throw new Error(previousError);
    await resumed;
    return { text: "done" };
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(async () => {
    release();
    releaseResume();
    await f.product.close();
  });
  const task = await f.product.coding.create(f.bot.id, {
    prompt: "original request",
    projectId: f.project.id,
  });
  await until(() => !f.product.coding.busy(task));
  const source = f.product.db.get<Job>("job", task.jobId!)!;
  assert.equal(f.product.coding.get(task.id).error, previousError);
  assert.equal(source.error, previousError);
  assert.equal(f.tasks.runs.records.get(source.runId!)?.error, previousError);
  f.product.db.put("job", { ...source, status: "interrupted" });
  const submit = f.product.submit.bind(f.product);
  let calls = 0;
  t.mock.method(
    f.product,
    "submit",
    async (...args: Parameters<typeof submit>) => {
      calls++;
      await gate;
      return submit(...args);
    },
  );
  const a = f.product.coding.action(task.id, "retry", {
    jobId: source.id,
    requestId: "retry-a",
  });
  const b = f.product.coding.action(task.id, "retry", {
    jobId: source.id,
    requestId: "retry-b",
  });
  await until(() => calls === 1);
  release();
  const [first, duplicate] = await Promise.all([a, b]);
  assert.ok("status" in first);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.retryOf, source.id);
  assert.equal(first.prompt, source.prompt);
  assert.equal(first.taskId, task.id);
  assert.equal(first.executionSessionId, task.sessionId);
  assert.equal(first.location?.path, task.location.path);
  await until(() => f.product.coding.get(task.id).phase === "working");
  assert.equal(f.product.coding.get(task.id).error, undefined);
  assert.equal(f.product.db.get<Job>("job", source.id)!.error, previousError);
  assert.equal(f.tasks.runs.records.get(source.runId!)?.error, previousError);
  releaseResume();
  const again = await f.product.coding.action(task.id, "retry", {
    jobId: source.id,
    requestId: "retry-c",
  });
  assert.equal(again.id, first.id);
  assert.equal(calls, 1);
  assert.equal(f.product.db.get<Job>("job", source.id)!.status, "interrupted");

  for (const status of ["failed", "cancelled", "interrupted"] as const) {
    const id = `${status}-supplement`;
    f.product.db.put("job", {
      ...source,
      id,
      status,
      runId: undefined,
      prompt: `${status} queued instruction`,
    });
    const retried = await f.product.coding.action(task.id, "retry", {
      jobId: id,
      requestId: `${status}-retry`,
    });
    assert.ok("status" in retried);
    assert.equal(retried.retryOf, id);
    assert.equal(retried.prompt, `${status} queued instruction`);
  }
  f.product.db.put("job", {
    ...source,
    id: "other-task-source",
    taskId: "other-task",
    status: "interrupted",
  });
  await assert.rejects(
    f.product.coding.action(task.id, "retry", {
      jobId: "other-task-source",
      requestId: "wrong-task",
    }),
    /找不到此任務/,
  );
  f.product.db.put("job", {
    ...source,
    id: "completed-source",
    status: "completed",
  });
  await assert.rejects(
    f.product.coding.action(task.id, "retry", {
      jobId: "completed-source",
      requestId: "completed-retry",
    }),
    /不能重新送出/,
  );
  await until(() => !f.product.coding.busy(task));
});
test("same Bot tasks run concurrently with separate worktrees, history, and real diffs", async (t) => {
  const started: RunOptions[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = await fixture(async (o) => {
    started.push(o);
    await gate;
    await o.workspace.write("code.txt", `one\n${o.prompt}\n`);
    return { text: `Done ${o.prompt}` };
  });
  t.after(async () => {
    release();
    await f.product.close();
  });
  const a = await f.product.coding.create(f.bot.id, {
      prompt: "alpha",
      projectId: f.project.id,
    }),
    b = await f.product.coding.create(f.bot.id, {
      prompt: "beta",
      projectId: f.project.id,
    });
  await until(() => started.length === 2);
  assert.notEqual(a.location.path, b.location.path);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.ok(started.every((o) => o.session.messages.length === 0));
  assert.equal(await readFile(join(f.repo, "code.txt"), "utf8"), "one\ntwo\n");
  release();
  await until(
    () =>
      f.product.coding.get(a.id).phase === "review" &&
      f.product.coding.get(b.id).phase === "review",
  );
  const diff = await f.product.coding.changes(a.id, "code.txt");
  assert.equal(diff.files[0].before, "one\ntwo\n");
  assert.equal(diff.files[0].after, "one\nalpha\n");
  assert.equal(
    f.product.coding
      .detail(a.id)
      .session.messages.some((m) => m.content.includes("beta")),
    false,
  );
  await f.product.coding.action(a.id, "read", { version: 1 });
  assert.equal(f.product.coding.get(a.id).phase, "review");
  assert.equal(f.product.coding.get(b.id).readVersion, 0);
  await f.product.coding.action(a.id, "message", { prompt: "continue alpha" });
  await until(() => f.product.coding.get(a.id).replyVersion === 2);
  assert.equal(f.product.coding.get(a.id).location.path, a.location.path);
});
test("Plan is enforced read-only, versioned, and starts in the same task", async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(async (o) => {
    if (o.executionContext?.includes("PLAN MODE")) {
      assert.equal(
        f.product.policy(f.bot.id, o.source!.runId, "shell", {
          command: "echo unsafe",
        }).effect,
        "deny",
      );
      assert.equal(
        f.product.policy(f.bot.id, o.source!.runId, "write_file", {
          path: "x",
          content: "x",
        }).effect,
        "deny",
      );
      return { text: "# Plan\nInspect then implement." };
    }
    return { text: "Implemented" };
  });
  t.after(() => f.product.close());
  const a = await f.product.coding.create(f.bot.id, {
    prompt: "plan this",
    projectId: f.project.id,
    mode: "plan",
  });
  await until(() => f.product.coding.get(a.id).phase === "plan-ready");
  await assert.rejects(
    f.product.coding.action(a.id, "plan", { version: 0, content: "old" }),
    /計畫已更新/,
  );
  await f.product.coding.action(a.id, "plan", {
    version: 1,
    content: "# Revised",
  });
  await assert.rejects(
    f.product.coding.action(a.id, "start", { version: 1 }),
    /最新計畫/,
  );
  await f.product.coding.action(a.id, "start", { version: 2 });
  await until(() => f.product.coding.get(a.id).phase === "review");
  assert.equal(f.product.coding.get(a.id).contextId, a.contextId);
  assert.equal(f.product.coding.get(a.id).plan, "# Revised");
});
test("dirty source changes require a choice and are copied without altering source checkout", async (t) => {
  const f = await fixture(async () => ({ text: "ok" }));
  t.after(() => f.product.close());
  const branch = (await git(f.repo, "branch", "--show-current")).trim();
  await writeFile(join(f.repo, "code.txt"), "dirty\n");
  await writeFile(join(f.repo, "new.txt"), "new\n");
  await assert.rejects(
    f.product.coding.create(f.bot.id, {
      prompt: "work",
      projectId: f.project.id,
    }),
    /未提交修改/,
  );
  const a = await f.product.coding.create(f.bot.id, {
    prompt: "include",
    projectId: f.project.id,
    dirty: "include",
  });
  assert.equal(
    await readFile(join(a.location.path, "code.txt"), "utf8"),
    "dirty\n",
  );
  assert.equal(
    await readFile(join(a.location.path, "new.txt"), "utf8"),
    "new\n",
  );
  const b = await f.product.coding.create(f.bot.id, {
    prompt: "exclude",
    projectId: f.project.id,
    dirty: "exclude",
  });
  assert.equal(
    await readFile(join(b.location.path, "code.txt"), "utf8"),
    "one\ntwo\n",
  );
  assert.equal((await git(f.repo, "branch", "--show-current")).trim(), branch);
  assert.equal(await readFile(join(f.repo, "code.txt"), "utf8"), "dirty\n");
  await until(
    () =>
      !f.product.db
        .all<Job>("job")
        .some((j) => ["queued", "running"].includes(j.status)),
  );
});

test("schedule pins its branch, catches up once and reuses an open PR task", async (t) => {
  const f = await fixture(async () => ({ text: "scheduled" }));
  t.after(() => f.product.close());
  await git(f.repo, "branch", "scheduled-base");
  await writeFile(join(f.repo, "code.txt"), "different checkout\n");
  await git(f.repo, "add", ".");
  await git(f.repo, "commit", "-m", "later");
  const r = await f.product.routine(f.bot.id, {
    name: "Maintenance",
    prompt: "Fix CI",
    cron: "0 0 * * *",
    projectId: f.project.id,
    branch: "scheduled-base",
  });
  r.nextAt = "2020-01-01T00:00:00.000Z";
  f.product.db.put("routine", r);
  await Promise.all([f.product.tick(), f.product.tick()]);
  const tasks = f.product.coding.list();
  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.equal(task.git?.base, "scheduled-base");
  assert.equal(
    await readFile(join(task.location.path, "code.txt"), "utf8"),
    "one\ntwo\n",
  );
  await until(() => !f.product.coding.busy(task));
  const done = f.product.coding.get(task.id);
  done.pullRequest = {
    url: "https://github.com/example/repo/pull/1",
    provider: "github",
    status: "OPEN",
    checkedAt: new Date().toISOString(),
    followUps: 0,
  };
  f.product.coding.save(done);
  const next = f.product.db.get<any>("routine", r.id)!;
  next.nextAt = "2020-01-02T00:00:00.000Z";
  f.product.db.put("routine", next);
  await f.product.tick();
  assert.equal(f.product.coding.list().length, 1);
  assert.equal(
    f.product.db.get<any>("routine", r.id).history.at(-1).jobId,
    task.id,
  );
  await assert.rejects(
    f.product.coding.action(task.id, "branch", { branch: "other" }),
    /已連結 PR/,
  );
});

test("retries keep task identity, restart preserves context and a missing worktree is not recreated", async (t) => {
  const f = await fixture(async () => ({ text: "done" }));
  let active = f.product;
  t.after(() => active.close());
  const task = await f.product.coding.create(f.bot.id, {
    requestId: "stable-id",
    prompt: "work",
    projectId: f.project.id,
  });
  await until(() => !f.product.coding.busy(task));
  assert.equal(
    (
      await f.product.coding.create(f.bot.id, {
        requestId: "stable-id",
        prompt: "work",
        projectId: f.project.id,
      })
    ).id,
    task.id,
  );
  await assert.rejects(
    f.product.coding.create(f.bot.id, {
      requestId: "stable-id",
      prompt: "work",
      mode: "plan",
      projectId: f.project.id,
    }),
    /ID 已使用/,
  );
  const first = await f.product.coding.action(task.id, "message", {
    requestId: "same-message",
    prompt: "continue",
  });
  const second = await f.product.coding.action(task.id, "message", {
    requestId: "same-message",
    prompt: "continue",
  });
  assert.equal(first.id, second.id);
  await until(() => !f.product.coding.busy(task));
  await f.product.close();
  const restarted = await createApp({
    dataDir: join(f.dir, "data"),
    workspaceDir: join(f.dir, "work"),
    runner: async () => ({ text: "continued" }),
  });
  active = restarted.product;
  const recovered = active.coding.get(task.id);
  assert.equal(recovered.contextId, task.contextId);
  assert.equal(recovered.location.path, task.location.path);
  await rename(task.location.path, task.location.path + "-moved");
  await assert.rejects(
    active.tasks.locations
      .workspace(recovered.location)
      .write("should-not-exist.txt", "x"),
    /已移動|無法存取/,
  );
  await assert.rejects(access(task.location.path));
});

test("bootstrap is concurrent-safe and never limits custom Bots", async (t) => {
  const f = await fixture(async () => ({ text: "ok" }));
  t.after(() => f.product.close());
  await Promise.all([f.product.bootstrap(), f.product.bootstrap()]);
  assert.equal(f.product.snapshot().bots.length, 1);
  await f.product.create("Second");
  await f.product.bootstrap();
  assert.equal(f.product.snapshot().bots.length, 2);
});

test("PR follow-up deduplicates evidence, bounds retries and respects stop during an in-flight check", async (t) => {
  const f = await fixture(async () => ({ text: "fixed" }));
  t.after(() => f.product.close());
  const task = await f.product.coding.create(f.bot.id, {
    prompt: "PR work",
    projectId: f.project.id,
  });
  await until(() => !f.product.coding.busy(task));
  let fingerprint = "failure-1";
  let block: Promise<void> | undefined;
  t.mock.method(f.product.coding, "readRemote", async () => {
    await block;
    return {
      status: "OPEN",
      actionable: true,
      evidence: { failure: fingerprint },
      fingerprint,
    };
  });
  const expire = () => {
    const current = f.product.coding.get(task.id);
    current.pullRequest = {
      url: "https://github.com/example/repo/pull/1",
      provider: "github",
      status: "OPEN",
      followUps: 0,
      ...current.pullRequest,
      checkedAt: "2020-01-01T00:00:00.000Z",
    };
    f.product.coding.save(current);
  };
  expire();
  await f.product.coding.checkPullRequests();
  await until(() => !f.product.coding.busy(task));
  assert.equal(f.product.coding.get(task.id).pullRequest!.followUps, 1);
  const count = f.product.db.all<Job>("job").length;
  expire();
  await f.product.coding.checkPullRequests();
  assert.equal(f.product.db.all<Job>("job").length, count);
  for (let i = 2; i <= 4; i++) {
    fingerprint = "failure-" + i;
    expire();
    await f.product.coding.checkPullRequests();
    await until(() => !f.product.coding.busy(task));
  }
  assert.equal(f.product.coding.get(task.id).phase, "blocked");
  assert.equal(f.product.coding.get(task.id).pullRequest!.followUps, 3);
  const current = f.product.coding.get(task.id);
  current.phase = "review";
  f.product.coding.save(current);
  expire();
  let release!: () => void;
  block = new Promise((r) => (release = r));
  fingerprint = "new";
  const checking = f.product.coding.checkPullRequests();
  await new Promise((r) => setTimeout(r, 10));
  await f.product.coding.action(task.id, "stop", {});
  release();
  await checking;
  assert.equal(f.product.coding.get(task.id).phase, "stopped");
});

test("PR repository validation rejects unrelated hosts, credentials and Azure token destinations", async (t) => {
  const { identifyPullRequest, validatePullRequest } = await import(
    "../server/pull-requests.ts"
  );
  const f = await fixture(async () => ({ text: "ok" }));
  t.after(() => f.product.close());
  await git(
    f.repo,
    "remote",
    "add",
    "origin",
    "git@github.com:example/repo.git",
  );
  assert.equal(
    (
      await validatePullRequest(
        f.repo,
        "https://github.com/example/repo/pull/17",
      )
    ).provider,
    "github",
  );
  await assert.rejects(
    validatePullRequest(f.repo, "https://other.example/example/repo/pull/17"),
    /不屬於/,
  );
  await assert.rejects(
    validatePullRequest(f.repo, "https://github.com/example/other/pull/17"),
    /不屬於/,
  );
  assert.throws(() =>
    identifyPullRequest("https://user:pass@github.com/example/repo/pull/1"),
  );
  assert.throws(() =>
    identifyPullRequest(
      "https://attacker.invalid/org/project/_git/repo/pullrequest/1",
    ),
  );
  assert.equal(
    identifyPullRequest("https://gitlab.example/team/repo/-/merge_requests/2")
      .provider,
    "gitlab",
  );
  await git(
    f.repo,
    "remote",
    "set-url",
    "origin",
    "git@ssh.dev.azure.com:v3/org/project/repo",
  );
  assert.equal(
    (
      await validatePullRequest(
        f.repo,
        "https://dev.azure.com/org/project/_git/repo/pullrequest/1",
      )
    ).provider,
    "azure",
  );
});
