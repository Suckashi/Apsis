import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { Store } from "../server/store.ts";
import { RunStore } from "../server/runs.ts";
import { randomUUID } from "node:crypto";
import { recoveryContext } from "../server/recovery.ts";
import type { ToolOperation, RunPermissions } from "../shared/types.ts";
const grants: RunPermissions = {
  files: true,
  shell: true,
  memory: false,
  skills: false,
};
async function fixture(t: test.TestContext, runner: AppOptions["runner"]) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-projects-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "default"),
    env: { PI_PROVIDER: "openai", OPENAI_API_KEY: "evidence-secret" },
    runner,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.tasks.stopAll();
    app.server.closeAllConnections();
    app.server.close();
  });
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const request = (path: string, body?: unknown) =>
    fetch(base + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, dir, request };
}

test("projects validate existing directories, bind each conversation and survive reload without redirecting missing roots", async (t) => {
  let calls = 0;
  const { app, dir, request } = await fixture(t, async (options) => {
    calls++;
    assert.ok(
      options.executionContext?.includes(
        options.workspace.root.replaceAll("\\", "\\\\"),
      ),
    );
    await createTools(options)
      .find((t) => t.name === "write_file")!
      .execute("w", { path: "marker.txt", content: options.prompt });
    return { text: "written" };
  });
  const root = join(dir, "project-a");
  await mkdir(root);
  await writeFile(join(root, "private.txt"), "a");
  for (const path of [
    "relative",
    join(dir, "missing"),
    join(root, "private.txt"),
  ])
    assert.equal(
      (await request("projects", { name: "Invalid", path })).status,
      400,
    );
  const project = await (
    await request("projects", { name: "Project A", path: root })
  ).json();
  const duplicate = await (
    await request("projects", { name: "Renamed?", path: root })
  ).json();
  assert.equal(project.id, duplicate.id);
  assert.equal(
    (await request("sessions", { mode: "pi", projectId: "invalid" })).status,
    404,
  );
  const session = await (
    await request("sessions", { mode: "pi", projectId: project.id })
  ).json();
  const other = await app.tasks.create("pi");
  await app.tasks.run(session.id, "project-marker", true);
  await app.tasks.run(other.id, "default-marker", true);
  assert.equal(
    await readFile(join(root, "marker.txt"), "utf8"),
    "project-marker",
  );
  assert.equal(await app.workspace.read("marker.txt"), "default-marker");
  const names = await (await request("files?sessionId=" + session.id)).json();
  assert.ok(names.some((f: { name: string }) => f.name === "private.txt"));
  assert.equal(
    (await request("files?sessionId=" + session.id + "&path=../")).status,
    400,
  );
  const reopened = await new Store(join(dir, "data")).init();
  app.store.state = reopened.state;
  assert.equal(app.tasks.view(session.id).project?.path, root);
  assert.equal(app.tasks.projects.list().length, 2);
  await rename(root, root + "-moved");
  await assert.rejects(
    app.tasks.run(session.id, "must not create a replacement", true),
    /資料夾/,
  );
  assert.equal(calls, 2);
  await assert.rejects(stat(root), { code: "ENOENT" });
  // Old conversations with no project still use the default workspace.
  await app.store.mutate((s) => {
    delete s.sessions.find((row) => row.id === other.id)!.project;
  });
  await app.tasks.run(other.id, "legacy-default", true);
  assert.equal(await app.workspace.read("marker.txt"), "legacy-default");
});

test("run journals retain bounded diffs, command output and failure codes, and redact active credentials", async (t) => {
  const { app, dir } = await fixture(t, async (options) => {
    const tools = createTools(options);
    const execute = (name: string, args: unknown) =>
      tools.find((t) => t.name === name)!.execute(name, args, options.signal);
    await execute("write_file", {
      path: "demo.txt",
      content: "before\nevidence-secret\n",
    });
    await execute("edit_file", {
      path: "demo.txt",
      edits: [{ oldText: "before", newText: "after" }],
    });
    const command =
      process.platform === "win32"
        ? "Write-Output '中文 evidence-secret'; exit 7"
        : "printf '中文 evidence-secret'; exit 7";
    await assert.rejects(execute("shell", { command }));
    await execute("shell", {
      command:
        process.platform === "win32"
          ? "Write-Output ('x' * 30000)"
          : "head -c 30000 /dev/zero | tr '\\0' x",
    });
    return { text: "inspected" };
  });
  const session = await app.tasks.create("pi");
  await app.tasks.run(
    session.id,
    "create and check",
    false,
    undefined,
    undefined,
    grants,
  );
  const [run] = app.tasks.runs.list(session.id);
  assert.match(run.operations[0].evidence?.patch || "", /\+before/);
  assert.match(run.operations[1].evidence?.patch || "", /-before\n\+after/);
  assert.equal(run.operations[2].evidence?.exitCode, 7);
  assert.match(run.operations[2].evidence?.output || "", /中文/);
  assert.equal(run.operations[2].status, "unknown");
  assert.equal(run.operations[3].evidence?.exitCode, 0);
  assert.equal(run.operations[3].evidence?.truncated, true);
  assert.ok(run.operations[3].evidence!.output!.length <= 24000);
  assert.doesNotMatch(JSON.stringify(run), /evidence-secret/);
  assert.match(JSON.stringify(run), /redacted/);
  const reloaded = await new RunStore(join(dir, "data")).init();
  assert.deepEqual(
    reloaded.records.get(run.id)?.operations,
    run.operations.map((op) => JSON.parse(JSON.stringify(op))),
  );
});

