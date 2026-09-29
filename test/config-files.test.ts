import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { edit, parse } from "@rainbowatcher/toml-edit-js";
import { createApp } from "../server/app.ts";
import { Connections } from "../server/connections.ts";
import { ConfigStore, modelAlias } from "../server/config-store.ts";
import { ConfigConflictError } from "../server/config-file.ts";
import { McpConfig } from "../server/mcp-config.ts";
import { SettingsService } from "../server/settings.ts";
import { ProductDB } from "../server/product-db.ts";
import { withConnector } from "../server/bot-connectors.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";

async function directory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("provider keys are the only identity and display-name edits preserve them", async (t) => {
  const dir = await directory(t);
  const connections = await new Connections(dir).init();
  const ids: string[] = [];
  for (const name of ["Kimi", "Kimi", "Kimi 2", "公司模型"])
    ids.push(
      (
        await connections.save({
          name,
          provider: "ollama",
          model: "qwen3.5",
          url: "http://localhost:11434",
        })
      ).id,
    );
  assert.deepEqual(ids, ["kimi", "kimi-2", "kimi-2-2", "公司模型"]);
  const doc = connections.config.read().value.document;
  assert.deepEqual(Object.keys(doc.providers), ids);
  assert.ok(Object.values(doc.providers).every((p) => !Object.hasOwn(p, "id")));
  await connections.setDefault({ connectionId: "kimi", model: "qwen3.5" });
  await connections.save(
    { ...connections.view()[0], name: "Friendly Kimi" },
    "kimi",
  );
  const reopened = await new Connections(dir).init();
  assert.equal(reopened.view()[0].id, "kimi");
  assert.equal(reopened.view()[0].name, "Friendly Kimi");
  assert.deepEqual(reopened.defaultSelection(), {
    connectionId: "kimi",
    model: "qwen3.5",
  });
  assert.throws(
    () =>
      reopened.config.update((d) => {
        Object.assign(d.providers.kimi, { id: "legacy-uuid" });
      }),
    /欄位錯誤/,
  );
  reopened.config.update((d) => {
    d.providers["my-kimi"] = d.providers.kimi;
    delete d.providers.kimi;
    for (const model of Object.values(d.models))
      if (model.provider === "kimi") model.provider = "my-kimi";
  });
  assert.equal(reopened.selection("my-kimi").model, "qwen3.5");
  assert.throws(() => reopened.selection("kimi"));
  assert.equal(reopened.defaultSelection()?.connectionId, "my-kimi");
});

