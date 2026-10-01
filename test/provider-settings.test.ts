import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Connections } from "../server/connections.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { runAgent } from "../server/agent.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";

for (const provider of ["openai", "anthropic"] as const) {
  test(`${provider} custom API URL persists and sends model requests to the saved endpoint`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "apsis-provider-url-"));
    let store: Store | undefined;
    t.after(() => {
      store?.conversations.db.close();
      return rm(directory, { recursive: true, force: true });
    });
    const requests: { path: string; key: string | undefined }[] = [];
    const upstream = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* Consume the request body. */
      }
      requests.push({
        path: req.url!,
        key: (provider === "openai"
          ? req.headers.authorization
          : req.headers["x-api-key"]) as string | undefined,
      });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (provider === "openai") {
        const chunk = (delta: unknown, finish_reason: string | null = null) =>
          res.write(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "gpt-4o", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        chunk({ role: "assistant", content: "Saved endpoint reached." });
        chunk({}, "stop");
        res.end("data: [DONE]\n\n");
      } else {
        const event = (type: string, data: object) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
          );
        event("message_start", {
          message: {
            id: "fixture",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        });
        event("content_block_start", {
          index: 0,
          content_block: { type: "text", text: "" },
        });
        event("content_block_delta", {
          index: 0,
          delta: { type: "text_delta", text: "Saved endpoint reached." },
        });
        event("content_block_stop", { index: 0 });
        event("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 5 },
        });
        event("message_stop", {});
        res.end();
      }
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/gateway${provider === "openai" ? "/v1" : ""}`;
    const connections = await new Connections(directory).init();
    const input = {
      name: "Gateway",
      provider,
      model: provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5",
      url: baseUrl + "/",
      apiKey: "fixture-key",
    };
    const row = await connections.save(input);
    const reloaded = await new Connections(directory).init();
    assert.equal(reloaded.view()[0].url, baseUrl);
    store = await new Store(join(directory, "data")).init();
    const workspace = await new Workspace(join(directory, "work")).init();
    const now = new Date().toISOString();
    const result = await runAgent({
      store,
      workspace,
      agent: {
        id: "url-fixture",
        name: "URL fixture",
        description: "",
        instructions: "Reply briefly.",
        provider,
        model: row.model,
        tools: [],
        memoryScope: "private",
        createdAt: now,
        updatedAt: now,
      },
      session: {
        id: "url-session",
        title: "URL fixture",
        messages: [],
        createdAt: now,
      },
      env: reloaded.environment(row.id),
      prompt: "Reply briefly.",
      allowWrites: false,
      signal: AbortSignal.timeout(10000),
      emit: () => {},
    });
    assert.equal(result.text, "Saved endpoint reached.");
    assert.deepEqual(requests, [
      {
        path:
          provider === "openai"
            ? "/gateway/v1/chat/completions"
            : "/gateway/v1/messages",
        key: provider === "openai" ? "Bearer fixture-key" : "fixture-key",
      },
    ]);

    // Equivalent URLs retain credentials; changing hosts or returning to the official API clears them.
    await reloaded.save({ ...input, apiKey: "" }, row.id);
    assert.equal(reloaded.view()[0].credentialConfigured, true);
    await reloaded.save(
      { ...input, url: "https://other.example/v1", apiKey: "" },
      row.id,
    );
    assert.equal(reloaded.view()[0].credentialConfigured, false);
    await reloaded.save({ ...input, url: "https://other.example/v1" }, row.id);
    await reloaded.save({ ...input, url: "", apiKey: "" }, row.id);
    assert.equal(reloaded.view()[0].url, undefined);
    assert.equal(reloaded.view()[0].credentialConfigured, false);
    for (const url of [
      "ftp://example.com",
      "https://user:password@example.com",
      "https://example.com?key=secret",
    ])
      await assert.rejects(reloaded.save({ ...input, url }, row.id), {
        status: 400,
      });
  });
}

test("context limits default to 256K after saving, reloading, and clearing an override", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-provider-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const connections = await new Connections(directory).init();
  const input = { name: "Context", provider: "openai", model: "gpt-4o" };
  const row = await connections.save(input);
  const profile = (store: Connections) =>
    store.view().find((c) => c.id === row.id)?.contextProfiles["gpt-4o"];
  assert.deepEqual(profile(connections), { tokens: 262144, source: "default" });
  await connections.save(
    {
      ...input,
      modelSettings: {
        "gpt-4o": { contextWindowTokens: 8192 },
      },
    },
    row.id,
  );
  assert.deepEqual(profile(connections), { tokens: 8192, source: "manual" });
  await connections.save({ ...input, modelSettings: { "gpt-4o": {} } }, row.id);
  const reloaded = await new Connections(directory).init();
  assert.deepEqual(profile(reloaded), { tokens: 262144, source: "default" });
  assert.equal(
    reloaded.view().find((c) => c.id === row.id)?.modelSettings?.["gpt-4o"]
      ?.contextWindowTokens,
    undefined,
  );
});

test("model discovery reuses stored credentials only for the same compatible endpoint", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-provider-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const connections = await new Connections(directory).init();
  const row = await connections.save({
    name: "Test",
    provider: "openai-compatible",
    model: "a",
    url: "https://example.com/v1",
    apiKey: "test-only-key",
  });
  assert.equal(
    connections.discoveryKey({
      connectionId: row.id,
      url: row.url,
      apiKey: "",
    }),
    "test-only-key",
  );
  assert.equal(
    connections.discoveryKey({
      connectionId: row.id,
      url: row.url + "/",
      apiKey: "",
    }),
    "test-only-key",
  );
  assert.throws(
    () =>
      connections.discoveryKey({
        connectionId: row.id,
        url: "https://other.example/v1",
      }),
    /網址已變更/,
  );
  assert.throws(
    () => connections.discoveryKey({ connectionId: "missing", url: row.url }),
    /找不到/,
  );
  assert.equal(
    connections.discoveryKey({
      connectionId: row.id,
      url: "https://other.example/v1",
      apiKey: "new-explicit-key",
    }),
    "new-explicit-key",
  );
  assert.equal(
    JSON.stringify(connections.view()).includes("test-only-key"),
    false,
  );
  const native = await connections.save({
    name: "Native",
    provider: "openai",
    model: "a",
    apiKey: "native-test-key",
  });
  assert.throws(
    () => connections.discoveryKey({ connectionId: native.id, url: row.url }),
    /網址已變更/,
  );
});

test("editing a provider preserves the system default and selected model catalog", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-provider-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const connections = await new Connections(directory).init();
  const first = await connections.save({
    name: "One",
    provider: "openai",
    model: "a",
    models: ["a", "b"],
    apiKey: "test-key",
  });
  await connections.setDefault({ connectionId: first.id, model: "b" });
  const second = await connections.save({
    name: "Two",
    provider: "openai",
    model: "c",
  });
  await connections.save(
    { name: "Edited", provider: "openai", model: "d", models: ["c", "d"] },
    second.id,
  );
  assert.deepEqual(connections.defaultSelection(), {
    connectionId: first.id,
    model: "b",
  });
  assert.deepEqual(connections.view().find((c) => c.id === second.id)?.models, [
    "c",
    "d",
  ]);
});

test("model options persist, validate and retire only removed model overrides", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-model-options-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const connections = await new Connections(directory).init();
  const input = {
    name: "Local",
    provider: "ollama",
    url: "http://127.0.0.1:11434",
    model: "a",
    models: ["a", "b"],
  };
  const row = await connections.save({
    ...input,
    modelSettings: { a: { displayName: "Friendly", maxOutputTokens: 512 } },
  });
  const oldFingerprint = connections.fingerprint(row.id);
  await connections.save(
    {
      ...input,
      modelSettings: { a: { displayName: "Friendly", maxOutputTokens: 1024 } },
    },
    row.id,
  );
  assert.notEqual(connections.fingerprint(row.id), oldFingerprint);
  const reopened = await new Connections(directory).init();
  assert.deepEqual(reopened.view()[0].modelSettings, {
    a: { displayName: "Friendly", maxOutputTokens: 1024 },
  });
  for (const settings of [
    { a: { maxOutputTokens: 0 } },
    { a: { maxOutputTokens: "512" } },
    { a: { reasoning: "high" } },
    { missing: { maxOutputTokens: 512 } },
  ])
    await assert.rejects(
      connections.save({ ...input, modelSettings: settings }, row.id),
      { status: 400 },
    );
  await connections.save({ ...input, model: "b", models: ["b"] }, row.id);
  assert.deepEqual(connections.view()[0].modelSettings, {});
});
