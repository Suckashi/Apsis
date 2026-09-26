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
import { RunSlots } from "../server/run-slots.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for concurrency state");
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
    await until(() => !app.product.active.size && !app.tasks.running.size);
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
    0,
  );
  const parent = await app.product.create("Parent");
  const workers = await Promise.all(
    ["First", "Second", "Third", "Fourth"].map((name) =>
      app.product.create(name),
    ),
  );
  return {
    ...app,
    parent,
    workers,
    request,
    jobs: () => app.product.db.all<Job>("job"),
    start: () =>
      app.product.submit(parent.id, { requestId: "root", prompt: "parent" }),
    settled: () => until(() => !app.product.active.size),
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

test("maxConcurrent=1: parent delegates through tools and resumes without deadlock", async (t) => {
  const events: string[] = [];
  const f = await fixture(t, 1, async (options) => {
    assert.equal(options.runtimeSettings?.maxConcurrent, 1);
    events.push(options.prompt);
    if (options.prompt === "parent") {
      const result = await delegate(options, f.workers[0].id, "child");
      assert.match(JSON.stringify(result), /child result/);
      events.push("parent resumed");
    }
    return { text: `${options.prompt} result` };
  });
  await f.start();
  await f.settled();
  assert.deepEqual(events, ["parent", "child", "parent resumed"]);
  assert.ok(f.jobs().every((job) => job.status === "completed"));
  assert.equal(f.jobs().find((job) => job.parentJobId)?.rootJobId, "root");
});

for (const limit of [1, 2]) {
  test(`parallel delegate calls respect maxConcurrent=${limit} and inherited settings`, async (t) => {
    const gates = Array.from({ length: 4 }, gate);
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const f = await fixture(t, limit, async (options) => {
      assert.equal(options.runtimeSettings?.maxConcurrent, limit);
      if (options.prompt === "parent") {
        await Promise.all(
          f.workers.map((bot, i) => delegate(options, bot.id, String(i))),
        );
        assert.equal(
          active,
          0,
          "parent model continuation waits for all children",
        );
      } else {
        const i = Number(options.prompt);
        started.push(i);
        peak = Math.max(peak, ++active);
        try {
          await gates[i].wait(options.signal);
        } finally {
          active--;
        }
      }
      return { text: "done" };
    });
    await f.start();
    await until(() => started.length === limit);
    await until(() => f.jobs().length === 5);
    // Existing root and its descendants retain the captured settings.
    f.product.settings.update({ maxConcurrent: 4 }, 1);
    for (let i = 0; i < 4; i++) {
      await until(() => started.includes(i));
      assert.ok(active <= limit);
      gates[i].release();
    }
    await f.settled();
    assert.equal(peak, limit);
    assert.deepEqual(started, [0, 1, 2, 3]);
    assert.ok(f.jobs().every((job) => job.status === "completed"));
  });
}

test("stopping a child waiting for a slot never invokes its runner or leaks capacity", async (t) => {
  const hold = gate();
  const started: string[] = [];
  const f = await fixture(t, 1, async (options) => {
    if (options.prompt === "parent") {
      await Promise.all(
        f.workers
          .slice(0, 3)
          .map((bot, i) => delegate(options, bot.id, String(i))),
      );
    } else {
      started.push(options.prompt);
      if (options.prompt === "0") await hold.wait(options.signal);
    }
    return { text: "done" };
  });
  await f.start();
  await until(() => started.includes("0") && f.jobs().length === 4);
  const waiting = f.jobs().find((job) => job.botId === f.workers[1].id)!;
  assert.equal(waiting.status, "running");
  assert.equal(
    waiting.runId,
    undefined,
    "waiting job has not started a task run",
  );
  await f.request(`/bots/${f.workers[1].id}/stop`, {});
  await until(
    () => f.product.db.get<Job>("job", waiting.id)?.status === "cancelled",
  );
  hold.release();
  await f.settled();
  assert.deepEqual(started, ["0", "2"]);
  assert.equal(f.product.db.get<Job>("job", "root")?.status, "completed");
});

test("stopping parent cancels running children and children waiting for slots", async (t) => {
  const hold = gate();
  const started: string[] = [];
  const f = await fixture(t, 1, async (options) => {
    if (options.prompt === "parent") {
      await Promise.all(
        f.workers.map((bot, i) => delegate(options, bot.id, String(i))),
      );
    } else {
      started.push(options.prompt);
      await hold.wait(options.signal);
    }
    return { text: "done" };
  });
  await f.start();
  await until(() => started.length === 1 && f.jobs().length === 5);
  await f.request(`/bots/${f.parent.id}/stop`, {});
  await f.settled();
  assert.deepEqual(started, ["0"]);
  assert.ok(f.jobs().every((job) => job.status === "cancelled"));
  assert.equal(f.product.jobControllers.size, 0);
});

test("approval yields its slot to a sibling and reacquires before approved work", async (t) => {
  const hold = gate();
  let siblingStarted = false;
  let approvedWork = false;
  const f = await fixture(t, 1, async (options) => {
    if (options.prompt === "parent") {
      await Promise.all([
        delegate(options, f.workers[0].id, "approval"),
        delegate(options, f.workers[1].id, "sibling"),
      ]);
    } else if (options.prompt === "approval") {
      await approvedEffect(options, () => {
        approvedWork = true;
      });
    } else {
      siblingStarted = true;
      await hold.wait(options.signal);
    }
    return { text: "done" };
  });
  await f.start();
  await until(() => siblingStarted && f.product.pending.size === 1);
  const approval = f.product.db
    .all<Approval>("approval")
    .find((a) => a.status === "pending")!;
  f.product.decide(approval.id, { approved: true });
  // Let the approval continuation run while the sibling still owns the slot.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(approvedWork, false);
  hold.release();
  await f.settled();
  assert.equal(approvedWork, true);
  assert.ok(f.jobs().every((job) => job.status === "completed"));
});

test("close cancels approval waits, executing children, and slot waiters", async (t) => {
  const hold = gate();
  let siblingStarted = false;
  let forbiddenEffect = false;
  const f = await fixture(t, 1, async (options) => {
    if (options.prompt === "parent") {
      await Promise.all(
        f.workers
          .slice(0, 3)
          .map((bot, i) => delegate(options, bot.id, String(i))),
      );
    } else if (options.prompt === "0") {
      await approvedEffect(options, () => {
        forbiddenEffect = true;
      });
    } else if (options.prompt === "1") {
      siblingStarted = true;
      await hold.wait(options.signal);
    } else {
      forbiddenEffect = true;
    }
    return { text: "done" };
  });
  await f.start();
  await until(
    () =>
      siblingStarted && f.product.pending.size === 1 && f.jobs().length === 4,
  );
  await f.product.close();
  await f.settled();
  assert.equal(forbiddenEffect, false);
  assert.equal(f.product.pending.size, 0);
  assert.equal(f.product.jobControllers.size, 0);
  assert.ok(f.jobs().every((job) => job.status === "cancelled"));
});

test("approved parent work waits for the child's slot despite an early concurrent resume", async (t) => {
  const hold = gate();
  let childStarted = false;
  let approvalContinued = false;
  let active = 0;
  let peak = 0;
  const f = await fixture(t, 1, async (options) => {
    if (options.prompt === "parent") {
      await Promise.all([
        delegate(options, f.workers[0].id, "child"),
        approvedEffect(options, () => {
          peak = Math.max(peak, ++active);
          approvalContinued = true;
          assert.equal(f.product.slots.isSuspended("root"), false);
          active--;
        }),
      ]);
    } else {
      childStarted = true;
      peak = Math.max(peak, ++active);
      try {
        await hold.wait(options.signal);
      } finally {
        active--;
      }
    }
    return { text: "done" };
  });
  await f.start();
  await until(() => childStarted && f.product.pending.size === 1);
  const approval = f.product.db
    .all<Approval>("approval")
    .find((a) => a.status === "pending")!;
  f.product.decide(approval.id, { approved: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(approvalContinued, false);
  assert.equal(f.product.slots.isSuspended("root"), true);
  assert.equal(
    f.jobs().find((job) => job.parentJobId === "root")?.status,
    "running",
  );
  hold.release();
  await f.settled();
  assert.equal(approvalContinued, true);
  assert.ok(peak <= 1, `peak executable jobs ${peak} exceeded maxConcurrent=1`);
  assert.equal(active, 0);
  assert.ok(f.jobs().every((job) => job.status === "completed"));
});

test("internal approval yields only its branch pin and reacquires before tool effects", async (t) => {
  const activeTool = gate();
  const child = gate();
  let toolStarted = false;
  let childStarted = false;
  let effect = false;
  let active = 0;
  let peak = 0;
  const f = await fixture(t, 1, async (options) => {
    if (options.prompt === "parent") {
      await Promise.all([
        stubTool(options, "read_file", async () => {
          toolStarted = true;
          peak = Math.max(peak, ++active);
          try {
            await activeTool.wait(options.signal);
          } finally {
            active--;
          }
        }),
        stubTool(options, "list_files", async () => {
          // Like publish_file/create_document, this approval is inside execution.
          await options.authorize!(
            "shell",
            { command: "internal" },
            options.signal,
          );
          assert.equal(f.product.slots.isSuspended("root"), false);
          peak = Math.max(peak, ++active);
          effect = true;
          active--;
        }),
        delegate(options, f.workers[0].id, "child"),
      ]);
    } else {
      childStarted = true;
      peak = Math.max(peak, ++active);
      try {
        await child.wait(options.signal);
      } finally {
        active--;
      }
    }
    return { text: "done" };
  });
  await f.start();
  await until(
    () => toolStarted && f.product.pending.size === 1 && f.jobs().length === 2,
  );
  assert.equal(
    childStarted,
    false,
    "other executable branch still pins parent",
  );
  assert.equal(f.product.slots.isSuspended("root"), false);
  activeTool.release();
  await until(() => childStarted);
  assert.equal(f.product.slots.isSuspended("root"), true);
  const approval = f.product.db
    .all<Approval>("approval")
    .find((a) => a.status === "pending")!;
  f.product.decide(approval.id, { approved: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(effect, false);
  child.release();
  await f.settled();
  assert.equal(effect, true);
  assert.ok(peak <= 1, `peak executable jobs ${peak} exceeded maxConcurrent=1`);
  assert.equal(active, 0);
  assert.ok(f.jobs().every((job) => job.status === "completed"));
});

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
