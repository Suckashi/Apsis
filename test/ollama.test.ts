import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Settings } from "../server/settings.ts";
import { createApp } from "../server/app.ts";
import { configuration, runPi } from "../server/agent.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import {
  ollamaUrl,
  ollamaModelName,
  discoverOllama,
} from "../server/ollama.ts";

test("local Ollama settings preserve cloud keys and normalize loopback URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-ollama-"));
  const settings = await new Settings(dir, {
    OPENAI_API_KEY: "cloud-secret",
    ANTHROPIC_API_KEY: "other-secret",
  }).init();
  await settings.update("pi", {
    provider: "ollama",
    model: "qwen3.5:9b",
    url: "http://127.0.0.1:11434/v1/",
  });
  assert.equal(settings.environment().OLLAMA_URL, "http://127.0.0.1:11434");
  assert.equal(settings.environment().OPENAI_API_KEY, "cloud-secret");
  assert.equal(configuration(settings.environment()).piReady, true);
  assert.equal(
    (await new Settings(dir, {}).init()).view().pi.provider,
    "ollama",
  );
  assert.ok(!JSON.stringify(settings.view()).includes("cloud-secret"));
  await assert.rejects(
    settings.update("pi", {
      provider: "ollama",
      model: "qwen3.5:9b",
      apiKey: "cloud-secret",
    }),
    { status: 400 },
  );
  for (const value of [
    "https://api.example.com",
    "http://user:pass@localhost:11434",
    "http://localhost:11434/path",
    "http://localhost:11434?key=x",
    "file:///tmp/x",
  ])
    assert.throws(() => ollamaUrl(value), { status: 400 });
  assert.equal(ollamaUrl("http://[::1]:11434/v1"), "http://[::1]:11434");
  await assert.rejects(
    settings.update("pi", {
      provider: "ollama",
      model: "qwen3.5:9b",
      url: null,
    }),
    { status: 400 },
  );
  for (const name of ["qwen:cloud", "qwen-cloud", "", "model\nother"])
    assert.throws(() => ollamaModelName(name), { status: 400 });
});

test("model discovery reports installed local models and protects its HTTP route", async (t) => {
  const ollama = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        models: [
          { name: "qwen3.5:9b" },
          { name: "remote:cloud" },
          { name: "alias", remote_host: "https://remote.example" },
        ],
      }),
    );
  });
  ollama.listen(0, "127.0.0.1");
  await once(ollama, "listening");
  t.after(() => ollama.close());
  const url = "http://127.0.0.1:" + (ollama.address() as AddressInfo).port;
  assert.deepEqual(await discoverOllama(url), [
    { id: "qwen3.5:9b", name: "qwen3.5:9b" },
  ]);
  const dir = await mkdtemp(join(tmpdir(), "talaria-ollama-api-"));
  const { server } = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    env: {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const endpoint =
    "http://127.0.0.1:" +
    (server.address() as AddressInfo).port +
    "/api/ollama/models";
  assert.equal(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
    ).status,
    403,
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
    body: JSON.stringify({ url }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json())[0].id, "qwen3.5:9b");
});

test("Pi uses real OpenAI-compatible SSE transport for Ollama without forwarding cloud credentials", async (t) => {
  let received = false;
  const ollama = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer ollama");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(input.model, "qwen3.5:9b");
    assert.equal(input.stream, true);
    assert.equal(input.reasoning_effort, "none");
    assert.equal(input.store, undefined);
    assert.ok(
      input.tools.some(
        (tool: { function: { name: string } }) =>
          tool.function.name === "read_file",
      ),
    );
    received = true;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null) => ({
      id: "local-test",
      object: "chat.completion.chunk",
      created: 1,
      model: input.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.write(
      "data: " +
        JSON.stringify(
          chunk({ role: "assistant", content: "local transport ready" }, null),
        ) +
        "\n\n",
    );
    res.end(
      "data: " + JSON.stringify(chunk({}, "stop")) + "\n\ndata: [DONE]\n\n",
    );
  });
  ollama.listen(0, "127.0.0.1");
  await once(ollama, "listening");
  t.after(() => ollama.close());
  const dir = await mkdtemp(join(tmpdir(), "talaria-ollama-stream-"));
  const result = await runPi({
    prompt: "hello",
    session: {},
    store: await new Store(join(dir, "data")).init(),
    workspace: await new Workspace(join(dir, "work")).init(),
    allowWrites: false,
    emit() {},
    signal: AbortSignal.timeout(10000),
    env: {
      PI_PROVIDER: "ollama",
      PI_MODEL: "qwen3.5:9b",
      OLLAMA_URL: "http://127.0.0.1:" + (ollama.address() as AddressInfo).port,
      OPENAI_API_KEY: "never-forward-cloud-secret",
    },
  });
  assert.equal(received, true);
  assert.equal(result.text, "local transport ready");
});
