import type { AddressInfo } from "node:net";
import type { Api, Model, AssistantMessage } from "@earendil-works/pi-ai";
import type { RunEvent } from "../shared/types.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { createApp } from "../server/app.ts";
import { askHermes, hermesEndpoint } from "../server/hermes.ts";
import { createTools, runPi } from "../server/agent.ts";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
const temporary = () => mkdtemp(join(tmpdir(), "loom-test-"));

test("atomic persistence keeps concurrent writes and survives reopening", async () => {
  const dir = await temporary();
  const store = await new Store(dir).init();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.mutate((s) =>
        s.memories.push({ id: String(i), content: String(i) }),
      ),
    ),
  );
  const reopened = await new Store(dir).init();
  assert.equal(reopened.state.memories.length, 12);
  await assert.rejects(
    store.mutate(() => {
      throw new Error("fail");
    }),
  );
  await store.mutate((s) => s.memories.push({ id: "after", content: "after" }));
  assert.equal(store.state.memories.length, 13);
});
test("workspace confines paths, blocks hidden files and symlinks", async () => {
  const root = await temporary();
  const workspace = await new Workspace(join(root, "work")).init();
  await workspace.write("src/hello.js", "hello");
  assert.equal(await workspace.read("src/hello.js"), "hello");
  for (const path of [
    "../secret",
    ".env",
    "src/../../escape",
    "C:/secrets",
    "/etc/passwd",
    "..\\secret",
  ])
    await assert.rejects(workspace.resolve(path, true));
  await writeFile(join(root, "secret"), "private");
  await symlink(root, join(workspace.root, "outside"), "junction");
  await assert.rejects(workspace.read("outside/secret"), /symbolic/);
  assert.deepEqual(
    (await workspace.list()).map((x) => x.name),
    ["src"],
  );
});
test("Hermes connector sends documented protocol and hides gateway error bodies", async () => {
  assert.equal(
    hermesEndpoint("http://localhost:8642/v1/").href,
    "http://localhost:8642/v1/chat/completions",
  );
  assert.throws(() => hermesEndpoint("file:///tmp/private"));
  const result = await askHermes({
    url: "http://localhost:8642",
    key: "test-key",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false);
      assert.equal(body.model, "hermes-agent");
      return Response.json({
        choices: [{ message: { content: "Hermes result" } }],
      });
    },
  });
  assert.equal(result, "Hermes result");
  await assert.rejects(
    askHermes({
      url: "http://localhost:8642",
      key: "key",
      messages: [],
      fetchImpl: async () => new Response("SECRET", { status: 401 }),
    }),
    /HTTP 401/,
  );
});
test("write and Hermes tools enforce explicit run permission", async () => {
  const dir = await temporary();
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "workspace")).init();
  const tools = createTools({
    store,
    workspace,
    allowWrites: false,
    hybrid: true,
  });
  for (const [name, args] of [
    ["write_file", { path: "test", content: "x" }],
    ["remember", { content: "x" }],
    ["save_skill", { name: "x", content: "x" }],
    ["delegate_to_hermes", { task: "x" }],
  ]) {
    await assert.rejects(
      tools.find((t) => t.name === name)!.execute("id", args),
      /尚未開啟/,
    );
  }
  assert.equal(store.state.memories.length, 0);
});
const model: Model<Api> = {
  id: "test",
  name: "Test",
  api: "openai-responses",
  provider: "test",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};
