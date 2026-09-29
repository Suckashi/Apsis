import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import type { RunOptions, SteerHandler } from "../server/runtime.ts";
import { runDeep } from "../server/engines/deep.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import type { ChatMessage } from "../shared/types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for steering state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(
  runner: (options: RunOptions) => Promise<{ text: string }>,
) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-steering-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const connection = await app.tasks.connections!.save({
    name: "Steering fixture",
    provider: "openai-compatible",
    model: "fixture",
    url: "http://127.0.0.1:1/v1",
  });
  await app.tasks.connections!.setDefault({
    connectionId: connection.id,
    model: connection.model,
  });
  const bot = await app.product!.create();
  const request = async (action: string, body: unknown) => {
    const response = await fetch(`${base}/api/v2/bots/${bot.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-apsis-client": "1" },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const close = async () => {
    await app.product!.close();
    app.product!.db.db.close();
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  };
  return { ...app, directory, bot, request, close, product: app.product! };
}

test("steering receipts separate enqueue and adoption, deduplicate concurrent retries and survive later failure", async (t) => {
  const callbacks: (() => Promise<void>)[] = [];
  const release = deferred();
  let enqueued = 0;
  const f = await fixture(async (options) => {
    options.registerSteer?.(async (_text, adopted) => {
      enqueued++;
      if (adopted) callbacks.push(adopted);
    });
    await release.promise;
    throw new Error("fixture model failed after adoption");
  });
  t.after(async () => {
    release.resolve();
    await f.close();
  });
  await f.request("messages", { prompt: "begin", requestId: "job-1" });
  await until(() => f.product.steers.has(f.bot.id));
  const responses = await Promise.all([
    f.request("steer", { prompt: "add constraint", requestId: "same" }),
    f.request("steer", { prompt: "add constraint", requestId: "same" }),
  ]);
  assert.equal(enqueued, 1);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.data.delivery.state, "pending");
  }
  const id = responses[0].data.messageId;
  assert.equal(responses[1].data.messageId, id);
  assert.equal(
    (await f.request("steer", { prompt: "different", requestId: "same" }))
      .status,
    409,
  );
  const before = f.tasks.store.conversations.message(f.bot.sessionId, id)!;
  assert.equal(before.status, "complete");
  assert.equal(before.delivery?.state, "pending");
  await callbacks[0]();
  assert.equal(
    f.tasks.store.conversations.message(f.bot.sessionId, id)?.delivery?.state,
    "applied",
  );
  assert.equal(
    (await f.request("steer", { prompt: "add constraint", requestId: "same" }))
      .data.delivery.state,
    "applied",
  );
  release.resolve();
  await until(() => !f.product.active.size);
  assert.equal(
    f.tasks.store.conversations.message(f.bot.sessionId, id)?.delivery?.state,
    "applied",
  );
  assert.equal(
    f.tasks.store.conversations
      .page(f.bot.sessionId)
      .messages.filter((message) => message.id === id).length,
    1,
  );
});

test("stopping while waiting for approval makes unconsumed supplements not-applied", async (t) => {
  const f = await fixture(async (options) => {
    options.registerSteer?.(async () => {});
    await options.authorize?.(
      "shell",
      { command: "fixture-command" },
      options.signal,
    );
    return { text: "unexpected execution" };
  });
  t.after(f.close);
  f.product.settings.update(
    {
      permissionRules: [
        { id: "ask-shell", scope: "global", tool: "shell", effect: "ask" },
      ],
    },
    f.product.settings.read().revision,
  );
  await f.request("messages", { prompt: "begin", requestId: "job-approval" });
  await until(() => f.product.pending.size === 1);
  const response = await f.request("steer", {
    prompt: "pending correction",
    requestId: "approval-steer",
  });
  assert.equal(response.data.delivery.state, "pending");
  await f.request("stop", {});
  await until(() => !f.product.active.size);
  assert.equal(
    f.tasks.store.conversations.message(
      f.bot.sessionId,
      response.data.messageId,
    )?.delivery?.state,
    "not-applied",
  );
  assert.equal(
    (await f.request("steer", { prompt: "too late", requestId: "late" }))
      .status,
    409,
  );
});

for (const outcome of ["failed", "completed"] as const) {
  test(`a ${outcome} run settles supplements the engine never consumed`, async (t) => {
    const release = deferred();
    const f = await fixture(async (options) => {
      options.registerSteer?.(async () => {});
      await release.promise;
      if (outcome === "failed")
        throw new Error("fixture failure before adoption");
      return { text: "finished before consuming" };
    });
    t.after(async () => {
      release.resolve();
      await f.close();
    });
    await f.request("messages", { prompt: "begin", requestId: "job" });
    await until(() => f.product.steers.has(f.bot.id));
    const response = await f.request("steer", {
      prompt: "constraint",
      requestId: "receipt",
    });
    release.resolve();
    await until(() => !f.product.active.size);
    assert.equal(
      f.tasks.store.conversations.message(
        f.bot.sessionId,
        response.data.messageId,
      )?.delivery?.state,
      "not-applied",
    );
  });
}

test("a run ending during receipt persistence rejects late enqueue and keeps a truthful receipt", async (t) => {
  const release = deferred();
  const f = await fixture(async (options) => {
    options.registerSteer?.(async () =>
      assert.fail("late instruction must not be enqueued"),
    );
    await release.promise;
    return { text: "finished" };
  });
  t.after(async () => {
    release.resolve();
    await f.close();
  });
  await f.request("messages", { prompt: "begin", requestId: "job-boundary" });
  await until(() => f.product.steers.has(f.bot.id));
  const original = f.tasks.store.mutate.bind(f.tasks.store);
  let intercepted = false;
  f.tasks.store.mutate = async (callback) => {
    const result = await original(callback);
    if (
      !intercepted &&
      f.tasks.store.conversations
        .page(f.bot.sessionId)
        .messages.some((message) => message.delivery?.state === "pending")
    ) {
      intercepted = true;
      release.resolve();
      await until(() => !f.product.active.size);
    }
    return result;
  };
  const response = await f.request("steer", {
    prompt: "late correction",
    requestId: "boundary",
  });
  assert.equal(response.status, 409);
  const message = f.tasks.store.conversations
    .page(f.bot.sessionId)
    .messages.find((message) => message.delivery);
  assert.equal(message?.delivery?.state, "not-applied");
  const duplicate = await f.request("steer", {
    prompt: "late correction",
    requestId: "boundary",
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.delivery.state, "not-applied");
});

test("restart expires only pending delivery receipts and preserves adopted history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-steering-restart-"));
  let store = await new Store(directory).init();
  const messages: ChatMessage[] = ["pending", "applied", "not-applied"].map(
    (state, index) => ({
      id: String(index),
      role: "user",
      content: state,
      status: "complete",
      delivery: {
        kind: "steer",
        state: state as NonNullable<ChatMessage["delivery"]>["state"],
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
    }),
  );
  await store.mutate((state) =>
    state.sessions.push({
      id: "owner",
      title: "owner",
      mode: "deepagents",
      createdAt: "2026-09-29",
      messages,
    }),
  );
  store.conversations.db.close();
  store = await new Store(directory).init();
  assert.deepEqual(
    store.conversations
      .page("owner")
      .messages.map((message) => message.delivery?.state),
    ["not-applied", "applied", "not-applied"],
  );
  store.conversations.db.close();
});

test("real Deep engine acknowledges only at the next turn and closes its final acceptance window", async (t) => {
  let steer: SteerHandler | undefined;
  let queued = false;
  let applied = 0;
  const requests: { messages: unknown[]; stream: boolean }[] = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (requests.length === 2) assert.equal(applied, 1);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: `reply-${requests.length}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "turn finished" }, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const directory = await mkdtemp(join(tmpdir(), "apsis-steering-engine-"));
  const store = await new Store(directory).init();
  t.after(() => store.conversations.db.close());
  await store.mutate((state) =>
    state.sessions.push({
      id: "owner",
      title: "owner",
      mode: "deepagents",
      createdAt: "2026-09-29",
      messages: [
        {
          id: "unused",
          role: "user",
          content: "NEVER_ADOPTED",
          status: "complete",
          delivery: {
            kind: "steer",
            state: "not-applied",
            updatedAt: "2026-09-29",
          },
        },
      ],
    }),
  );
  const workspace = await new Workspace(join(directory, "work")).init();
  await runDeep({
    store,
    workspace,
    session: store.conversations.load("owner"),
    mode: "deepagents",
    allowWrites: false,
    prompt: "initial request",
    env: {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_ID: "fixture",
      COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
    },
    signal: AbortSignal.timeout(15000),
    registerSteer: (handler) => {
      steer = handler;
    },
    emit: (event) => {
      if (event.type === "delta" && !queued) {
        queued = true;
        assert.equal(applied, 0);
        void steer!("EXTRA_CONSTRAINT", async () => {
          applied++;
        });
        assert.equal(applied, 0, "enqueue is not adoption");
      }
    },
  });
  assert.equal(requests.length, 2);
  assert.doesNotMatch(
    JSON.stringify(requests[0].messages),
    /EXTRA_CONSTRAINT|NEVER_ADOPTED/,
  );
  assert.match(JSON.stringify(requests[1].messages), /EXTRA_CONSTRAINT/);
  assert.equal(applied, 1);
  await assert.rejects(steer!("too late"), /回合已結束/);
  const controller = new AbortController();
  let stoppedSteer: SteerHandler | undefined;
  let stoppedAdoptions = 0;
  let stopQueued = false;
  await assert.rejects(
    runDeep({
      store,
      workspace,
      session: store.conversations.load("owner"),
      mode: "deepagents",
      allowWrites: false,
      prompt: "request to stop",
      env: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_ID: "fixture",
        COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      },
      signal: controller.signal,
      registerSteer: (handler) => {
        stoppedSteer = handler;
      },
      emit: (event) => {
        if (event.type === "delta" && !stopQueued) {
          stopQueued = true;
          void stoppedSteer!("DO_NOT_ADOPT_AFTER_STOP", async () => {
            stoppedAdoptions++;
          });
          controller.abort();
        }
      },
    }),
  );
  assert.equal(stoppedAdoptions, 0);
  await assert.rejects(stoppedSteer!("too late after abort"), /回合已結束/);
});
