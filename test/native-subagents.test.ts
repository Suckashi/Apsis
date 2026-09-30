import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAgent } from "../server/agent.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";

import type { Session } from "../shared/types.ts";

for (const scenario of [
  "success",
  "denied",
  "pre-cancelled",
  "cancelled",
  "model-cancelled",
] as const)
  test(`native parallel tasks: ${scenario}, guarded and observable`, async (t) => {
    const controller = new AbortController();
    const requests: any[] = [];
    const events: any[] = [];
    const operations: any[] = [];
    const authorized: string[] = [];
    let childRequests = 0;
    let releaseChildren!: () => void;
    const childrenStarted = new Promise<void>((resolve) => {
      releaseChildren = resolve;
    });
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(input);
      const messages = input.messages;
      const child = messages.find(
        (m: any) => m.role === "user" && /^Analyze [AB]$/.test(m.content),
      )?.content;
      if (
        child &&
        (scenario === "cancelled" || scenario === "model-cancelled")
      ) {
        // Both initial child calls are already in flight before cancellation.
        // Wait for the server to observe them before triggering the abort;
        // late receipt of an existing call is not a new model turn.
        if (++childRequests === 2) releaseChildren();
        await childrenStarted;
      }
      if (scenario === "model-cancelled" && child) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": child model running\n\n");
        setTimeout(() => controller.abort(), 20);
        return;
      }
      const toolMessages = messages.filter((m: any) => m.role === "tool");
      const tools = input.tools.map((t: any) => t.function.name);
      assert.ok(!tools.includes("execute"));
      const call = (id: string, name: string, args: unknown, index = 0) => ({
        index,
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
      let delta: any;
      if (!child && !toolMessages.length) {
        assert.ok(tools.includes("task"));
        delta = {
          role: "assistant",
          content: "正在分析。",
          tool_calls: [
            call("child-A", "task", {
              description: "Analyze A",
              subagent_type: "general-purpose",
            }),
            call(
              "child-B",
              "task",
              { description: "Analyze B", subagent_type: "general-purpose" },
              1,
            ),
          ],
        };
      } else if (child && !toolMessages.length) {
        assert.ok(tools.includes("workspace_read_file"));
        assert.ok(tools.includes("write_todos"));
        delta = {
          role: "assistant",
          content: "Child public progress " + child,
          tool_calls: [
            call("todo-" + child, "write_todos", {
              todos: [{ content: "Inspect proof", status: "in_progress" }],
            }),
            call(
              "read-" + child,
              "workspace_read_file",
              { path: "proof.txt" },
              1,
            ),
          ],
        };
      } else
        delta = {
          role: "assistant",
          content: child ? "Child result " + child : "Parent final",
        };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "chunk-" + requests.length, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ id: "end-" + requests.length, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const dir = await mkdtemp(join(tmpdir(), "apsis-native-"));
    const store = await new Store(join(dir, "data")).init();
    const workspace = await new Workspace(join(dir, "work")).init();
    await workspace.write("proof.txt", "PROOF");
    const session: Session = {
      id: "test",
      title: "test",

      createdAt: new Date().toISOString(),
      messages: [],
    };
    if (scenario === "pre-cancelled") controller.abort();
    const execution = runAgent({
      session,
      store,
      workspace,
      prompt: "Analyze in parallel",
      allowWrites: false,
      modelSettings: { contextWindowTokens: 128000 },
      env: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_ID: "fixture",
        COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
        COMPATIBLE_API_KEY: "test",
      },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      emit: (e) => events.push(e),
      recordOperation: async (op) => {
        operations.push(op);
      },
      authorize: async (name) => {
        authorized.push(name);
        if (name === "read_file" && scenario === "denied")
          throw new Error("Permission denied");
        if (name === "read_file" && scenario === "cancelled") {
          controller.abort();
          controller.signal.throwIfAborted();
        }
      },
    });
    if (scenario === "pre-cancelled") {
      await assert.rejects(execution, { name: "AbortError" });
      assert.equal(requests.length, 0);
      assert.equal(authorized.length, 0);
      return;
    }
    if (scenario === "cancelled" || scenario === "model-cancelled") {
      await assert.rejects(execution);
      const children = events
        .filter((e) => e.type === "execution" && e.evidence.kind === "subagent")
        .map((e) => e.evidence.activity);
      assert.ok(children.some((c) => c.status === "cancelled"));
      assert.ok(
        !operations.some(
          (o) => o.name === "read_file" && o.status === "succeeded",
        ),
      );
      const count = requests.length;
      assert.equal(count, 3, "parent and both initial child requests executed");
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(requests.length, count);
      return;
    }
    const result = await execution;
    assert.equal(result.text, "Parent final");
    assert.ok(
      events
        .filter((e) => e.type === "delta")
        .every((e) => !e.text.includes("Child")),
    );
    const activity = events
      .filter((e) => e.type === "execution" && e.evidence.kind === "subagent")
      .map((e) => e.evidence.activity);
    assert.deepEqual([...new Set(activity.map((a) => a.id))].sort(), [
      "child-A",
      "child-B",
    ]);
    for (const id of ["child-A", "child-B"]) {
      if (scenario === "success")
        assert.ok(
          activity.some(
            (a) => a.id === id && a.progress?.includes("proof.txt"),
          ),
        );
      assert.ok(
        activity.some(
          (a) => a.id === id && a.progress?.includes("Child public progress"),
        ),
      );
      assert.match(
        activity.findLast((a) => a.id === id).resultSummary,
        /Child result/,
      );
      assert.equal(activity.findLast((a) => a.id === id).status, "completed");
      assert.ok(
        operations.some(
          (o) =>
            o.name === "read_file" &&
            o.subagentId === id &&
            o.status === (scenario === "denied" ? "failed" : "succeeded"),
        ),
      );
    }
    assert.equal(authorized.filter((n) => n === "read_file").length, 2);
    assert.equal(
      events.filter(
        (e) => e.type === "execution" && e.evidence.kind === "planning",
      ).length,
      2,
    );
  });
