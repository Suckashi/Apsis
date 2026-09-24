import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.ts";
import type { Job } from "../shared/product.ts";

test("Codex MCP bridge exposes real Apsis delegation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-codex-test-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner: async () => ({ text: "17 × 19 = 323" }),
  });
  try {
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    const connection = await app.connections.save({
      name: "Test Ollama",
      provider: "ollama",
      model: "qwen3.5:9b",
      url: "http://127.0.0.1:11434",
    });
    await app.connections.setDefault({
      connectionId: connection.id,
      model: connection.model,
    });
    const worker = await app.product.create("計算助理");
    const secretary = await app.product.create("秘書");
    const runId = randomUUID();
    app.product.db.put<Job>("job", {
      id: randomUUID(),
      botId: secretary.id,
      prompt: "派工",
      createdAt: new Date().toISOString(),
      status: "running",
      runId,
    });
    const token = randomUUID();
    app.codex.active.set(token, {
      tools: app.product.tools(secretary, runId),
      signal: new AbortController().signal,
    });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api/codex/mcp/`;
    const rpc = async (id: number, method: string, params: unknown) => {
      const response = await fetch(base + token, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as { result: any };
    };
    await rpc(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const listed = await rpc(2, "tools/list", {});
    assert.ok(
      listed.result.tools.some(
        (tool: { name: string }) => tool.name === "delegate_task",
      ),
    );
    const bots = await rpc(3, "tools/call", {
      name: "list_bots",
      arguments: {},
    });
    assert.match(bots.result.content[0].text, /計算助理/);
    const delegated = await rpc(4, "tools/call", {
      name: "delegate_task",
      arguments: { botId: worker.id, prompt: "計算 17 乘以 19" },
    });
    assert.match(delegated.result.content[0].text, /323/);
    assert.ok(
      app.product.db
        .all<Job>("job")
        .some(
          (job) =>
            job.parentJobId &&
            job.botId === worker.id &&
            job.status === "completed",
        ),
    );
    assert.equal(
      (await fetch(base + randomUUID(), { method: "POST" })).status,
      404,
    );
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await app.product.close();
  }
});

test("Codex Bot requires ChatGPT sign-in and never asks for an API key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-codex-auth-test-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
  });
  try {
    app.codex.inspect = async () => ({
      connected: false,
      plan: null,
      login: { state: "idle" },
      models: [],
    });
    const connection = await app.connections.save({
      name: "ChatGPT Codex",
      provider: "codex",
      model: "gpt-5.6-sol",
    });
    assert.equal(connection.credentialConfigured, true);
    assert.equal(
      app.connections.rows.find((row) => row.id === connection.id)?.apiKey,
      undefined,
    );
    await app.connections.setDefault({
      connectionId: connection.id,
      model: connection.model,
    });
    const bot = await app.product.create("秘書");
    const job = await app.product.submit(bot.id, {
      requestId: randomUUID(),
      prompt: "派工",
    });
    const deadline = Date.now() + 5000;
    while (app.product.active.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const finished = app.product.db.get<Job>("job", job.id);
    assert.equal(finished?.status, "failed");
    assert.match(finished?.error || "", /登入 ChatGPT/);
  } finally {
    await app.product.close();
    app.server.close();
  }
});
