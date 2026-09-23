import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { Store } from "../server/store.ts";
import { Connections } from "../server/connections.ts";
import { Settings } from "../server/settings.ts";
import { RunStore } from "../server/runs.ts";
import { rankMemories } from "../server/knowledge.ts";
import { agentContext } from "../server/context.ts";
import type { TaskRun, ToolOperation } from "../shared/types.ts";

async function fixture(t: test.TestContext, runner?: AppOptions["runner"]) {
  const dir = await mkdtemp(join(tmpdir(), "talaria-product-"));
  const work = join(dir, "work");
  await mkdir(work);
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: work,
    env: { PI_PROVIDER: "ollama", PI_MODEL: "local" },
    runner,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.tasks.stopAll();
    app.server.closeAllConnections();
    app.server.close();
  });
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const request = (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(base + "/api/" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, request, dir, work };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Condition did not settle");
}

test("server-owned runs return before completion, survive client departure, reject duplicates and stop explicitly", async (t) => {
  let finish!: () => void;
  const { request, app } = await fixture(t, async (options) => {
    await new Promise<void>((resolve, reject) => {
      finish = resolve;
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("stopped")),
        { once: true },
      );
    });
    options.emit({ type: "delta", text: "Finished independently" });
    return { text: "Finished independently" };
  });
  const session = await (await request("sessions", { mode: "pi" })).json();
  const response = await request(`sessions/${session.id}/runs`, {
    prompt: "work",
    permissions: { files: false, memory: true, skills: false },
  });
  assert.equal(response.status, 202);
  const run = await response.json();
  assert.equal(run.status, "running");
  assert.equal(
    (
      await request(`sessions/${session.id}/runs`, {
        prompt: "duplicate",
        permissions: { files: false, memory: false, skills: false },
      })
    ).status,
    409,
  );
  await until(() => !!finish);
  finish();
  await until(() => !app.tasks.running.size);
  const saved: TaskRun = await (await request("runs/" + run.id)).json();
  assert.equal(saved.status, "completed");
  assert.equal(saved.text, "Finished independently");
  assert.equal(app.tasks.view(session.id).messages.length, 2);
  finish = undefined!;
  const second = await (
    await request(`sessions/${session.id}/runs`, {
      prompt: "stop this",
      permissions: { files: false, memory: false, skills: false },
    })
  ).json();
  await until(() => !!finish);
  await request("runs/" + second.id + "/stop", {});
  await until(() => !app.tasks.running.size);
  assert.equal(
    (await (await request("runs/" + second.id)).json()).status,
    "cancelled",
  );
  const listed = await (await request("runs?sessionId=" + session.id)).json();
  assert.equal(listed.total, 2);
});

test("write categories enforce independent grants and journal operations with knowledge provenance", async (t) => {
  const { app, work } = await fixture(t);
  const operations: ToolOperation[] = [];
  const tools = createTools({
    store: app.store,
    workspace: app.workspace,
    allowWrites: true,
    permissions: { files: false, memory: true, skills: false },
    source: { sessionId: "source", runId: "run" },
    recordOperation: async (op) => {
      operations.push(op);
    },
  });
  const call = (name: string, args: unknown) =>
    tools.find((tool) => tool.name === name)!.execute("call", args);
  await assert.rejects(
    call("write_file", { path: "blocked.txt", content: "no" }),
    /權限/,
  );
  await assert.rejects(
    call("save_skill", { name: "no", content: "no" }),
    /權限/,
  );
  await call("remember", { content: "Use TypeScript." });
  await call("remember", { content: "use typescript" });
  assert.equal(app.store.state.memories.length, 1);
  assert.equal(app.store.state.memories[0].source?.runId, "run");
  assert.equal(operations[0].status, "started");
  assert.equal(operations[1].status, "failed");
  assert.equal(operations.at(-1)?.status, "succeeded");
  assert.match(
    agentContext(app.store, false, undefined, "", {
      files: false,
      memory: true,
      skills: false,
    }),
    /files=false, memory=true, skills=false/,
  );
  let first = true;
  const uncertain: ToolOperation[] = [];
  const writable = createTools({
    store: app.store,
    workspace: app.workspace,
    allowWrites: true,
    recordOperation: async (op) => {
      uncertain.push(op);
      if (op.status === "succeeded" && first) {
        first = false;
        throw new Error("journal unavailable");
      }
    },
  });
  await assert.rejects(
    writable
      .find((t) => t.name === "write_file")!
      .execute("call", { path: "written.txt", content: "saved" }),
    /journal/,
  );
  assert.equal(await readFile(join(work, "written.txt"), "utf8"), "saved");
  assert.equal(uncertain.at(-1)?.status, "unknown");
});

