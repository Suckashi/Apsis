import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { createMiddleware } from "langchain";
import { z } from "zod";
import { ToolExecutionError } from "../server/evidence.ts";
import type { RunOptions } from "../server/runtime.ts";
import { toolFeedback } from "../server/tool-feedback.ts";
import {
  ToolFailureGuard,
  ToolFailureLoopError,
} from "../server/tool-failure-guard.ts";
import type { ToolOperation } from "../shared/types.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { TaskService } from "../server/tasks.ts";
import { RunStore } from "../server/runs.ts";

function harness() {
  const operations = new Map<string, ToolOperation>();
  const activity: string[] = [];
  const guard = new ToolFailureGuard();
  const options = {
    signal: new AbortController().signal,
    emit: (event: { text?: string }) => {
      if (event.text) activity.push(event.text);
    },
    recordOperation: async (operation: ToolOperation) => {
      operations.set(operation.id, operation);
    },
  } as unknown as RunOptions;
  const middleware = toolFeedback(options, new Set(), guard);
  let id = 0;
  const call = async (
    name: string,
    args: Record<string, unknown>,
    error?: Error,
  ) =>
    middleware.wrapToolCall!(
      {
        toolCall: { id: `fixture-${++id}`, name, args },
        tool: undefined,
        state: { messages: [] },
        runtime: {} as never,
      },
      async () => {
        if (error) throw error;
        return new ToolMessage({
          tool_call_id: `fixture-${id}`,
          content: "success",
        });
      },
    );
  return { guard, middleware, options, operations, activity, call };
}

test("changed edit arguments and interleaved reads cannot reset the same failure", async () => {
  const h = harness();
  const error = new Error("每段舊文字必須在檔案中恰好出現一次。");
  for (let i = 0; i < 2; i++) {
    await h.call(
      "workspace_edit_file",
      {
        path: "./src\\app.ts",
        edits: [{ oldText: `old ${i}`, newText: `new ${i}` }],
      },
      error,
    );
    await h.call("workspace_read_file", { path: "src/app.ts" });
  }
  await assert.rejects(
    h.call("workspace_edit_file", { path: "src/app.ts", edits: [] }, error),
    ToolFailureLoopError,
  );
  assert.equal(
    [...h.operations.values()].filter(
      (operation) => operation.status === "failed",
    ).length,
    3,
  );
  assert.match(h.activity.at(-1)!, /已停止自動重試/);
  assert.doesNotMatch(h.activity.at(-1)!, /交回模型修正/);
  await assert.rejects(
    h.call("workspace_read_file", { path: "src/app.ts" }),
    ToolFailureLoopError,
  );
});

test("different targets and error categories remain independent; matching success recovers", async () => {
  const h = harness();
  for (const path of ["a.ts", "b.ts", "c.ts"])
    await h.call(
      "workspace_edit_file",
      { path },
      new Error("每段舊文字必須在檔案中恰好出現一次。"),
    );
  await h.call(
    "workspace_edit_file",
    { path: "a.ts" },
    new Error("permission denied"),
  );
  await h.call("workspace_edit_file", { path: "a.ts" });
  for (let i = 0; i < 2; i++)
    await h.call(
      "workspace_edit_file",
      { path: "a.ts", edits: [i] },
      new Error("每段舊文字必須在檔案中恰好出現一次。"),
    );
  h.guard.assertActive();
});

test("shell nonzero exits share a check identity across argument changes; unrelated read success does not recover", async () => {
  const h = harness();
  for (let i = 0; i < 2; i++) {
    const feedback = await h.call(
      "shell",
      { command: `npm test -- --attempt=${i}`, timeout: 10 + i },
      new ToolExecutionError(`命令結束碼：${i + 1}`, {
        exitCode: i + 1,
        output: "test failed",
      }),
    );
    assert.ok(ToolMessage.isInstance(feedback));
    assert.match(String(feedback.content), /Command output:\ntest failed/);
    await h.call("shell", { command: "cat package.json" });
  }
  await assert.rejects(
    h.call(
      "shell",
      { command: "npm test -- --reporter=verbose" },
      new ToolExecutionError("command failed", { exitCode: 3 }),
    ),
    ToolFailureLoopError,
  );
});

test("successful same check resets prior failures; unrelated inline shell success cannot", async () => {
  const h = harness();
  const error = new ToolExecutionError("命令結束碼：1", { exitCode: 1 });
  await h.call("shell", { command: "node --test app.test.js" }, error);
  await h.call("shell", { command: "node --test app.test.js" });
  await h.call("shell", { command: "node --test app.test.js" }, error);
  await h.call("shell", { command: "node --test app.test.js" }, error);
  h.guard.assertActive();
  const inline = harness();
  for (let i = 0; i < 2; i++) {
    await inline.call(
      "shell",
      { command: `node -e 'throw new Error("${i}")'` },
      error,
    );
    await inline.call("shell", { command: "node -e 'console.log(1)'" });
  }
  await assert.rejects(
    inline.call("shell", { command: "node -e 'throw new Error(3)'" }, error),
    ToolFailureLoopError,
  );
});

