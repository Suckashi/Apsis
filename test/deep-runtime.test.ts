import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAgent } from "../server/agent.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { createTools } from "../server/tools.ts";
import { toolSchema } from "../server/engines/common.ts";
import type { AgentDefinition, Session } from "../shared/types.ts";

test("Deep Agents streams, reads a real workspace file, and continues saved history", async (t) => {
  const requests: Record<string, any>[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(input);
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-secret");
    const send = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: `chunk-${requests.length}`, object: "chat.completion.chunk", created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests.length === 1) {
      send({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "read-proof",
            type: "function",
            function: {
              name: "workspace_read_file",
              arguments: '{"path":"proof.txt"}',
            },
          },
        ],
      });
      send({}, "tool_calls");
    } else {
      send({ role: "assistant", content: "Evidence " });
      send({ content: "PROOF-4521" });
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

  const dir = await mkdtemp(join(tmpdir(), "apsis-deep-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  await workspace.write("proof.txt", "PROOF-4521");
  const agent: AgentDefinition = {
    id: "test-agent",
    name: "Researcher",
    description: "",
    instructions: "Read the requested file.",
    engine: "deepagents",
    provider: "openai-compatible",
    model: "fixture",
    tools: ["read_file"],
    skillIds: [],
    memoryScope: "private",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const session: Session = {
    id: "test-session",
    title: "Test",
    mode: "deepagents",
    createdAt: new Date().toISOString(),
    messages: [],
    agent,
  };
  const base = {
    modelSettings: { contextWindowTokens: 128000 },
    mode: "deepagents" as const,
    session,
    agent,
    store,
    workspace,
    allowWrites: false,
    env: {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_ID: "fixture",
      COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      COMPATIBLE_API_KEY: "test-secret",
    },
    signal: AbortSignal.timeout(10000),
    emit: () => {},
  };
  const first = await runAgent({ ...base, prompt: "Read proof.txt" });
  assert.match(first.text, /PROOF-4521/);
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1].messages), /PROOF-4521/);
  session.engineState = first.engineState;
  const second = await runAgent({ ...base, prompt: "Repeat the result" });
  assert.match(second.text, /PROOF-4521/);
  assert.equal(requests.length, 3);
  assert.match(JSON.stringify(requests[2].messages), /Evidence PROOF-4521/);
});

test("workspace edit tool uses structured Deep Agents arguments and records a patch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-edit-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  await workspace.write("note.txt", "before\n");
  const agent: AgentDefinition = {
    id: "editor",
    name: "Editor",
    description: "",
    instructions: "",
    engine: "deepagents",
    provider: "openai-compatible",
    model: "fixture",
    tools: ["edit_file"],
    skillIds: [],
    memoryScope: "private",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const operations: { status: string; evidence?: { patch?: string } }[] = [];
  const edit = createTools({
    store,
    workspace,
    agent,
    allowWrites: true,
    permissions: { files: true, memory: false, skills: false },
    recordOperation: async (operation) => {
      operations.push(operation);
    },
  }).find((item) => item.name === "edit_file")!;
  const args = {
    path: "note.txt",
    edits: [{ oldText: "before", newText: "after" }],
  };
  assert.deepEqual(toolSchema(edit).parse(args), args);
  await edit.execute("edit", args);
  assert.equal(await workspace.read("note.txt"), "after\n");
  assert.equal(operations.at(-1)?.status, "succeeded");
  assert.match(operations.at(-1)?.evidence?.patch || "", /after/);
});

test("Deep Agents rejects a blank final response", async (t) => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ id: "blank", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "stop" }] })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const dir = await mkdtemp(join(tmpdir(), "apsis-empty-response-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  const session: Session = {
    id: "empty-response",
    title: "Test",
    mode: "deepagents",
    createdAt: new Date().toISOString(),
    messages: [],
  };
  await assert.rejects(
    runAgent({
      modelSettings: { contextWindowTokens: 128000 },
      mode: "deepagents",
      session,
      store,
      workspace,
      allowWrites: false,
      env: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_ID: "fixture",
        COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      },
      signal: AbortSignal.timeout(10000),
      emit: () => {},
      prompt: "Complete a task",
    }),
    /模型未回傳文字結果/,
  );
});
