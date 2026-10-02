import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { createApp } from "../server/app.ts";
import type { RunOptions } from "../server/runtime.ts";
import { createTools } from "../server/tools.ts";
import type { Approval, Job } from "../shared/product.ts";
import { ProductDB } from "../server/product-db.ts";
import { RunSlots } from "../server/run-slots.ts";

async function until(check: () => boolean, describe = () => "") {
  // These assert scheduling/slot invariants, not cold Windows disk latency.
  // Job startup persists runs and prepares workspaces before invoking a runner.
  const deadline = Date.now() + 30000;
  while (!check()) {
    assert.ok(
      Date.now() < deadline,
      "Timed out waiting for concurrency state: " + describe(),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return {
    release,
    wait(signal?: AbortSignal) {
      let abort: () => void;
      return new Promise<void>((resolve, reject) => {
        abort = () => reject(signal!.reason);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        void promise.then(resolve);
      }).finally(() => signal?.removeEventListener("abort", abort));
    },
  };
}

async function fixture(
  t: TestContext,
  maxConcurrent: number,
  runner: (options: RunOptions) => Promise<{ text: string }>,
) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-settings-concurrency-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    runner,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => {
    await app.product.close();
    await until(
      () => !app.product.execution.active.size && !app.tasks.running.size,
    );
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  });
  const request = async (path: string, body: unknown) => {
    const response = await fetch(
      `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v2${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
        body: JSON.stringify(body),
      },
    );
    assert.ok(response.ok, await response.text());
  };
  const connection = await app.connections.save({
    name: "Stub",
    provider: "openai-compatible",
    model: "stub",
    modelSettings: { stub: { contextWindowTokens: 128000 } },
    url: "http://127.0.0.1:1/v1",
  });
  await app.connections.setDefault({
    connectionId: connection.id,
    model: "stub",
  });
  app.product.settings.update(
    {
      maxConcurrent,
      permissionRules: [
        { id: "fixture-shell", scope: "global", tool: "shell", effect: "ask" },
      ],
    },
    app.product.settings.read().revision,
  );
  const parent = await app.product.bots.create("Parent");
  const workers = await Promise.all(
    ["First", "Second", "Third", "Fourth"].map((name) =>
      app.product.bots.create(name),
    ),
  );
  return {
    ...app,
    parent,
    workers,
    request,
    jobs: () => app.product.db.all<Job>("job"),
    start: () =>
      app.product.jobs.submit(parent.id, {
        requestId: "root",
        prompt: "parent",
      }),
    settled: () => until(() => !app.product.execution.active.size),
  };
}

function delegate(options: RunOptions, botId: string, prompt: string) {
  return createTools(options)
    .find((tool) => tool.name === "delegate_task")!
    .execute(prompt, { botId, prompt }, options.signal);
}

// Exercise the real authorization/tool wrapper without launching a host shell.
function approvedEffect(options: RunOptions, effect: () => void) {
  return stubTool(options, "shell", async () => effect());
}

function stubTool(
  options: RunOptions,
  name: string,
  effect: () => Promise<void>,
) {
  assert.ok(
    options.executeAuthorizedTool,
    "production execution hook must be installed",
  );
  return createTools({
    ...options,
    extraTools: [
      ...(options.extraTools || []),
      {
        name,
        label: "Stub tool",
        description: "Record an approved effect",
        parameters: Type.Object({}),
        execute: async () => {
          await effect();
          return { content: [{ type: "text", text: "done" }], details: {} };
        },
      },
    ],
  })
    .findLast((tool) => tool.name === name)!
    .execute("approved-effect", {}, options.signal);
}

test("work leases pin a suspended job until the last idempotent release", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const first = await slots.enterWork("parent");
  const second = await slots.enterWork("parent");
  const resume = slots.suspend("parent");
  let started = false;
  const child = slots.acquire("child", "root", 1).then(() => {
    started = true;
  });
  first();
  first();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, false);
  assert.equal(slots.isSuspended("parent"), false);
  second();
  await child;
  assert.equal(slots.isSuspended("parent"), true);
  slots.release("child");
  await resume();
  slots.close();
});

test("work leases join root FIFO, and cancelling a lease preserves its job", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const resume = slots.suspend("parent");
  await slots.acquire("holder", "root", 1);
  const order: string[] = [];
  const before = slots.acquire("before", "root", 1).then(() => {
    order.push("before");
  });
  const abort = new AbortController();
  const rejected = assert.rejects(slots.enterWork("parent", abort.signal), {
    name: "AbortError",
  });
  const work = slots.enterWork("parent").then((release) => {
    order.push("work");
    return release;
  });
  const after = slots.acquire("after", "root", 1).then(() => {
    order.push("after");
  });
  abort.abort();
  await rejected;
  slots.release("holder");
  await before;
  assert.deepEqual(order, ["before"]);
  slots.release("before");
  const release = await work;
  assert.deepEqual(order, ["before", "work"]);
  assert.equal(slots.isSuspended("parent"), false);
  release();
  await after;
  assert.deepEqual(order, ["before", "work", "after"]);
  slots.release("after");
  await resume();
  slots.close();
});

test("work admission handles abort at grant, release/reuse, and close without leaked pins", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const abort = new AbortController();
  const rejected = assert.rejects(slots.enterWork("parent", abort.signal), {
    name: "AbortError",
  });
  abort.abort();
  await rejected;
  const stale = await slots.enterWork("parent");
  slots.release("parent");
  await slots.acquire("parent", "root", 1);
  stale();
  const resume = slots.suspend("parent");
  await slots.acquire("child", "root", 1);
  const pending = assert.rejects(slots.enterWork("parent"), {
    name: "AbortError",
  });
  slots.close();
  await pending;
  await resume();
  assert.equal(slots.isSuspended("parent"), false);
});

test("scoped nested helpers yield for internal waits and release pins on errors", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  await assert.rejects(
    slots.withWork("parent", async () => {
      await slots.withWork("parent", async () => {
        const resume = slots.suspend("parent");
        await slots.acquire("child", "root", 1);
        slots.release("child");
        await resume();
        assert.equal(slots.isSuspended("parent"), false);
      });
      throw new Error("tool failed");
    }),
    /tool failed/,
  );
  const resume = slots.suspend("parent");
  await slots.acquire("child", "root", 1);
  slots.release("child");
  await resume();
  slots.close();
});
