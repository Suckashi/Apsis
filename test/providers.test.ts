import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { Connections } from "../server/connections.ts";
import { Settings } from "../server/settings.ts";
import type { Environment, Session } from "../shared/types.ts";

test("provider catalogs retain legacy arrays and persist a selected default without exposing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-providers-"));
  const id = randomUUID();
  await writeFile(
    join(directory, "connections.json"),
    JSON.stringify([
      {
        id,
        name: "Old connection",
        provider: "openai-compatible",
        model: "old-model",
        url: "http://127.0.0.1:4321/v1",
        apiKey: "private-key",
      },
    ]),
  );
  const settings = await new Settings(directory, {}).init();
  const connections = await new Connections(directory, settings).init();
  assert.deepEqual(connections.defaultSelection(), {
    connectionId: id,
    model: "old-model",
  });
  assert.deepEqual(connections.view().find((row) => row.id === id)?.models, [
    "old-model",
  ]);
  assert.doesNotMatch(JSON.stringify(connections.view()), /private-key/);
  await assert.rejects(
    connections.save({
      name: "Kimi",
      provider: "openai-compatible",
      model: "missing",
      models: ["model-a"],
      vendor: "kimi",
      url: "http://127.0.0.1:4321/v1",
    }),
    /預設模型/,
  );
  await assert.rejects(
    connections.save({
      name: "Kimi",
      provider: "openai-compatible",
      model: "model-a",
      models: ["model-a", "model-a"],
      vendor: "kimi",
      url: "http://127.0.0.1:4321/v1",
    }),
    /重複/,
  );
  await connections.save(
    {
      name: "Kimi",
      provider: "openai-compatible",
      model: "model-a",
      models: ["model-a", "model-b"],
      vendor: "kimi",
      url: "http://127.0.0.1:4321/v1",
    },
    id,
  );
  assert.deepEqual(connections.view().find((row) => row.id === id)?.models, [
    "model-a",
    "model-b",
  ]);
  assert.equal(
    connections.environment(id, "model-b").COMPATIBLE_API_KEY,
    "private-key",
  );
  await assert.rejects(
    async () => connections.selection(id, "unknown"),
    /模型清單/,
  );
  assert.deepEqual(
    await connections.setDefault({ connectionId: id, model: "model-b" }),
    {
      connectionId: id,
      model: "model-b",
    },
  );
  assert.deepEqual(
    (await new Connections(directory, settings).init()).defaultSelection(),
    { connectionId: id, model: "model-b" },
  );
  assert.doesNotMatch(
    await readFile(join(directory, "connection-default.json"), "utf8"),
    /private-key/,
  );
  await assert.rejects(connections.archive(id), /預設模型/);
});

test("automatic default keeps a ready legacy model, otherwise accepts a keyless compatible endpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-auto-model-"));
  const settings = await new Settings(directory, {}).init();
  const connections = await new Connections(directory, settings).init();
  assert.deepEqual(connections.defaultSelection(), {
    connectionId: "legacy-openai",
    model: "gpt-4.1-mini",
  });
  const local = await connections.save({
    name: "Local compatible",
    provider: "openai-compatible",
    model: "local-model",
    url: "http://127.0.0.1:4323/v1",
  });
  assert.deepEqual(connections.defaultSelection(), {
    connectionId: local.id,
    model: "local-model",
  });
  const readySettings = await new Settings(directory, {
    PI_PROVIDER: "ollama",
    PI_MODEL: "qwen:local",
  }).init();
  const readyConnections = await new Connections(
    directory,
    readySettings,
  ).init();
  assert.deepEqual(readyConnections.defaultSelection(), {
    connectionId: "legacy-ollama",
    model: "qwen:local",
  });
});

test("ordinary conversations snapshot provider and model while the default changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-provider-chat-"));
  const work = join(directory, "work");
  await mkdir(work);
  const calls: Environment[] = [];
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: work,
    env: {},
    runner: async (options) => {
      calls.push({ ...options.env });
      return { text: "provider reply" };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.tasks.stopAll();
    app.server.closeAllConnections();
    app.server.close();
  });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/`;
  const request = (
    path: string,
    input?: unknown,
    method = input === undefined ? "GET" : "POST",
  ) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const connection = await (
    await request("connections", {
      name: "Model platform",
      provider: "openai-compatible",
      vendor: "custom",
      model: "alpha",
      models: ["alpha", "beta"],
      url: "http://127.0.0.1:4322/v1",
      apiKey: "isolated-secret",
    })
  ).json();
  assert.doesNotMatch(JSON.stringify(connection), /isolated-secret/);
  assert.deepEqual(await (await request("connections/default")).json(), {
    connectionId: connection.id,
    model: "alpha",
  });
  assert.equal(
    (
      await request(
        "connections/default",
        { connectionId: connection.id, model: "beta" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.deepEqual(await (await request("connections/default")).json(), {
    connectionId: connection.id,
    model: "beta",
  });
  assert.deepEqual(
    (
      (await (await request("status")).json()) as {
        provider: string;
        model: string;
      }
    ).model,
    "beta",
  );
  const session: Session = await (
    await request("sessions", { mode: "pi" })
  ).json();
  assert.equal(session.connectionId, connection.id);
  assert.equal(session.provider, "openai-compatible");
  assert.equal(session.model, "beta");
  const local = await (
    await request("connections", {
      name: "Local",
      provider: "ollama",
      vendor: "ollama",
      model: "qwen:local",
      url: "http://127.0.0.1:11434",
    })
  ).json();
  await request(
    "connections/default",
    { connectionId: local.id, model: "qwen:local" },
    "PUT",
  );
  await app.tasks.run(session.id, "hello", false);
  assert.equal(calls[0].PI_PROVIDER, "openai-compatible");
  assert.equal(calls[0].PI_MODEL, "beta");
  assert.equal(calls[0].COMPATIBLE_API_KEY, "isolated-secret");
  const other: Session = await (
    await request("sessions", {
      mode: "pi",
      connectionId: connection.id,
      model: "alpha",
    })
  ).json();
  assert.equal(other.model, "alpha");
  assert.equal(
    (
      await request(
        `connections/${connection.id}`,
        {
          name: "Model platform",
          provider: "openai-compatible",
          vendor: "custom",
          model: "alpha",
          models: ["alpha", "beta", "gamma"],
          url: "http://127.0.0.1:4322/v1",
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `connections/${connection.id}`,
        {
          name: "Changed provider",
          provider: "anthropic",
          model: "claude-model",
          models: ["claude-model"],
        },
        "PUT",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request("sessions", {
        mode: "pi",
        connectionId: connection.id,
        model: "not-listed",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("sessions", { mode: "pi", model: "beta" })).status,
    400,
  );
  assert.equal(
    (await request(`connections/${connection.id}`, undefined, "DELETE")).status,
    409,
  );
  assert.doesNotMatch(
    JSON.stringify(app.tasks.view(session.id)),
    /isolated-secret/,
  );
});