test("failed attempts survive restart as scoped evidence, respect new grants and are consumed after successful continuation", async (t) => {
  let turn = 0;
  const contexts: string[] = [];
  const { app, dir } = await fixture(t, async (options) => {
    contexts.push(options.executionContext || "");
    if (turn++ === 0) {
      await createTools(options)
        .find((t) => t.name === "write_file")!
        .execute("write", { path: "once.txt", content: "already done" });
      throw new Error("model disconnected");
    }
    assert.equal(options.permissions?.files, false);
    assert.equal(await options.workspace.read("once.txt"), "already done");
    return {
      text: "checked, no repeated writes",
      engineState: { checked: true },
    };
  });
  const session = await app.tasks.create("pi");
  await assert.rejects(
    app.tasks.run(
      session.id,
      "create once and then verify",
      false,
      undefined,
      undefined,
      grants,
    ),
    /disconnected/,
  );
  const original = app.tasks.runs.list(session.id)[0];
  const reopened = await new Store(join(dir, "data")).init();
  app.store.state = reopened.state;
  app.tasks.runs = await new RunStore(join(dir, "data")).init();
  assert.equal(turn, 1, "restart must not invoke the model");
  await app.tasks.run(session.id, "inspect only", false);
  assert.match(contexts[1], /untrusted evidence/);
  assert.match(contexts[1], /create once and then verify/);
  assert.match(contexts[1], /once.txt/);
  assert.match(contexts[1], /succeeded/);
  assert.ok(
    app.tasks.runs.list(session.id)[0].recoveryRunIds?.includes(original.id),
  );
  await app.tasks.run(session.id, "another message", false);
  assert.doesNotMatch(contexts[2], /previous-attempt-evidence/);
  assert.equal(await app.workspace.read("once.txt"), "already done");
  const another = await app.tasks.create("pi");
  await app.tasks.run(another.id, "unrelated", false);
  assert.doesNotMatch(contexts[3], /previous-attempt-evidence/);
});

test("cancellation preserves partial shell output and marks side effects uncertain", async (t) => {
  let operations: ToolOperation[] = [];
  const { app } = await fixture(t, async () => ({ text: "unused" }));
  const shell = createTools({
    store: app.store,
    workspace: app.workspace,
    allowWrites: false,
    permissions: grants,
    recordOperation: async (op) => {
      operations.push(op);
    },
  }).find((t) => t.name === "shell")!;
  const command =
    process.platform === "win32"
      ? "Write-Output 'STARTED'; Start-Sleep -Seconds 30"
      : "printf STARTED; sleep 30";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    await assert.rejects(
      shell.execute("cancel", { command }, controller.signal),
      /aborted/,
    );
  } finally {
    clearTimeout(timer);
  }
  assert.equal(operations.at(-1)?.status, "unknown");
  assert.equal(operations.at(-1)?.evidence?.exitCode, null);
  assert.match(operations.at(-1)?.evidence?.output || "", /STARTED/);
});

test("restart links the failed reply to its journal and supplies bounded newest-first evidence without replay", async (t) => {
  let calls = 0;
  const { app, dir } = await fixture(t, async (options) => {
    calls++;
    assert.match(options.executionContext || "", /newest-command/);
    assert.match(options.executionContext || "", /unknown/);
    return { text: "reviewed" };
  });
  const session = await app.tasks.create("pi");
  const runId = randomUUID();
  await app.store.mutate((s) =>
    s.sessions
      .find((row) => row.id === session.id)!
      .messages.push({
        id: randomUUID(),
        runId,
        role: "user",
        content: "interrupted request",
        status: "pending",
      }),
  );
  await app.tasks.runs.save({
    id: runId,
    sessionId: session.id,
    project: session.project,
    engine: "pi",
    agentName: "Apsis",
    model: "fixture",
    permissions: grants,
    status: "running",
    createdAt: new Date().toISOString(),
    text: "",
    activity: [],
    operations: Array.from({ length: 60 }, (_, i) => ({
      id: randomUUID(),
      name: "shell",
      target: i === 59 ? "newest-command" : "older-command",
      status: i === 59 ? "started" : "succeeded",
      startedAt: new Date().toISOString(),
      mutating: true,
      evidence: { output: "x".repeat(24000), patch: "y".repeat(24000) },
    })),
  });
  app.store.state = (await new Store(join(dir, "data")).init()).state;
  app.tasks.runs = await new RunStore(join(dir, "data")).init();
  assert.equal(calls, 0);
  const restored = app.store.state.sessions[0];
  assert.equal(restored.messages.at(-1)?.runId, runId);
  const context = recoveryContext(app.tasks.runs, restored).context;
  const data = context
    .split("<previous-attempt-evidence>\n")[1]
    .split("\n</previous-attempt-evidence>")[0];
  assert.ok(data.length <= 16000);
  assert.equal(JSON.parse(data)[0].operations[0].target, "newest-command");
  assert.match(context, /omitted/);
  await app.tasks.run(session.id, "inspect only", false);
  assert.equal(calls, 1);
});