test("restart preserves completed operations and marks uncertain operations without replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-runs-"));
  const runs = await new RunStore(dir).init();
  const run: TaskRun = {
    id: randomUUID(),
    sessionId: randomUUID(),
    engine: "pi",
    agentName: "Test",
    model: "local",
    permissions: { files: true, memory: false, skills: false },
    status: "running",
    createdAt: new Date().toISOString(),
    text: "partial",
    activity: [],
    operations: [
      {
        id: "a",
        name: "write_file",
        status: "succeeded",
        startedAt: "now",
        mutating: true,
      },
      {
        id: "b",
        name: "write_file",
        status: "started",
        startedAt: "now",
        mutating: true,
      },
    ],
  };
  await runs.save(run);
  const restarted = await new RunStore(dir).init();
  const saved = restarted.records.get(run.id)!;
  assert.equal(saved.status, "interrupted");
  assert.deepEqual(
    saved.operations.map((op) => op.status),
    ["succeeded", "unknown"],
  );
  assert.equal(
    (await new RunStore(dir).init()).records.get(run.id)!.status,
    "interrupted",
  );
});

test("named credentials are isolated, endpoint changes clear keys, stale tests do not certify edited connections", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-connections-"));
  const settings = await new Settings(dir, {
    OPENAI_API_KEY: "legacy-secret",
  }).init();
  const connections = await new Connections(dir, settings).init();
  const a = await connections.save({
    name: "A",
    provider: "openai-compatible",
    model: "one",
    url: "http://127.0.0.1:4321/v1",
    apiKey: "secret-a",
  });
  const b = await connections.save({
    name: "B",
    provider: "openai-compatible",
    model: "two",
    url: "http://127.0.0.1:4322/v1",
    apiKey: "secret-b",
  });
  assert.equal(connections.environment(a.id).COMPATIBLE_API_KEY, "secret-a");
  assert.equal(connections.environment(b.id).COMPATIBLE_API_KEY, "secret-b");
  assert.equal(connections.environment(a.id).OPENAI_API_KEY, undefined);
  assert.doesNotMatch(JSON.stringify(connections.view()), /secret-/);
  const fingerprint = connections.fingerprint(a.id);
  await connections.save({ ...a, url: "http://127.0.0.1:4323/v1" }, a.id);
  assert.equal(connections.environment(a.id).COMPATIBLE_API_KEY, undefined);
  await connections.verified(
    a.id,
    {
      engine: "pi",
      model: "one",
      at: "now",
      ok: true,
      streaming: true,
      tools: true,
      message: "ok",
    },
    fingerprint,
  );
  assert.equal(
    connections.view().find((c) => c.id === a.id)?.verification,
    undefined,
  );
  assert.equal(
    (await new Connections(dir, settings).init()).environment(b.id)
      .COMPATIBLE_API_KEY,
    "secret-b",
  );
});

test("knowledge editing retains revisions, excludes disabled entries and confines merges to matching scope", async (t) => {
  const { request, app } = await fixture(t);
  const a = await (
    await request("memories", { content: "TypeScript preference" })
  ).json();
  const duplicate = await (
    await request("memories", { content: "typescript preference." })
  ).json();
  assert.equal(a.id, duplicate.id);
  const b = await (
    await request("memories", { content: "Node development" })
  ).json();
  await request(
    "memories/" + a.id,
    { content: "Use strict TypeScript" },
    "PUT",
  );
  let updated = app.store.state.memories.find((m) => m.id === a.id)!;
  assert.equal(updated.revisions?.[0].content, "TypeScript preference");
  await request("memories/" + a.id, { enabled: false }, "PUT");
  assert.doesNotMatch(agentContext(app.store, false), /Use strict TypeScript/);
  await request("memories/" + a.id, { enabled: true, mergeId: b.id }, "PUT");
  updated = app.store.state.memories.find((m) => m.id === a.id)!;
  assert.match(updated.content, /Node development/);
  assert.equal(
    app.store.state.memories.find((m) => m.id === b.id)?.mergedInto,
    a.id,
  );
  const secret = randomUUID();
  await app.store.mutate((s) =>
    s.memories.push({
      id: secret,
      agentId: "private",
      content: "Secret",
      createdAt: "now",
    }),
  );
  assert.equal(
    (await request("memories/" + a.id, { mergeId: secret }, "PUT")).status,
    400,
  );
  assert.equal(
    rankMemories(
      [
        { id: "a", content: "Other", createdAt: "now" },
        { id: "b", content: "TypeScript", createdAt: "now" },
      ],
      "TypeScript",
    )[0].id,
    "b",
  );
});