test("legacy WAL settings, model IDs, credentials and MCP migrate once without dual writes", async (t) => {
  let db: ProductDB;
  t.after(() => db?.db.close());
  const dir = await directory(t);
  db = await new ProductDB().init(dir);
  // Keep SQLite open to exercise committed data still in the WAL.
  const settings = { ...DEFAULT_SETTINGS, locale: "en", maxTurns: 27 };
  db.put("settings", { id: "global", revision: 7, ...settings });
  const connector = {
    id: "existing-mcp",
    name: "原本工具",
    enabled: true,
    url: "https://example.com/mcp",
    token: "legacy-mcp-secret",
  };
  db.put("connector", connector);
  db.put("bot", { id: "existing-bot", connectorIds: [connector.id] });
  const id = randomUUID();
  const legacyRows = [
    {
      id,
      name: "測試連線",
      provider: "openai-compatible",
      url: "https://example.com/v1",
      apiKey: "legacy-model-secret",
      model: "a.b",
      models: ["a.b", "other/model"],
      modelSettings: {
        "a.b": { maxOutputTokens: 1234, contextWindowTokens: 32768 },
      },
    },
  ];
  const legacyText = JSON.stringify(legacyRows);
  await writeFile(join(dir, "connections.json"), legacyText);
  await writeFile(
    join(dir, "connection-default.json"),
    JSON.stringify({ connectionId: id, model: "other/model" }),
  );
  const connections = await new Connections(dir).init();
  const service = new SettingsService(connections.config);
  const mcp = new McpConfig(dir).init(dir);
  assert.equal(service.read().maxTurns, 27);
  assert.equal(service.read().locale, "en");
  assert.equal(connections.rows[0].id, id);
  assert.deepEqual(connections.defaultSelection(), {
    connectionId: id,
    model: "other/model",
  });
  assert.deepEqual(
    connections.rows[0].modelSettings,
    legacyRows[0].modelSettings,
  );
  assert.equal(
    connections.environment(id).COMPATIBLE_API_KEY,
    "legacy-model-secret",
  );
  assert.equal(
    mcp.get(connector.id)?.headers?.Authorization,
    "Bearer legacy-mcp-secret",
  );
  assert.deepEqual(db.get("bot", "existing-bot"), {
    id: "existing-bot",
    connectorIds: [connector.id],
  });
  assert.doesNotMatch(
    JSON.stringify({
      settings: service.read(),
      models: connections.view(),
      mcp: mcp.view(),
    }),
    /legacy-model-secret|legacy-mcp-secret/,
  );
  service.update({ locale: "zh-Hant" }, service.read().revision);
  mcp.remove(connector.id);
  assert.equal(db.get<{ locale: string }>("settings", "global")?.locale, "en");
  assert.equal(
    await readFile(join(dir, "connections.json"), "utf8"),
    legacyText,
  );
  assert.equal(
    db.get<{ token: string }>("connector", connector.id)?.token,
    "legacy-mcp-secret",
  );
  const reopened = new ConfigStore(dir).init(dir);
  assert.equal(reopened.read().value.settings.locale, "zh-Hant");
  assert.deepEqual(new McpConfig(dir).init(dir).all(), []);
  assert.equal(
    parse(await readFile(join(dir, "settings.toml.migration.bak"), "utf8")).ui
      .locale,
    "en",
  );
});