function message(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}
function streamMessage(msg: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: msg });
    for (const [i, part] of msg.content.entries())
      if (part.type === "text")
        stream.push({
          type: "text_delta",
          contentIndex: i,
          delta: part.text,
          partial: msg,
        });
    assert.ok(
      msg.stopReason !== "error" &&
        msg.stopReason !== "aborted" &&
        msg.stopReason !== "pending",
    );
    stream.push({ type: "done", reason: msg.stopReason, message: msg });
  });
  return stream;
}
test("real Pi SDK executes file tools, injects memory, resumes transcript, streams output", async () => {
  const dir = await temporary();
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "workspace")).init();
  await store.mutate((s) =>
    s.memories.push({ id: "m", content: "Use Node only" }),
  );
  let calls = 0;
  const events: RunEvent[] = [];
  const first = await runPi({
    prompt: "Create file",
    session: {},
    store,
    workspace,
    allowWrites: true,
    hybrid: false,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
    runtime: {
      model,
      streamFn: (_model, context) => {
        assert.ok(JSON.stringify(context.messages).includes("Use Node only"));
        if (calls++ === 0)
          return streamMessage(
            message(
              [
                {
                  type: "toolCall",
                  id: "write-1",
                  name: "write_file",
                  arguments: { path: "hello.txt", content: "from Pi" },
                },
              ],
              "toolUse",
            ),
          );
        assert.ok(
          context.messages.some((m) => m.role === "toolResult" && !m.isError),
        );
        return streamMessage(
          message([{ type: "text", text: "File created." }]),
        );
      },
    },
  });
  assert.equal(first.text, "File created.");
  assert.equal(await workspace.read("hello.txt"), "from Pi");
  assert.ok(events.some((e) => "tool" in e && e.tool === "write_file"));
  assert.ok(first.piMessages);
  assert.ok(first.piMessages.some((m) => m.role === "toolResult"));
  const second = await runPi({
    prompt: "Continue",
    session: { piMessages: first.piMessages },
    store,
    workspace,
    allowWrites: false,
    emit() {},
    signal: new AbortController().signal,
    runtime: {
      model,
      streamFn: (_model, context) => {
        assert.equal(
          context.messages.filter((m) => m.role === "user").length,
          2,
        );
        return streamMessage(message([{ type: "text", text: "Resumed." }]));
      },
    },
  });
  assert.equal(second.text, "Resumed.");
});
test("HTTP chat streams, saves history, rejects cross-origin and invalid payloads", async (t) => {
  const dir = await temporary();
  const { server } = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    env: {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const request = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      body: JSON.stringify(data),
    });
  const denied = await fetch(base + "/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  assert.equal(
    (await request("/api/sessions", { mode: "unknown" })).status,
    400,
  );
  const session = await (
    await request("/api/sessions", { mode: "demo" })
  ).json();
  assert.equal(
    (
      await request("/api/sessions/" + session.id + "/chat", {
        prompt: "hello",
        allowWrites: "yes",
      })
    ).status,
    400,
  );
  const response = await request("/api/sessions/" + session.id + "/chat", {
    prompt: "hello",
    allowWrites: false,
  });
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((e) => e.type === "delta"));
  assert.equal(events.at(-1).type, "done");
  const saved = await (
    await fetch(base + "/api/sessions/" + session.id)
  ).json();
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[0].status, "complete");
  assert.match(saved.messages[1].content, /示範/);
  const memory = await (
    await request("/api/memories", { content: "<script>literal</script>" })
  ).json();
  assert.equal(memory.content, "<script>literal</script>");
  assert.equal(
    (await (await fetch(base + "/api/status")).json()).piReady,
    false,
  );
  assert.equal((await fetch(base + "/.env")).status, 404);
  const persisted = JSON.parse(
    await readFile(join(dir, "data", "state.json"), "utf8"),
  );
  assert.equal(persisted.sessions.length, 1);
});
test("stop and session concurrency protect in-flight work", async (t) => {
  const dir = await temporary();
  const { server } = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    env: {},
    runner: async ({ signal, emit }) => {
      emit({ type: "activity", text: "running" });
      await new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
      throw new Error("Unexpected completion");
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const post = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      body: JSON.stringify(data),
    });
  const session = await (await post("/api/sessions", {})).json();
  const path = "/api/sessions/" + session.id;
  const stream = await post(path + "/chat", {
    prompt: "wait",
    allowWrites: false,
  });
  assert.equal(
    (await post(path + "/chat", { prompt: "another", allowWrites: false }))
      .status,
    409,
  );
  await post(path + "/stop", {});
  assert.match(await stream.text(), /已停止執行/);
  const saved = await (await fetch(base + path)).json();
  assert.equal(saved.messages[1].status, "error");
  assert.equal(saved.running, false);
});

test("Pi hybrid tool delegates over HTTP to Hermes and consumes its result", async (t) => {
  const { createServer } = await import("node:http");
  let gatewayCalls = 0;
  const gateway = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer fixture-key");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    assert.equal(JSON.parse(raw).messages[0].content, "Research the task");
    gatewayCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "Hermes evidence" } }],
      }),
    );
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(() => gateway.close());
  const dir = await temporary();
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "workspace")).init();
  let call = 0;
  const result = await runPi({
    prompt: "Delegate",
    session: {},
    store,
    workspace,
    allowWrites: true,
    hybrid: true,
    emit() {},
    signal: new AbortController().signal,
    env: {
      HERMES_URL: "http://127.0.0.1:" + (gateway.address() as AddressInfo).port,
      HERMES_API_KEY: "fixture-key",
    },
    runtime: {
      model,
      streamFn: (_model, context) => {
        if (call++ === 0)
          return streamMessage(
            message(
              [
                {
                  type: "toolCall",
                  id: "hermes-1",
                  name: "delegate_to_hermes",
                  arguments: { task: "Research the task" },
                },
              ],
              "toolUse",
            ),
          );
        const toolResponse = context.messages.find(
          (m) => m.role === "toolResult",
        );
        assert.ok(toolResponse);
        assert.equal(toolResponse.isError, false);
        assert.ok(JSON.stringify(toolResponse).includes("Hermes evidence"));
        return streamMessage(
          message([{ type: "text", text: "Combined answer." }]),
        );
      },
    },
  });
  assert.equal(gatewayCalls, 1);
  assert.equal(result.text, "Combined answer.");
});
