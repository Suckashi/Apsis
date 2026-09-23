import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { agentContext, createTools } from "../server/agent.ts";
import { parseAgent } from "../server/agents.ts";
import type {
  AgentDefinition,
  RunEvent,
  SessionView,
} from "../shared/types.ts";

const definition = {
  name: "Research",
  description: "A specialist",
  instructions: "Specialist instruction: verify evidence.",
  engine: "pi",
  provider: "ollama",
  model: "qwen3.5:9b",
  memoryScope: "private",
  tools: [
    "read_file",
    "remember",
    "update_memory",
    "list_skills",
    "read_skill",
    "search_history",
  ],
  skillIds: ["starter"],
};
async function fixture(t: test.TestContext, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-agents-"));
  const work = join(dir, "work");
  await mkdir(work);
  await writeFile(join(work, "probe.txt"), "EVIDENCE-4521");
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: work,
    env,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
  });
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const request = (path: string, data?: unknown, method = "POST") =>
    fetch(base + "/api/" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  return { app, dir, base, request };
}
test("agent CRUD validates capabilities, snapshots conversations and archives without deleting history", async (t) => {
  const { request, app, dir, base } = await fixture(t);
  for (const change of [
    { engine: "invalid" },
    { engine: "openai-agents", provider: "anthropic" },
    { tools: ["shell"] },
    { skillIds: ["missing"] },
    { model: "qwen:cloud" },
  ])
    assert.equal(
      (await request("agents", { ...definition, ...change })).status,
      400,
    );
  const response = await request("agents", definition);
  assert.equal(response.status, 201);
  const agent: AgentDefinition = await response.json();
  assert.equal(
    (await request("sessions", { mode: "demo", agentId: agent.id })).status,
    400,
  );
  const session: SessionView = await (
    await request("sessions", { mode: "pi", agentId: agent.id })
  ).json();
  assert.equal(
    (
      await request(
        "agents/" + agent.id,
        { ...definition, memoryScope: "shared" },
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "agents/" + agent.id,
        { ...definition, name: "Edited", engine: "deepagents" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(app.store.state.sessions[0].agent?.name, "Research");
  assert.equal(app.store.state.sessions[0].agent?.engine, "pi");
  assert.equal(
    (await new Store(join(dir, "data")).init()).state.agents?.[0].engine,
    "deepagents",
  );
  await app.store.mutate((s) => {
    s.sessions[0].engineState = { history: ["internal"] };
  });
  for (const path of ["sessions", "sessions/" + session.id])
    assert.ok(
      !(await (await fetch(base + "/api/" + path)).text()).includes(
        "engineState",
      ),
    );
  assert.equal(
    (await request("agents/" + agent.id, undefined, "DELETE")).status,
    200,
  );
  assert.deepEqual(await (await fetch(base + "/api/agents")).json(), []);
  assert.equal(
    (await request("sessions", { mode: "pi", agentId: agent.id })).status,
    404,
  );
  assert.equal(app.store.state.sessions[0].agent?.name, "Research");
});
test("private agents cannot read or update other memories, skills or histories, and tools enforce writes", async (t) => {
  const { app } = await fixture(t);
  const first = parseAgent(definition, app.store.state);
  const other = parseAgent({ ...definition, name: "Other" }, app.store.state);
  const session = await app.tasks.create("pi", "web", other);
  await app.store.mutate((s) => {
    s.memories.push(
      { id: "global", content: "GLOBAL_SECRET" },
      { id: "other", agentId: other.id, content: "OTHER_SECRET" },
    );
    s.skills.push({
      id: "other-skill",
      agentId: other.id,
      name: "SECRET_SKILL",
      content: "hidden",
    });
    s.sessions
      .find((x) => x.id === session.id)!
      .messages.push({
        id: "private",
        role: "user",
        status: "complete",
        content: "PRIVATE_HISTORY",
      });
  });
  const options = {
    store: app.store,
    workspace: app.workspace,
    agent: first,
    allowWrites: false,
  };
  const tools = createTools(options);
  assert.ok(!tools.some((t) => t.name === "write_file"));
  const remember = tools.find((t) => t.name === "remember")!;
  await assert.rejects(remember.execute("t", { content: "own fact" }), /允許/);
  const writable = createTools({ ...options, allowWrites: true });
  await writable
    .find((t) => t.name === "remember")!
    .execute("t", { content: "OWN_FACT" });
  await assert.rejects(
    writable
      .find((t) => t.name === "update_memory")!
      .execute("t", { id: "other", content: "overwrite" }),
    /找不到/,
  );
  await assert.rejects(
    tools
      .find((t) => t.name === "read_skill")!
      .execute("t", { id: "other-skill" }),
    /找不到/,
  );
  const history = await tools
    .find((t) => t.name === "search_history")!
    .execute("t", { query: "PRIVATE_HISTORY" });
  assert.ok(!JSON.stringify(history).includes("PRIVATE_HISTORY"));
  const context = agentContext(app.store, false, first);
  assert.match(context, /OWN_FACT/);
  assert.doesNotMatch(context, /GLOBAL_SECRET|OTHER_SECRET|SECRET_SKILL/);
  assert.doesNotMatch(agentContext(app.store, false), /OWN_FACT|OTHER_SECRET/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    remember.execute("t", { content: "never" }, aborted.signal),
    /abort/i,
  );
  assert.equal(app.store.state.memories.at(-1)?.agentId, first.id);
});

for (const engine of ["pi", "deepagents", "openai-agents"] as const)
  test(`${engine} uses real SDK transport, tool permissions, scoped context and persisted continuation`, async (t) => {
    let calls = 0;
    const requests: Record<string, unknown>[] = [];
    const upstream = createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(input);
      calls++;
      assert.equal(req.url, "/custom/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer local-secret");
      const send = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          "data: " +
            JSON.stringify({
              id: "chunk-" + calls,
              object: "chat.completion.chunk",
              created: 1,
              model: input.model,
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            "\n\n",
        );
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (calls === 1) {
        send({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "read-proof",
              type: "function",
              function: {
                name:
                  engine === "deepagents" ? "workspace_read_file" : "read_file",
                arguments: JSON.stringify({ path: "probe.txt" }),
              },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        send({ role: "assistant", content: "Evidence " });
        send({ content: "EVIDENCE-4521" });
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
    const { app, request, dir } = await fixture(t, {
      OPENAI_API_KEY: "must-not-forward",
    });
    const setting = await request("settings/pi", {
      provider: "openai-compatible",
      model: "fixture",
      url:
        "http://127.0.0.1:" +
        (upstream.address() as AddressInfo).port +
        "/custom/v1",
      apiKey: "local-secret",
    });
    assert.equal(setting.status, 200);
    const agent: AgentDefinition = await (
      await request("agents", {
        ...definition,
        engine,
        provider: "openai-compatible",
        model: "fixture",
        tools: ["read_file"],
      })
    ).json();
    const session: SessionView = await (
      await request("sessions", { mode: "pi", agentId: agent.id })
    ).json();
    const run = async (prompt: string) => {
      const result = await request("sessions/" + session.id + "/chat", {
        prompt,
        allowWrites: false,
      });
      const events: RunEvent[] = (await result.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.equal(events.at(-1)?.type, "done", JSON.stringify(events));
      assert.ok(events.some((e) => e.type === "delta"));
      return events;
    };
    await run("Read probe.txt");
    assert.equal(calls, 2);
    assert.match(JSON.stringify(requests[1]), /EVIDENCE-4521/);
    assert.match(
      JSON.stringify(requests[0].messages),
      /Specialist instruction/,
    );
    assert.doesNotMatch(
      JSON.stringify(requests[0].tools),
      /workspace_write_file|remember/,
    );
    const reopened = await new Store(join(dir, "data")).init();
    app.store.state = reopened.state;
    await run("Repeat your last answer from history");
    assert.equal(calls, 3);
    assert.match(
      JSON.stringify(requests[2].messages),
      /Evidence EVIDENCE-4521/,
    );
    assert.equal(app.store.state.sessions[0].messages.length, 4);
  });

for (const engine of ["deepagents", "openai-agents"] as const)
  test(`${engine} cancellation stops streaming and leaves no resumable partial engine state`, async (t) => {
    let received!: () => void;
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    const upstream = createServer(async (req, res) => {
      for await (const _ of req) {
        /* consume request */
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        'data: {"id":"pending","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"Starting"},"finish_reason":null}]}\n\n',
      );
      received();
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const { app, request } = await fixture(t);
    await request("settings/pi", {
      provider: "openai-compatible",
      model: "fixture",
      url:
        "http://127.0.0.1:" + (upstream.address() as AddressInfo).port + "/v1",
    });
    const agent = parseAgent(
      {
        ...definition,
        engine,
        provider: "openai-compatible",
        model: "fixture",
      },
      app.store.state,
    );
    const session = await app.tasks.create("pi", "web", agent);
    const events: RunEvent[] = [];
    const run = app.tasks.run(session.id, "Wait", false, (event) =>
      events.push(event),
    );
    const rejected = assert.rejects(run, /已停止/);
    await started;
    app.tasks.stop(session.id);
    await rejected;
    assert.equal(app.tasks.running.size, 0);
    assert.equal(app.store.state.sessions[0].engineState, undefined);
    assert.equal(app.store.state.sessions[0].messages.at(-1)?.status, "error");
    assert.equal(events.at(-1)?.type, "error");
  });
