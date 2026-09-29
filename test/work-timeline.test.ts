import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskService } from "../server/tasks.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { RunStore } from "../server/runs.ts";

test("work log persists commentary and tool order without duplicate terminal updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-timeline-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  const tasks = new TaskService(store, workspace, async (options) => {
    options.emit({ type: "delta", text: "先檢查檔案。" });
    options.emit({
      type: "commentary",
      id: "first-note",
      text: "先檢查檔案。",
    });
    assert.equal(tasks.view(options.session.id).live?.text, "");
    const op = {
      id: "read",
      name: "read_file",
      target: "index.html",
      status: "started" as const,
      mutating: false,
      startedAt: new Date().toISOString(),
    };
    await options.recordOperation?.(op);
    await options.recordOperation?.({
      ...op,
      status: "succeeded",
      endedAt: new Date().toISOString(),
    });
    options.emit({
      type: "commentary",
      id: "second-note",
      text: "已確認檔案存在，接著驗證內容。",
    });
    options.emit({
      type: "execution",
      evidence: {
        kind: "planning",
        todos: [{ content: "確認檔案", status: "completed" }],
      },
    });
    options.emit({
      type: "execution",
      evidence: {
        kind: "subagent",
        activity: {
          id: "child",
          name: "general-purpose",
          task: "分析檔案",
          status: "completed",
          progress: "檢查內容",
          resultSummary: "已確認",
          startedAt: op.startedAt,
          endedAt: op.startedAt,
        },
      },
    });
    options.emit({ type: "delta", text: "完成驗證。" });
    return { text: "完成驗證。" };
  });
  await tasks.runs.init();
  const session = await tasks.create();
  await tasks.run(session.id, "確認遊戲", false);
  const reloaded = await new RunStore(store.directory).init();
  const run = reloaded.list(session.id)[0];
  assert.deepEqual(
    run.timeline?.map((e) => e.kind),
    ["commentary", "operation", "commentary", "planning", "subagent"],
  );
  assert.equal(run.timeline?.at(-1)?.kind, "subagent");
  assert.equal(run.operations.length, 1);
  assert.equal(run.operations[0].status, "succeeded");
  assert.equal(run.text, "完成驗證。");
  assert.equal(tasks.view(session.id).messages.at(-1)?.content, "完成驗證。");
});
