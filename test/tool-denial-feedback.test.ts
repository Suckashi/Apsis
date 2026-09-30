import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolMessage } from "@langchain/core/messages";
import { Type } from "typebox";
import { createApp } from "../server/app.ts";
import { RunStore } from "../server/runs.ts";
import type { RunOptions } from "../server/runtime.ts";
import { toolFeedback } from "../server/tool-feedback.ts";
import { createTools, ToolAuthorizationError } from "../server/tools.ts";
import type { ToolOperation } from "../shared/types.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for fixture");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(
  runner: (options: RunOptions) => Promise<{ text: string }>,
) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-tool-denial-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner,
  });
  clearInterval(app.product.timer);
  const connection = await app.connections.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture",
    modelSettings: { fixture: { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:1/v1",
  });
  await app.connections.setDefault({
    connectionId: connection.id,
    model: connection.model,
  });
  const bot = await app.product.bots.create("Fixture");
  return {
    ...app,
    bot,
    async run() {
      await app.product.jobs.submit(bot.id, {
        requestId: randomUUID(),
        prompt: "fixture",
      });
      await until(
        () => !app.product.execution.active.size && !app.tasks.running.size,
      );
      const run = app.tasks.runs.list(bot.sessionId)[0];
      assert.equal(run.status, "completed", run.error);
      return run;
    },
    async close() {
      await app.product.close();
      await until(
        () => !app.product.execution.active.size && !app.tasks.running.size,
      );
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("absolute workspace path denial is actionable and persists exactly one failed operation", async (t) => {
  let error: unknown;
  const f = await fixture(async (options) => {
    const write = createTools(options).find(
      (tool) => tool.name === "write_file",
    )!;
    const middleware = toolFeedback(options, new Set(["workspace_write_file"]));
    const result = await middleware.wrapToolCall!(
      {
        toolCall: {
          id: "denied-call",
          name: "workspace_write_file",
          args: { path: "C:/outside/index.html", content: "never written" },
        },
        tool: undefined,
        state: { messages: [] },
        runtime: {} as never,
      },
      async (request) => {
        try {
          await write.execute(
            "denied-call",
            request.toolCall.args,
            options.signal,
          );
        } catch (caught) {
          error = caught;
          throw caught;
        }
        return new ToolMessage({
          tool_call_id: "denied-call",
          content: "unexpected",
        });
      },
    );
    assert.ok(ToolMessage.isInstance(result));
    assert.equal(result.status, "error");
    assert.match(String(result.content), /相對路徑.*index\.html/);
    return { text: "denial handled" };
  });
  t.after(f.close);
  const run = await f.run();
  assert.ok(error instanceof ToolAuthorizationError);
  assert.equal(error.status, 403);
  assert.equal(run.operations.length, 1);
  assert.equal(run.operations[0].name, "write_file");
  assert.equal(run.operations[0].status, "failed");
  assert.equal(run.operations[0].authorization?.reason, "invalid-path");
  assert.equal(
    run.timeline?.filter((entry) => entry.kind === "operation").length,
    1,
  );
  const reloaded = await new RunStore(f.tasks.store.directory).init();
  assert.deepEqual(
    reloaded.records.get(run.id)?.operations,
    JSON.parse(JSON.stringify(run.operations)),
  );
});

test("tool execution errors and framework rejection each persist once", async (t) => {
  let effects = 0;
  const f = await fixture(async (options) => {
    const write = createTools({
      ...options,
      extraTools: [
        {
          name: "write_file",
          label: "Write fixture",
          description: "Fixture",
          parameters: Type.Object({}),
          execute: async () => {
            effects++;
            throw new Error("fixture write failed");
          },
        },
      ],
    })
      .filter((tool) => tool.name === "write_file")
      .at(-1)!;
    const middleware = toolFeedback(options, new Set(["workspace_write_file"]));
    for (const frameworkFailure of [false, true]) {
      await middleware.wrapToolCall!(
        {
          toolCall: {
            id: randomUUID(),
            name: "workspace_write_file",
            args: { path: "index.html", content: "fixture", frameworkFailure },
          },
          tool: undefined,
          state: { messages: [] },
          runtime: {} as never,
        },
        async (request) => {
          if (frameworkFailure)
            throw new Error("fixture schema rejection before tool invocation");
          await write.execute("write", request.toolCall.args, options.signal);
          return new ToolMessage({
            tool_call_id: "write",
            content: "unexpected",
          });
        },
      );
    }
    return { text: "failures handled" };
  });
  t.after(f.close);
  const run = await f.run();
  assert.equal(effects, 1);
  assert.equal(run.operations.length, 2);
  assert.ok(
    run.operations.every(
      (operation) =>
        operation.status === "failed" && operation.name === "write_file",
    ),
  );
  assert.equal(
    run.timeline?.filter((entry) => entry.kind === "operation").length,
    2,
  );
});

test("shell denial before launch is failed; uncertain execution remains unknown", async (t) => {
  let effects = 0;
  const f = await fixture(async (options) => {
    const operations: ToolOperation[] = [];
    for (const gate of ["authorize", "recheck", "execution"] as const) {
      const denied = () => {
        throw new ToolAuthorizationError("fixture rule denial", {
          reason: "rule",
          matchedRuleIds: ["deny-rule"],
        });
      };
      const shell = createTools({
        ...options,
        recordOperation: async (operation) => {
          operations.push(structuredClone(operation));
          await options.recordOperation!(operation);
        },
        authorize:
          gate === "authorize"
            ? denied
            : async () => ({ fingerprint: "fixture", reason: "yolo-mode" }),
        checkToolPermission: gate === "recheck" ? denied : undefined,
        extraTools: [
          {
            name: "shell",
            label: "Shell fixture",
            description: "Fixture",
            parameters: Type.Object({}),
            execute: async () => {
              effects++;
              throw new Error("fixture connection lost after launch");
            },
          },
        ],
      })
        .filter((tool) => tool.name === "shell")
        .at(-1)!;
      await assert.rejects(
        shell.execute(gate, { command: "fixture" }, options.signal),
      );
    }
    assert.deepEqual(
      operations
        .filter((operation) => operation.status !== "started")
        .map((operation) => operation.status),
      ["failed", "failed", "unknown"],
    );
    return { text: "shell failures handled" };
  });
  t.after(f.close);
  const run = await f.run();
  assert.equal(effects, 1);
  assert.equal(run.operations.length, 3);
  assert.equal(run.operations[0].authorization?.reason, "rule");
  assert.equal(run.operations[1].authorization?.reason, "rule");
});
