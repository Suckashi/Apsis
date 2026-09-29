import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../server/app.ts";
import type { CodingTask } from "../shared/coding.ts";
import type { WebVerification } from "../shared/coding-verification.ts";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-verification-api-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    worktreeRoot: join(directory, "isolated-worktrees"),
    runner: async () => ({ text: "fixture completed" }),
  });
  t.after(async () => {
    await app.product.close();
    app.product.db.db.close();
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  });
  const connection = await app.connections.save({
    name: "Fixture",
    provider: "openai-compatible",
    model: "fixture",
    url: "http://127.0.0.1:1/v1",
    modelSettings: { fixture: { contextWindowTokens: 128000 } },
  });
  await app.connections.setDefault({
    connectionId: connection.id,
    model: connection.model,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v2`;
  const request = (path: string, method = "GET") =>
    fetch(base + path, {
      method,
      headers: { "x-apsis-client": "1" },
    });
  const verification = async (task: CodingTask) => {
    const response = await request(`/coding-tasks/${task.id}/verification`);
    assert.equal(response.status, 200);
    return (await response.json()) as {
      applicable: boolean;
      receipt: WebVerification | null;
    };
  };
  const createTask = async (
    botId: string,
    prompt = "API verification fixture",
  ) => {
    const task = await app.product.coding.create(botId, { prompt });
    for (let i = 0; app.product.coding.busy(task); i++) {
      assert.ok(i < 500, "fixture runner should settle");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await mkdir(task.location.path, { recursive: true });
    return task;
  };
  const receipt = async (
    task: CodingTask,
    path = "index.html",
    content = "<h1>Ready</h1>",
  ) => {
    await mkdir(dirname(join(task.location.path, path)), { recursive: true });
    await writeFile(join(task.location.path, path), content);
    const record: WebVerification = {
      id: randomUUID(),
      taskId: task.id,
      runId: app.product.coding.detail(task.id).runs[0].id,
      path,
      checkedAt: new Date().toISOString(),
      status: "passed",
      assertions: 1,
      steps: [
        {
          action: "expect_text",
          selector: "h1",
          value: "Ready",
          status: "passed",
        },
      ],
      errors: [],
      files: { [path]: createHash("sha256").update(content).digest("hex") },
    };
    app.product.db.put("web-verification", record);
    return record;
  };
  return { ...app, request, verification, createTask, receipt };
}

test("verification API recognizes a nested snake/index.html before any check runs", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.create("Nested web project");
  const task = await f.createTask(bot.id);
  await mkdir(join(task.location.path, "snake"));
  await writeFile(
    join(task.location.path, "snake", "index.html"),
    "<!doctype html><h1>Snake</h1>",
  );
  assert.deepEqual(await f.verification(task), {
    applicable: true,
    receipt: null,
  });
});

test("verification API stays inapplicable for an empty or non-HTML task", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.create("Python project");
  const task = await f.createTask(bot.id);
  assert.deepEqual(await f.verification(task), {
    applicable: false,
    receipt: null,
  });
  await writeFile(join(task.location.path, "main.py"), 'print("ready")\n');
  await writeFile(join(task.location.path, "README.md"), "# Python tool\n");
  assert.deepEqual(await f.verification(task), {
    applicable: false,
    receipt: null,
  });
});

test("verification API returns only the latest receipt belonging to the requested task", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.create("Two projects");
  const first = await f.createTask(bot.id, "First project");
  const second = await f.createTask(bot.id, "Second project");
  const empty = await f.createTask(bot.id, "Unverified project");
  await f.receipt(first);
  const latestFirst = await f.receipt(first, "snake/index.html");
  const latestSecond = await f.receipt(second, "other.html");
  assert.deepEqual(await f.verification(first), {
    applicable: true,
    receipt: { ...latestFirst, stale: false },
  });
  assert.deepEqual(await f.verification(second), {
    applicable: true,
    receipt: { ...latestSecond, stale: false },
  });
  assert.deepEqual(await f.verification(empty), {
    applicable: false,
    receipt: null,
  });
  assert.equal(
    (await f.request("/coding-tasks/unknown/verification")).status,
    404,
  );
});

test("deleting a Bot clears all of its task receipts and preserves other Bots' receipts", async (t) => {
  const f = await fixture(t);
  const removedBot = await f.product.create("Remove me");
  const retainedBot = await f.product.create("Keep me");
  const first = await f.createTask(removedBot.id, "Removed task one");
  const second = await f.createTask(removedBot.id, "Removed task two");
  const retained = await f.createTask(retainedBot.id, "Retained task");
  await f.receipt(first);
  await f.receipt(first, "nested/index.html");
  await f.receipt(second);
  const keptReceipt = await f.receipt(retained);
  assert.equal(f.product.db.all("web-verification").length, 4);
  assert.equal(
    (await f.request(`/bots/${removedBot.id}`, "DELETE")).status,
    200,
  );
  assert.deepEqual(f.product.db.all<WebVerification>("web-verification"), [
    keptReceipt,
  ]);
  assert.equal(
    (await f.request(`/coding-tasks/${first.id}/verification`)).status,
    404,
  );
  assert.equal(
    (await f.request(`/coding-tasks/${second.id}/verification`)).status,
    404,
  );
  assert.deepEqual(await f.verification(retained), {
    applicable: true,
    receipt: { ...keptReceipt, stale: false },
  });
});