test("verify_web uses stable path and assertion category; shell aliases share failures", async () => {
  const web = harness();
  for (let i = 0; i < 2; i++)
    await web.call(
      "verify_web",
      { path: "./index.html", assertions: [i] },
      new ToolExecutionError(`斷言 ${i} 失敗`, {}),
    );
  await assert.rejects(
    web.call(
      "verify_web",
      { path: "index.html", assertions: [3] },
      new ToolExecutionError("驗證斷言失敗", {}),
    ),
    ToolFailureLoopError,
  );
  const shell = harness();
  for (const name of ["shell", "workspace_shell"])
    await shell.call(
      name,
      { command: "npm test" },
      new ToolExecutionError("命令結束碼：1", { exitCode: 1 }),
    );
  await assert.rejects(
    shell.call(
      "shell",
      { command: "npm test" },
      new ToolExecutionError("命令結束碼：1", { exitCode: 1 }),
    ),
    ToolFailureLoopError,
  );
});

test("failure loop ends the run as failed, preserves local effects and operation journal, and permits a fresh run", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-failure-loop-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  t.after(async () => {
    store.conversations.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  let first = true;
  const tasks = new TaskService(store, workspace, async (options) => {
    if (!first) return { text: "fresh run" };
    first = false;
    await options.workspace.write("kept.txt", "completed local effect");
    const middleware = toolFeedback(options, new Set());
    for (let i = 0; i < 3; i++)
      await middleware.wrapToolCall!(
        {
          toolCall: {
            id: `failure-${i}`,
            name: "workspace_edit_file",
            args: { path: "kept.txt", oldText: `attempt ${i}` },
          },
          tool: undefined,
          state: { messages: [] },
          runtime: {} as never,
        },
        async () => {
          throw new Error("每段舊文字必須在檔案中恰好出現一次。");
        },
      );
    throw new Error("Guard unexpectedly allowed completion");
  });
  await tasks.runs.init();
  const session = await tasks.create();
  await assert.rejects(tasks.run(session.id, "fixture", true), /需要你處理/);
  const reloaded = await new RunStore(store.directory).init();
  const run = reloaded.list(session.id)[0];
  assert.equal(run.status, "failed");
  assert.match(run.error!, /已停止自動重試/);
  assert.equal(run.operations.length, 3);
  assert.ok(run.operations.every((operation) => operation.status === "failed"));
  assert.equal(
    await readFile(join(run.location!.path, "kept.txt"), "utf8"),
    "completed local effect",
  );
  assert.equal(
    await tasks.run(session.id, "try a revised task", true),
    "fresh run",
  );
});

test("a saturated guard blocks model handlers and never exposes raw failure data in the terminal error", async () => {
  const h = harness();
  for (let i = 0; i < 2; i++)
    await h.call(
      "workspace_write_file",
      { path: "index.html", content: `private ${i}` },
      new Error("permission denied: PRIVATE_REASONING_MARKER"),
    );
  await assert.rejects(
    h.call(
      "workspace_write_file",
      { path: "index.html" },
      new Error("permission denied: PRIVATE_REASONING_MARKER"),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ToolFailureLoopError);
      assert.doesNotMatch(error.message, /PRIVATE_REASONING_MARKER/);
      return true;
    },
  );
  let requests = 0;
  await assert.rejects(
    async () =>
      h.middleware.wrapModelCall!({} as never, async () => {
        requests++;
        return {} as never;
      }),
    ToolFailureLoopError,
  );
  assert.equal(requests, 0);
});

// Entirely in-process graph fixture: no provider, HTTP listener, or network call.
class ScriptedModel extends BaseChatModel {
  calls = 0;
  _llmType() {
    return "failure-loop-fixture";
  }
  bindTools() {
    return this;
  }
  async _generate() {
    const n = ++this.calls;
    return {
      generations: [
        {
          text: "",
          message: new AIMessage({
            content: "",
            tool_calls: [
              {
                id: `graph-${n}`,
                name: n % 2 ? "workspace_edit_file" : "workspace_read_file",
                args: { path: "app.ts", edit: `attempt ${n}` },
                type: "tool_call",
              },
            ],
          }),
        },
      ],
    };
  }
}

for (const swallowToolError of [false, true]) {
  test(`Deep graph stops after three same failures without a sixth model turn (outer swallow=${swallowToolError})`, async () => {
    const h = harness();
    const model = new ScriptedModel({});
    let effects = 0;
    const outer = createMiddleware({
      name: "FixtureSwallow",
      wrapToolCall: async (request, handler) => {
        try {
          return await handler(request);
        } catch {
          return new ToolMessage({
            tool_call_id: request.toolCall.id!,
            content: "converted tool error",
            status: "error",
          });
        }
      },
    });
    const agent = createDeepAgent({
      model,
      tools: [
        tool(
          async () => {
            effects++;
            throw new Error("每段舊文字必須在檔案中恰好出現一次。");
          },
          {
            name: "workspace_edit_file",
            description: "fixture",
            schema: z.object({ path: z.string(), edit: z.string() }),
          },
        ),
        tool(async () => "fixture file", {
          name: "workspace_read_file",
          description: "fixture",
          schema: z.object({ path: z.string(), edit: z.string() }),
        }),
      ],
      middleware: [...(swallowToolError ? [outer] : []), h.middleware],
    });
    await assert.rejects(
      agent.invoke(
        { messages: [{ role: "user", content: "fixture" }] },
        { recursionLimit: 50 },
      ),
      /同一操作持續失敗 3 次/,
    );
    assert.equal(model.calls, 5);
    assert.equal(effects, 3);
    assert.equal(
      [...h.operations.values()].filter(
        (operation) => operation.status === "failed",
      ).length,
      3,
    );
  });
}
