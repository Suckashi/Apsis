import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAgent } from "../server/agent.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import type { Session, ToolOperation } from "../shared/types.ts";

test("native invalid path returns to model, workspace correction succeeds, retry does not replay write", async (t) => {
  const requests: any[] = [];
  const operations: ToolOperation[] = [];
  const commentary: string[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(input);
    const n = requests.length;
    if (n === 1 || n === 4) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "temporarily unavailable" } }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: `chunk-${n}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (n === 2 || n === 3) {
      const name = n === 2 ? "write_file" : "workspace_write_file";
      const args =
        n === 2
          ? { file_path: "C:\\game\\snake.html", content: "bad" }
          : { path: "snake/index.html", content: "<h1>Snake</h1>" };
      send({
        role: "assistant",
        content: n === 2 ? "先建立遊戲檔案。" : "路徑被拒絕，改用工作區工具。",
        reasoning_content: "PRIVATE_REASONING_SHOULD_NOT_APPEAR",
        tool_calls: [
          {
            index: 0,
            id: `tool-${n}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
      send({}, "tool_calls");
    } else {
      send({ role: "assistant", content: "Game file created." });
      send({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const dir = await mkdtemp(join(tmpdir(), "apsis-recovery-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  const session: Session = {
    id: "recovery",
    title: "Test",
    mode: "deepagents",
    createdAt: new Date().toISOString(),
    messages: [],
  };
  store.conversations.saveSession(session);
  session.workContextId = store.conversations.activeId(session.id);
  const result = await runAgent({
    mode: "deepagents",
    session,
    store,
    workspace,
    allowWrites: true,
    modelSettings: { contextWindowTokens: 128000 },
    env: {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_ID: "fixture",
      COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
    },
    signal: AbortSignal.timeout(25000),
    emit: (event) => {
      if (event.type === "commentary") commentary.push(event.text);
    },
    prompt: "Write a snake game",
    recordOperation: async (op) => {
      operations.push(structuredClone(op));
    },
  });
  assert.equal(result.text, "Game file created.");
  assert.deepEqual(commentary, [
    "先建立遊戲檔案。",
    "路徑被拒絕，改用工作區工具。",
  ]);
  assert.equal(
    await readFile(join(workspace.root, "snake/index.html"), "utf8"),
    "<h1>Snake</h1>",
  );
  assert.equal(requests.length, 5);
  assert.match(JSON.stringify(requests[2].messages), /workspace_write_file/);
  assert.match(JSON.stringify(requests[2].messages), /虛擬檔案路徑/);
  assert.ok(
    operations.some(
      (op) => op.name === "scratch_write_file" && op.status === "started",
    ),
  );
  assert.ok(
    operations.some(
      (op) => op.name === "scratch_write_file" && op.status === "failed",
    ),
  );
  assert.equal(
    operations.filter(
      (op) => op.name === "write_file" && op.status === "succeeded",
    ).length,
    1,
  );
  assert.equal(
    operations.filter(
      (op) => op.name === "model_retry" && op.status === "succeeded",
    ).length,
    2,
  );
});
import { toolFeedback } from "../server/tool-feedback.ts";
import type { RunOptions } from "../server/runtime.ts";
import { ToolMessage } from "@langchain/core/messages";

test("same failed tool arguments stop before a fourth execution; cancellation escapes", async () => {
  const controller = new AbortController();
  const options = {
    signal: controller.signal,
    emit: () => {},
  } as unknown as RunOptions;
  const middleware = toolFeedback(options, new Set());
  let calls = 0;
  const request = {
    toolCall: {
      id: "bad",
      name: "write_file",
      args: { file_path: "C:/bad", content: "x" },
    },
    tool: undefined,
    state: { messages: [] },
    runtime: {} as never,
  };
  const handler = async () => {
    calls++;
    throw new Error("無效的虛擬檔案路徑。");
  };
  for (let i = 0; i < 2; i++) {
    const result = await middleware.wrapToolCall!(request, handler);
    assert.ok(ToolMessage.isInstance(result));
    assert.equal(result.status, "error");
  }
  await assert.rejects(
    async () => middleware.wrapToolCall!(request, handler),
    /停止自動重試/,
  );
  assert.equal(calls, 3);
  controller.abort();
  await assert.rejects(async () => middleware.wrapToolCall!(request, handler), {
    name: "AbortError",
  });
  assert.equal(calls, 3);
});
