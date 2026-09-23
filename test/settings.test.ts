import type { TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import type { Api, Model, AssistantMessage } from "@earendil-works/pi-ai";
import type { AppOptions } from "../server/app.ts";
import type { Environment } from "../shared/types.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Settings } from "../server/settings.ts";
import { createApp } from "../server/app.ts";
import { runPi } from "../server/agent.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
const temporary = () => mkdtemp(join(tmpdir(), "talaria-settings-"));
const pi = (extra = {}) => ({
  provider: "openai",
  model: "gpt-4.1-mini",
  ...extra,
});

test("settings preserve, replace and explicitly remove keys without exposing or mutating environment", async () => {
  const dir = await temporary();
  const env = { OPENAI_API_KEY: "environment-secret" };
  const settings = await new Settings(dir, env).init();
  assert.equal(settings.view().pi.credentials.openai.source, "environment");
  assert.ok(!JSON.stringify(settings.view()).includes(env.OPENAI_API_KEY));
  await settings.update("pi", pi({ apiKey: "saved-secret" }));
  const before = settings.environment();
  await settings.update("pi", pi({ apiKey: "" }));
  assert.equal(settings.environment().OPENAI_API_KEY, "saved-secret");
  await settings.update("pi", pi({ apiKey: "rotated-secret" }));
  assert.equal(before.OPENAI_API_KEY, "saved-secret");
  assert.equal(env.OPENAI_API_KEY, "environment-secret");
  await settings.update("pi", pi({ apiKey: null }));
  assert.equal(settings.environment().OPENAI_API_KEY, "");
  assert.equal(settings.view().pi.credentials.openai.configured, false);
  const reopened = await new Settings(dir, env).init();
  assert.equal(reopened.environment().OPENAI_API_KEY, "");
  if (process.platform !== "win32")
    assert.equal((await stat(settings.file)).mode & 0o777, 0o600);
});

test("independent provider settings survive concurrent saves and reopening", async () => {
  const dir = await temporary();
  const settings = await new Settings(dir, {}).init();
  await Promise.all([
    settings.update("pi", pi({ apiKey: "openai-secret" })),
    settings.update("pi", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "anthropic-secret",
    }),
  ]);
  await settings.update("pi", pi());
  const reopened = await new Settings(dir, {}).init();
  assert.equal(reopened.environment().OPENAI_API_KEY, "openai-secret");
  assert.equal(reopened.environment().ANTHROPIC_API_KEY, "anthropic-secret");
  const safe = JSON.stringify(reopened.view());
  for (const secret of ["openai-secret", "anthropic-secret"])
    assert.ok(!safe.includes(secret));
});

test("invalid settings are rejected atomically without changing saved credentials", async () => {
  const dir = await temporary();
  const settings = await new Settings(dir, {}).init();
  await settings.update("pi", pi({ apiKey: "keep-secret" }));
  for (const input of [
    null,
    [],
    { ...pi(), extra: "x" },
    pi({ provider: "other" }),
    pi({ model: "unknown-model" }),
    pi({ apiKey: 123 }),
    pi({ apiKey: "line\nbreak" }),
    pi({ apiKey: "has space" }),
  ]) {
    await assert.rejects(settings.update("pi", input), { status: 400 });
  }
  assert.equal(settings.environment().OPENAI_API_KEY, "keep-secret");
});

async function appFixture(t: TestContext, options: AppOptions = {}) {
  const dir = await temporary();
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    env: {},
    ...options,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.server.close());
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const post = (
    path: string,
    data: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Loom-Client": "1",
        ...headers,
      },
      body: JSON.stringify(data),
    });
  return { ...app, dir, base, post };
}

test("settings API protects secrets, applies changes per run and redacts provider errors", async (t) => {
  let release!: () => void;
  let captured: Environment | undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const { base, post, dir } = await appFixture(t, {
    runner: async ({ env, emit }) => {
      assert.ok(env);
      if (calls++ === 0) {
        captured = env;
        emit({ type: "activity", text: "waiting" });
        await hold;
        assert.equal(env.OPENAI_API_KEY, "first-secret");
        emit({ type: "delta", text: "complete" });
        return { text: "complete" };
      }
      assert.equal(env.OPENAI_API_KEY, "second-secret");
      throw new Error("Provider rejected " + env.OPENAI_API_KEY);
    },
  });
  const denied = await post(
    "/api/settings/pi",
    pi({ apiKey: "denied-secret" }),
    { Origin: "https://elsewhere.example" },
  );
  assert.equal(denied.status, 403);
  const headerless = await fetch(base + "/api/settings/pi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pi()),
  });
  assert.equal(headerless.status, 403);
  assert.equal((await post("/api/settings/pi", null)).status, 400);
  assert.equal(
    (await post("/api/settings/pi", pi({ apiKey: "first-secret" }))).status,
    200,
  );
  const session = await (await post("/api/sessions", { mode: "pi" })).json();
  const response = await post("/api/sessions/" + session.id + "/chat", {
    prompt: "first",
    allowWrites: false,
  });
  assert.ok(captured);
  assert.equal(captured.OPENAI_API_KEY, "first-secret");
  const saved = await post("/api/settings/pi", pi({ apiKey: "second-secret" }));
  assert.ok(!(await saved.text()).includes("second-secret"));
  release();
  assert.match(await response.text(), /complete/);
  const next = await post("/api/sessions/" + session.id + "/chat", {
    prompt: "second",
    allowWrites: false,
  });
  const errorText = await next.text();
  assert.match(errorText, /redacted/);
  assert.ok(!errorText.includes("second-secret"));
  for (const path of [
    "/api/settings",
    "/api/status",
    "/api/sessions",
    "/api/sessions/" + session.id,
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const content = await res.text();
    assert.ok(!content.includes("first-secret"));
    assert.ok(!content.includes("second-secret"));
  }
  assert.equal((await fetch(base + "/.loom/settings.json")).status, 404);
  const history = await readFile(join(dir, "data", "state.json"), "utf8");
  assert.ok(!history.includes("second-secret"));
});

test("Pi SDK forwards the supplied local credential to model transport", async () => {
  const dir = await temporary();
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  const model: Model<Api> = {
    id: "test",
    name: "Test",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
  let received;
  await runPi({
    prompt: "hello",
    session: {},
    store,
    workspace,
    allowWrites: false,
    env: { OPENAI_API_KEY: "ui-provided-secret" },
    signal: new AbortController().signal,
    emit() {},
    runtime: {
      model,
      streamFn: (_model, _context, options) => {
        received = options?.apiKey;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          const message: AssistantMessage = {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            stopReason: "stop",
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          };
          stream.push({ type: "done", reason: "stop", message });
        });
        return stream;
      },
    },
  });
  assert.equal(received, "ui-provided-secret");
});
