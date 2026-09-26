import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAgent } from "../server/agent.ts";
import type { RunOptions } from "../server/runtime.ts";
import { Store } from "../server/store.ts";
import { TaskService } from "../server/tasks.ts";
import { Workspace } from "../server/workspace.ts";

test("every explicit legacy Codex selection rejects before provider dispatch", async () => {
  const session = {
    id: "legacy",
    title: "Legacy",
    mode: "deepagents" as const,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  const selections = [
    { env: { MODEL_PROVIDER: "codex" } },
    { mode: "codex" },
    { session: { ...session, mode: "codex" } },
    { session: { ...session, provider: "codex" } },
    { session: { ...session, agent: { provider: "codex" } } },
    { session: { ...session, agent: { engine: "codex" } } },
    { agent: { provider: "codex" } },
    { agent: { engine: "codex" } },
  ];
  for (const selection of selections) {
    // Intentionally omit runtime resources: rejection must precede using them.
    await assert.rejects(
      runAgent({
        mode: "deepagents",
        session,
        env: { MODEL_PROVIDER: "openai", MODEL_ID: "paid-model" },
        ...selection,
      } as unknown as RunOptions),
      /Codex 已停止支援/,
    );
  }
});

test("task timeout and extensions are captured once per run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-runtime-selection-"));
  const store = await new Store(join(directory, "data")).init();
  const workspace = await new Workspace(join(directory, "work")).init();
  let calls = 0;
  const runtimeSettings = { taskTimeoutMs: 1 } as NonNullable<
    RunOptions["runtimeSettings"]
  >;
  const tasks = new TaskService(store, workspace, async (options) => {
    assert.equal(options.modelSettings?.displayName, "Selected model");
    runtimeSettings.taskTimeoutMs = 60000;
    tasks.timeoutMs = 60000;
    await new Promise<void>((resolve) => {
      options.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    options.signal.throwIfAborted();
    return { text: "unreachable" };
  });
  await tasks.runs.init();
  tasks.extensions = () => {
    calls++;
    return {
      runtimeSettings,
      modelSettings: { displayName: "Selected model" },
    };
  };
  const session = await tasks.create();
  await assert.rejects(tasks.run(session.id, "test", false), /超過執行時間/);
  assert.equal(calls, 1);
  assert.equal(tasks.running.size, 0);
});

test("legacy Codex sessions fail durably without invoking an injected runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-legacy-selection-"));
  const store = await new Store(join(directory, "data")).init();
  const workspace = await new Workspace(join(directory, "work")).init();
  let calls = 0;
  const tasks = new TaskService(store, workspace, async () => {
    calls++;
    return { text: "unexpected" };
  });
  await tasks.runs.init();
  const session = await tasks.create("codex");
  await assert.rejects(
    tasks.run(session.id, "test", false),
    /Codex 已停止支援/,
  );
  assert.equal(calls, 0);
  assert.equal(tasks.view(session.id).mode, "codex");
  assert.equal(tasks.view(session.id).messages.at(-1)?.status, "error");
});
