import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Settings } from "../server/settings.ts";
import { configuration } from "../server/agent.ts";
import { compatibleUrl } from "../server/compatible.ts";
import { createApp } from "../server/app.ts";

test("compatible settings normalize custom paths, persist arbitrary models, isolate and rotate credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-compatible-"));
  const settings = await new Settings(dir, {
    OPENAI_API_KEY: "official-secret",
  }).init();
  const input = {
    provider: "openai-compatible",
    model: "vendor/custom-model:latest",
    url: "https://example.com/api/v2/chat/completions/",
  };
  await settings.update("pi", { ...input, apiKey: "custom-secret" });
  assert.equal(settings.view().pi.compatibleUrl, "https://example.com/api/v2");
  assert.equal(settings.environment().OPENAI_API_KEY, "official-secret");
  assert.equal(configuration(settings.environment()).piReady, true);
  await settings.update("pi", { ...input, apiKey: "" });
  assert.equal(settings.environment().COMPATIBLE_API_KEY, "custom-secret");
  const reopened = await new Settings(dir, {}).init();
  assert.equal(reopened.view().pi.model, input.model);
  assert.equal(
    reopened.view().pi.credentials["openai-compatible"].configured,
    true,
  );
  assert.ok(!JSON.stringify(reopened.view()).includes("custom-secret"));
  const before = settings.environment();
  for (const url of [
    "file:///x",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/#secret",
    "https://example.com/\n",
  ]) {
    assert.throws(() => compatibleUrl(url), { status: 400 });
    await assert.rejects(settings.update("pi", { ...input, url }), {
      status: 400,
    });
  }
  assert.deepEqual(settings.environment(), before);
  await settings.update("pi", { ...input, url: "http://localhost:1234/v1" });
  assert.equal(settings.environment().COMPATIBLE_API_KEY, "");
  assert.equal(configuration(settings.environment()).piReady, true);
  await settings.update("pi", { ...input, apiKey: "replacement" });
  await settings.update("pi", { ...input, apiKey: null });
  assert.equal(settings.environment().COMPATIBLE_API_KEY, "");
  assert.equal(
    configuration({ PI_PROVIDER: "openai-compatible" }).piReady,
    false,
  );
});

test("saved compatible endpoint streams through real SDK, runs a tool, resumes and redacts API errors", async (t) => {
  let calls = 0;
  let fail = false;
  const upstream = createServer(async (req, res) => {
    assert.equal(req.url, "/custom/api/chat/completions");
    assert.equal(req.headers.authorization, "Bearer endpoint-secret");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    assert.equal(input.model, "vendor/my-model");
    assert.equal(input.stream, true);
    assert.equal(input.store, undefined);
    assert.equal(input.reasoning_effort, undefined);
    assert.equal(input.stream_options, undefined);
    assert.equal(input.max_tokens, 4096);
    assert.ok(
      input.tools.some(
        (tool: { function: { name: string } }) =>
          tool.function.name === "read_file",
      ),
    );
    if (fail) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Rejected endpoint-secret",
            type: "authentication_error",
          },
        }),
      );
      return;
    }
    calls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "test",
            object: "chat.completion.chunk",
            created: 1,
            model: input.model,
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    if (calls === 1) {
      send(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_file",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"probe.txt"}',
              },
            },
          ],
        },
        null,
      );
      send({}, "tool_calls");
    } else {
      assert.ok(
        input.messages.some(
          (m: { role: string; content: string }) =>
            m.role === "tool" && m.content.includes("fixture-file-token"),
        ),
      );
      if (calls === 3)
        assert.ok(
          input.messages.some(
            (m: { role: string; content: string }) =>
              m.role === "assistant" && m.content?.includes("讀取完成"),
          ),
        );
      send({ role: "assistant", content: "讀取" }, null);
      send({ content: "完成" }, null);
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
  const dir = await mkdtemp(join(tmpdir(), "talaria-compatible-api-"));
  const workspace = join(dir, "work");
  await mkdir(workspace);
  await writeFile(join(workspace, "probe.txt"), "fixture-file-token");
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: workspace,
    env: { OPENAI_API_KEY: "never-send-official-secret" },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
  });
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const post = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      body: JSON.stringify(data),
    });
  const setting = await post("/api/settings/pi", {
    provider: "openai-compatible",
    model: "vendor/my-model",
    url:
      "http://127.0.0.1:" +
      (upstream.address() as AddressInfo).port +
      "/custom/api/",
    apiKey: "endpoint-secret",
  });
  assert.equal(setting.status, 200);
  assert.ok(!(await setting.text()).includes("endpoint-secret"));
  const session = await (await post("/api/sessions", { mode: "pi" })).json();
  const path = "/api/sessions/" + session.id + "/chat";
  const result = await (
    await post(path, { prompt: "Read probe.txt", allowWrites: false })
  ).text();
  assert.match(result, /"type":"delta"/);
  assert.match(result, /"type":"done"/);
  assert.equal(calls, 2);
  await (await post(path, { prompt: "Continue", allowWrites: false })).text();
  assert.equal(calls, 3);
  fail = true;
  const error = await (
    await post(path, { prompt: "Fail", allowWrites: false })
  ).text();
  assert.match(error, /redacted/);
  assert.ok(!error.includes("endpoint-secret"));
  assert.ok(
    !(await readFile(join(dir, "data", "state.json"), "utf8")).includes(
      "endpoint-secret",
    ),
  );
});
