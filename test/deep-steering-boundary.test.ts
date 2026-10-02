import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeep } from "../server/engines/deep.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { restoreCheckpoint } from "../server/context-checkpoint.ts";
import type { RunOptions, SteerHandler } from "../server/runtime.ts";
import { steeringMiddleware } from "../server/steering-middleware.ts";
import { HumanMessage } from "@langchain/core/messages";

type Request = { messages: { role: string; content: unknown }[] };
function respond(res: ServerResponse, n: number, final = false) {
  const delta = final
    ? { role: "assistant", content: "finished" }
    : {
        role: "assistant",
        content: `inspect ${n}`,
        tool_calls: [
          {
            index: 0,
            id: `tool-${n}`,
            type: "function",
            function: {
              name: "workspace_list_files",
              arguments: '{"path":""}',
            },
          },
        ],
      };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({ id: `reply-${n}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: final ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
  );
}
async function fixture(
  handle: (res: ServerResponse, n: number, body: Request) => void,
) {
  const requests: Request[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as Request;
    requests.push(body);
    // Each fixture response is complete. Avoid idle pooled-socket reuse when
    // slow CI scheduling separates model turns; retry behavior is tested below.
    res.setHeader("Connection", "close");
    handle(res, requests.length, body);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const directory = await mkdtemp(join(tmpdir(), "apsis-deep-boundary-"));
  const store = await new Store(join(directory, "data")).init();
  const workspace = await new Workspace(join(directory, "work")).init();
  await store.conversations.saveSession({
    id: "fixture",
    title: "fixture",

    createdAt: new Date().toISOString(),
    messages: [],
  });
  return {
    requests,
    store,
    run: (extra: Partial<RunOptions> = {}) =>
      runDeep({
        store,
        workspace,
        session: store.conversations.load("fixture"),

        allowWrites: false,
        prompt: "inspect files",
        modelSettings: { contextWindowTokens: 128000 },
        env: {
          MODEL_PROVIDER: "openai-compatible",
          MODEL_ID: "fixture",
          COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
        },
        // Cold Deep Agents initialization plus three local HTTP model turns can
        // exceed 10s on Windows runners. This is a behavior test, not a latency
        // benchmark; retain a finite guard without changing its call assertions.
        signal: AbortSignal.timeout(30000),
        emit: () => {},
        ...extra,
      }),
    close: async () => {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      store.conversations.db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("tool-loop steering reaches the second internal model call once and persists before model execution", async (t) => {
  let applied = 0;
  const retries: string[] = [];
  const f = await fixture((res, n, request) => {
    if (n > 1) {
      assert.equal(applied, 1);
      assert.equal(
        request.messages.filter(
          (message) =>
            message.role === "user" &&
            message.content === "NEXT_MODEL_CONSTRAINT",
        ).length,
        1,
      );
      assert.ok(
        JSON.stringify(
          f.store.conversations.load("fixture").engineState,
        ).includes("NEXT_MODEL_CONSTRAINT"),
      );
    }
    respond(res, n, n === 3);
  });
  t.after(f.close);
  let steer!: SteerHandler;
  let queued = false;
  const result = await f
    .run({
      maxTurns: 3,
      recordOperation: async (operation) => {
        if (operation.name === "model_retry")
          retries.push(operation.target || "retry");
      },
      registerSteer: (handler) => {
        steer = handler;
      },
      emit: (event) => {
        if (
          !queued &&
          event.type === "activity" &&
          event.tool === "list_files" &&
          event.text === "執行 list_files"
        ) {
          queued = true;
          void steer("NEXT_MODEL_CONSTRAINT", async () => {
            applied++;
          });
          assert.equal(applied, 0);
        }
      },
    })
    .catch((error) => {
      t.diagnostic(JSON.stringify({ requests: f.requests.length, retries }));
      throw error;
    });
  assert.equal(
    f.requests.length,
    3,
    "three model turns must not be mistaken for three graph nodes",
  );
  assert.equal(applied, 1);
  assert.equal(
    restoreCheckpoint(result.engineState)?.messages.filter(
      (message) =>
        message.type === "human" && message.content === "NEXT_MODEL_CONSTRAINT",
    ).length,
    1,
  );
  await assert.rejects(steer("late"), /回合已結束/);
});

test("cancellation before the next model boundary never adopts or persists a queued supplement", async (t) => {
  const f = await fixture((res, n) => respond(res, n));
  t.after(f.close);
  const controller = new AbortController();
  let steer!: SteerHandler;
  let applied = 0;
  let queued = false;
  await assert.rejects(
    f.run({
      signal: controller.signal,
      registerSteer: (handler) => {
        steer = handler;
      },
      emit: (event) => {
        if (
          !queued &&
          event.type === "activity" &&
          event.tool === "list_files"
        ) {
          queued = true;
          void steer("MUST_NOT_SURVIVE_STOP", async () => {
            applied++;
          });
          controller.abort();
        }
      },
    }),
  );
  assert.equal(f.requests.length, 1);
  assert.equal(applied, 0);
  assert.doesNotMatch(
    JSON.stringify(f.store.conversations.load("fixture").engineState) || "",
    /MUST_NOT_SURVIVE_STOP/,
  );
});

test("a supplement staged before cancellation is excluded from saved history", async () => {
  const controller = new AbortController();
  let applied = 0;
  const queue = steeringMiddleware(
    controller.signal,
    () => {},
    () => assert.fail("must not persist an unadopted supplement"),
  );
  await queue.enqueue("staged but stopped", async () => {
    applied++;
  });
  const before = queue.middleware.beforeModel!;
  assert.equal(typeof before, "function");
  const update = await (
    before as (state: unknown, runtime: unknown) => { messages: HumanMessage[] }
  )({}, {});
  controller.abort();
  await assert.rejects(async () =>
    queue.middleware.wrapModelCall!(
      {
        messages: update.messages,
        state: { messages: update.messages },
      } as never,
      async () => assert.fail("must not invoke model"),
    ),
  );
  assert.equal(applied, 0);
  assert.equal(
    queue.forPersistence({ messages: update.messages }).messages.length,
    0,
  );
});

test("actual model-call budget stops before an extra request with a Chinese actionable error", async (t) => {
  const f = await fixture((res, n) => respond(res, n));
  t.after(f.close);
  await assert.rejects(f.run({ maxTurns: 2 }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /已達本次 2 次模型回合上限/);
    assert.match(error.message, /重新交辦/);
    assert.doesNotMatch(
      error.message,
      /Recursion limit|GRAPH_RECURSION_LIMIT|Traceback/,
    );
    return true;
  });
  assert.equal(f.requests.length, 2);
});

test("provider retries consume the same finite model budget", async (t) => {
  const f = await fixture((res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "fixture unavailable" } }));
  });
  t.after(f.close);
  await assert.rejects(f.run({ maxTurns: 2 }), /已達本次 2 次模型回合上限/);
  assert.equal(f.requests.length, 2);
});