test("versioned storage migrates with backup and rejects corrupt data without overwriting it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-schema-"));
  const file = join(dir, "state.json");
  const old = JSON.stringify({ sessions: [], memories: [], skills: [] });
  await writeFile(file, old);
  const store = await new Store(dir).init();
  assert.equal(store.state.schemaVersion, 1);
  assert.equal(await readFile(join(dir, "state.pre-v1.json"), "utf8"), old);
  await store.mutate((s) =>
    s.memories.push({ id: randomUUID(), content: "kept", createdAt: "now" }),
  );
  assert.ok(JSON.parse(await readFile(file + ".bak", "utf8")).schemaVersion);
  await writeFile(file, '{"schemaVersion":999}');
  await assert.rejects(new Store(dir).init(), /資料格式/);
  assert.equal(await readFile(file, "utf8"), '{"schemaVersion":999}');
});

for (const engine of ["pi", "deepagents", "openai-agents"])
  test(`${engine} connection probe verifies actual streaming and tool output without exposing owner data`, async (t) => {
    let nonce = "";
    let calls = 0;
    let skipTool = false;
    const upstream = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(req.headers.authorization, "Bearer probe-secret");
      assert.doesNotMatch(JSON.stringify(body), /OWNER_PRIVATE_FACT/);
      assert.ok(
        body.tools.some(
          (tool: { function: { name: string } }) =>
            tool.function.name === "connection_probe",
        ),
      );
      assert.ok(
        !body.tools.some((tool: { function: { name: string } }) =>
          [
            "remember",
            "workspace_read_file",
            ...(engine === "deepagents" ? [] : ["read_file"]),
          ].includes(tool.function.name),
        ),
      );
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          "data: " +
            JSON.stringify({
              id: "probe-" + calls,
              object: "chat.completion.chunk",
              created: 1,
              model: "fixture",
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            "\n\n",
        );
      const hasResult = body.messages.some(
        (m: { role: string }) => m.role === "tool",
      );
      if (!hasResult && !skipTool) {
        nonce =
          JSON.stringify(body.messages).match(
            /Call connection_probe with nonce ([a-f0-9-]+)/,
          )?.[1] || "";
        assert.ok(nonce);
        send({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "probe-call",
              type: "function",
              function: {
                name: "connection_probe",
                arguments: JSON.stringify({ nonce }),
              },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        send({
          role: "assistant",
          content: hasResult ? nonce : "I did not call a tool",
        });
        send({}, "stop");
      }
      calls++;
      res.end("data: [DONE]\n\n");
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const { request, app } = await fixture(t);
    await app.store.mutate((s) =>
      s.memories.push({
        id: randomUUID(),
        content: "OWNER_PRIVATE_FACT",
        createdAt: "now",
      }),
    );
    const connection = await (
      await request("connections", {
        name: "Probe",
        provider: "openai-compatible",
        model: "fixture",
        url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
        apiKey: "probe-secret",
      })
    ).json();
    const result = await (
      await request("connections/" + connection.id + "/test", { engine })
    ).json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.tools, true);
    assert.equal(result.streaming, true);
    assert.equal(calls, 2);
    assert.equal(app.store.state.sessions.length, 0);
    assert.equal(app.store.state.memories.length, 1);
    skipTool = true;
    const failure = await (
      await request("connections/" + connection.id + "/test", { engine })
    ).json();
    assert.equal(failure.ok, false);
    assert.equal(failure.tools, false);
    assert.equal(failure.streaming, true);
  });
