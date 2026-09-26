import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Connections } from "../server/connections.ts";

test("context limits default to 256K after saving, reloading, and clearing an override", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-provider-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const connections = await new Connections(directory).init();
  const input = { name: "Context", provider: "openai", model: "gpt-4o" };
  const row = await connections.save(input);
  const profile = (store: Connections) =>
    store.view().find((c) => c.id === row.id)?.contextProfiles["gpt-4o"];
  assert.deepEqual(profile(connections), { tokens: 262144, source: "default" });
  await connections.save({ ...input, modelSettings: {
    "gpt-4o": { contextWindowTokens: 8192 },
  } }, row.id);
  assert.deepEqual(profile(connections), { tokens: 8192, source: "manual" });
  await connections.save({ ...input, modelSettings: { "gpt-4o": {} } }, row.id);
  const reloaded = await new Connections(directory).init();
  assert.deepEqual(profile(reloaded), { tokens: 262144, source: "default" });
  assert.equal(reloaded.view().find((c) => c.id === row.id)?.modelSettings?.["gpt-4o"]?.contextWindowTokens, undefined);
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