test("TOML comments, quoted names, model edits and permission arrays round-trip", async (t) => {
  const dir = await directory(t);
  const connections = await new Connections(dir).init();
  const model = await connections.save({
    name: "Quoted",
    provider: "openai-compatible",
    url: "https://example.com/v1",
    model: 'a.b/"quoted"',
  });
  const path = join(dir, "settings.toml");
  let text = await readFile(path, "utf8");
  text =
    "# 我的設定說明\n" +
    text.replace('locale = "zh-Hant"', 'locale = "zh-Hant" # 語言註解');
  await writeFile(path, text);
  const service = new SettingsService(connections.config);
  service.update(
    {
      locale: "en",
      permissionRules: [
        { id: "read", scope: "global", tool: "read_file", effect: "allow" },
      ],
    },
    service.read().revision,
  );
  await connections.save(
    {
      name: "Renamed",
      provider: "openai-compatible",
      url: "https://example.com/v1",
      model: model.model,
      models: [model.model, "next"],
      modelSettings: { [model.model]: { maxOutputTokens: 500 } },
    },
    model.id,
  );
  const saved = await readFile(path, "utf8");
  assert.match(saved, /# 我的設定說明/);
  assert.match(saved, /locale = "en" # 語言註解/);
  const reopened = await new Connections(dir).init();
  assert.equal(
    reopened.rows.find((r) => r.id === model.id)?.modelSettings?.[model.model]
      ?.maxOutputTokens,
    500,
  );
  assert.equal(
    new SettingsService(reopened.config).read().permissionRules[0].id,
    "read",
  );
  assert.ok(!saved.includes("undefined"));
});

test("manual edits invalidate stale settings and provider forms, including after restart", async (t) => {
  const dir = await directory(t);
  const connections = await new Connections(dir).init();
  const model = await connections.save({
    name: "Old",
    provider: "ollama",
    model: "test",
    url: "http://localhost:11434",
  });
  const service = new SettingsService(connections.config);
  const previous = service.read();
  const path = join(dir, "settings.toml");
  const changed = edit(await readFile(path, "utf8"), '"ui"."locale"', "en");
  await writeFile(path, changed);
  assert.throws(() => service.update({ ...previous, maxTurns: 2 }), {
    status: 409,
  });
  await assert.rejects(
    connections.save({ ...model, name: "Stale overwrite" }, model.id),
    ConfigConflictError,
  );
  const reopened = new SettingsService(new ConfigStore(dir).init(dir));
  assert.throws(() => reopened.update(previous), { status: 409 });
  assert.equal(await readFile(path, "utf8"), changed);
  assert.equal(reopened.read().locale, "en");
});

test("invalid or missing migrated files are preserved and never replaced by defaults", async (t) => {
  const dir = await directory(t);
  const store = new ConfigStore(dir).init(dir);
  const path = store.storage.file;
  const valid = await readFile(path, "utf8");
  const secret = 'apiKey = "do-not-echo-this-secret"\nui = [unclosed';
  await writeFile(path, secret);
  assert.throws(
    () => store.read(),
    (e: unknown) =>
      e instanceof Error && !e.message.includes("do-not-echo-this-secret"),
  );
  assert.throws(() => new ConfigStore(dir).init(dir));
  assert.equal(await readFile(path, "utf8"), secret);
  await writeFile(path, valid);
  assert.equal(store.read().value.settings.locale, "zh-Hant");
  await writeFile(path, valid.replace("maxTurns = 100", "maxTurnz = 100"));
  assert.throws(() => store.read(), /runtime.maxTurnz/);
  await rm(path);
  assert.throws(() => new ConfigStore(dir).init(dir), /遺失/);
});

test("failed backup writes leave the last valid configuration intact", async (t) => {
  const dir = await directory(t);
  const store = new ConfigStore(dir).init(dir);
  const previous = store.read();
  await mkdir(`${store.storage.file}.bak`);
  assert.throws(() =>
    store.update((doc) => {
      doc.ui.locale = "en";
    }),
  );
  assert.equal(await readFile(store.storage.file, "utf8"), previous.text);
  assert.equal(store.read().revision, previous.revision);
  await rmdir(`${store.storage.file}.bak`);
  store.update((doc) => {
    doc.ui.locale = "en";
  });
  assert.equal(
    await readFile(`${store.storage.file}.bak`, "utf8"),
    previous.text,
  );
});

test("API keys can reference environment variables without being persisted or returned", async (t) => {
  const dir = await directory(t);
  const envName = "APSIS_CONFIG_TEST_MODEL_KEY";
  const original = process.env[envName];
  t.after(() => {
    if (original === undefined) delete process.env[envName];
    else process.env[envName] = original;
  });
  const connections = await new Connections(dir).init();
  const row = await connections.save({
    name: "Env",
    provider: "openai-compatible",
    model: "test",
    url: "https://example.com/v1",
  });
  const alias = row.id;
  connections.config.update((doc) => {
    doc.providers[alias].apiKeyEnv = envName;
  });
  delete process.env[envName];
  assert.equal(connections.view()[0].credentialConfigured, false);
  assert.throws(() => connections.environment(row.id), new RegExp(envName));
  process.env[envName] = "environment-only-secret";
  assert.equal(
    connections.environment(row.id).COMPATIBLE_API_KEY,
    "environment-only-secret",
  );
  const current = connections.view()[0];
  await connections.save({ ...current, name: "Edited", apiKey: "" }, row.id);
  assert.equal(connections.rows[0].apiKeyEnv, envName);
  assert.doesNotMatch(
    readFileSync(connections.config.storage.file, "utf8"),
    /environment-only-secret/,
  );
  assert.doesNotMatch(
    JSON.stringify(connections.view()),
    /environment-only-secret/,
  );
  assert.throws(
    () =>
      connections.config.update((doc) => {
        doc.providers[alias].apiKey = "conflict";
      }),
    /不可同時/,
  );
  await connections.verified(row.id, {
    engine: "deepagents",
    model: "test",
    at: new Date().toISOString(),
    ok: true,
    streaming: true,
    tools: true,
    message: "ok",
  });
  assert.equal(connections.view()[0].verification?.ok, true);
  connections.config.update((doc) => {
    doc.models[modelAlias(alias, "test")].maxOutputTokens = 333;
  });
  assert.equal(connections.view()[0].verification, undefined);
});

test("MCP validates HTTP subset, disables removed servers, and checks stale file versions", async (t) => {
  const dir = await directory(t);
  const mcp = new McpConfig(dir).init(dir);
  const saved = mcp.storage.read();
  await writeFile(
    mcp.storage.file,
    JSON.stringify({
      mcpServers: {
        remote: { url: "https://example.com/mcp", enabled: false },
      },
    }),
  );
  assert.equal(mcp.get("remote")?.enabled, false);
  assert.throws(
    () =>
      mcp.put(
        {
          id: "other",
          name: "other",
          url: "https://example.com/mcp",
          enabled: true,
        },
        saved.revision,
      ),
    ConfigConflictError,
  );
  for (const input of [
    { command: "npx", args: ["server"] },
    { url: "https://example.com/sse", transport: "sse" },
    { url: "https://user:password@example.com/mcp" },
    { url: "https://example.com/mcp", toolTimeoutMs: 0 },
    {
      url: "https://example.com/mcp",
      headers: { authorization: "Bearer secret" },
      bearerTokenEnvVar: "TOKEN",
    },
  ]) {
    const invalid = JSON.stringify({ mcpServers: { invalid: input } });
    await writeFile(mcp.storage.file, invalid);
    assert.throws(() => mcp.all());
    assert.equal(await readFile(mcp.storage.file, "utf8"), invalid);
  }
});

test("HTTP MCP reads headers and environment tokens without exposing them in listings", async (t) => {
  const dir = await directory(t);
  const auth: (string | undefined)[] = [];
  const upstream = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    auth.push(req.headers.authorization);
    assert.equal(req.headers["x-fixture"], "present");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : { tools: [] };
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  const envName = "APSIS_CONFIG_TEST_MCP_KEY";
  const original = process.env[envName];
  t.after(() => {
    if (original === undefined) delete process.env[envName];
    else process.env[envName] = original;
  });
  process.env[envName] = "mcp-env-secret";
  const mcp = new McpConfig(dir).init(dir);
  mcp.put({
    id: "remote",
    name: "Remote",
    enabled: true,
    url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`,
    bearerTokenEnvVar: envName,
    headers: { "X-Fixture": "present" },
    startupTimeoutMs: 1000,
    toolTimeoutMs: 1000,
  });
  const connector = mcp.get("remote")!;
  await withConnector(connector, (client) =>
    client.listTools(undefined, { timeout: connector.toolTimeoutMs }),
  );
  assert.ok(
    auth.length > 0 && auth.every((value) => value === "Bearer mcp-env-secret"),
  );
  assert.doesNotMatch(
    JSON.stringify(mcp.view()),
    /mcp-env-secret|X-Fixture|bearerTokenEnvVar/,
  );
  assert.doesNotMatch(readFileSync(mcp.storage.file, "utf8"), /mcp-env-secret/);
  delete process.env[envName];
  await assert.rejects(
    withConnector(connector, (client) => client.listTools()),
    new RegExp(envName),
  );
});

test("readable and Unicode connection IDs work through HTTP update and delete routes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-config-api-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
  });
  t.after(async () => {
    await app.product.close();
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.product.db.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const headers = { "content-type": "application/json", "x-apsis-client": "1" };
  for (const [name, expected] of [
    ["Company", "company"],
    ["公司模型", "公司模型"],
    ["Default", "default-2"],
  ]) {
    const created = await fetch(base + "/api/connections", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        provider: "ollama",
        model: "qwen3.5",
        url: "http://localhost:11434",
      }),
    });
    assert.equal(created.status, 201);
    const row = await created.json();
    assert.equal(row.id, expected);
    const path = base + "/api/connections/" + encodeURIComponent(row.id);
    const updated = await fetch(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...row, name: "Renamed" }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).id, expected);
    const removed = await fetch(path, { method: "DELETE", headers });
    assert.equal(removed.status, 200);
    assert.ok(!app.connections.view().some((r) => r.id === expected));
  }
});
