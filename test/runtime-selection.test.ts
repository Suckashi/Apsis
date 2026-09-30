import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RunOptions } from "../server/runtime.ts";
import { Store } from "../server/store.ts";
import { TaskService } from "../server/tasks.ts";
import { Workspace } from "../server/workspace.ts";

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
