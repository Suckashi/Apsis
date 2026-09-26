import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDeep } from "../server/engines/deep.ts";
import { boundedEvidence, ToolExecutionError } from "../server/evidence.ts";
import { connectionsSchema } from "../server/storage-schema.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { codingTools } from "../server/coding-tools.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "apsis-engine-settings-"));
  return {
    store: await new Store(join(dir, "data")).init(),
    workspace: await new Workspace(join(dir, "work")).init(),
    allowWrites: true,
    permissions: { files: true, shell: true, memory: false, skills: false },
  };
}

test("connection model settings are optional and validate token budgets", () => {
  const legacy = {
    id: "20cc5dc1-5695-4321-952f-2957db4bc761",
    name: "Legacy",
    provider: "openai",
    model: "fixture",
  };
  assert.deepEqual(connectionsSchema.parse([legacy]), [legacy]);
  const current = {
    ...legacy,
    modelSettings: {
      fixture: { displayName: "Friendly model", maxOutputTokens: 8192 },
      other: {},
    },
  };
  assert.deepEqual(connectionsSchema.parse([current]), [current]);
  for (const maxOutputTokens of [0, -1, 1.5, Infinity, "8192"]) {
    assert.equal(
      connectionsSchema.safeParse([
        { ...legacy, modelSettings: { fixture: { maxOutputTokens } } },
      ]).success,
      false,
    );
  }
});

test("evidence supports configured limits while retaining legacy defaults", () => {
  const output = "x".repeat(35000);
  assert.equal(boundedEvidence({ output }).output?.length, 24000);
  assert.equal(boundedEvidence({ output }, 30000).output?.length, 30000);
  assert.equal(boundedEvidence({ output }, 30000).truncated, true);
  assert.equal(boundedEvidence({ output: "ok" }, 30000).truncated, false);
});

for (const outputLimit of [100, 30000]) {
  test(`shell capture and evidence respect outputLimit=${outputLimit}`, async () => {
    const base = await fixture();
    const options = {
      ...base,
      runtimeSettings: {
        maxTurns: 48,
        taskTimeoutMs: 60000,
        shellTimeoutSeconds: 10,
        outputLimit,
        maxDelegationDepth: 1,
        maxDelegatedJobs: 1,
        maxConcurrent: 1,
      },
    };
    const shell = codingTools(options).find((tool) => tool.name === "shell")!;
    const command = "printf '%35000s' '' | tr ' ' x";
    const result = await shell.execute("capture", { command });
    assert.equal(
      result.content[0].type === "text" && result.content[0].text.length,
      outputLimit,
    );
    const evidence = result.details.evidence as {
      output: string;
      truncated: boolean;
    };
    assert.equal(evidence.output.length, outputLimit);
    assert.equal(evidence.truncated, true);
    await assert.rejects(
      shell.execute("failure", { command: command + "; exit 1" }),
      (error) => {
        assert.ok(error instanceof ToolExecutionError);
        assert.equal(error.evidence.output?.length, outputLimit);
        return true;
      },
    );
  });
}

test("shell uses the configured default timeout", async () => {
  const options = {
    ...(await fixture()),
    runtimeSettings: {
      maxTurns: 48,
      taskTimeoutMs: 60000,
      shellTimeoutSeconds: 1,
      outputLimit: 100,
      maxDelegationDepth: 1,
      maxDelegatedJobs: 1,
      maxConcurrent: 1,
    },
  };
  const shell = codingTools(options).find((tool) => tool.name === "shell")!;
  const started = Date.now();
  await assert.rejects(
    shell.execute("timeout", {
      command: "sleep 10",
    }),
    ToolExecutionError,
  );
  assert.ok(Date.now() - started < 8000);
});

test("shell retains the legacy timeout and clamps overrides to 1–120 seconds", async (t) => {
  const delays: number[] = [];
  const original = globalThis.setTimeout;
  t.mock.method(
    globalThis,
    "setTimeout",
    (...args: Parameters<typeof original>) => {
      delays.push(args[1] as number);
      return original(...args);
    },
  );
  const options = await fixture();
  const shell = codingTools(options).find((tool) => tool.name === "shell")!;
  for (const [timeout, expected] of [
    [undefined, 60000],
    [500, 120000],
    [0, 1000],
  ] as const) {
    delays.length = 0;
    await shell.execute("clamp", { command: "echo ok", timeout });
    assert.ok(delays.includes(expected), `expected a ${expected}ms timeout`);
  }
});

test("DeepAgents applies model budgets, excludes bypass tools, and retains private scratch", async (t) => {
  const requests: Record<string, any>[] = [];
  let nextTool: string | undefined;
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(input);
    const name = nextTool;
    nextTool = undefined;
    const args =
      name === "write_file"
        ? { file_path: "/private.txt", content: "scratch only" }
        : name === "task"
          ? { description: "bypass", subagent_type: "general-purpose" }
          : { command: "echo bypass" };
    const delta = name
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call-${requests.length}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        }
      : { role: "assistant", content: "Done" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({
        id: `chunk-${requests.length}`,
        object: "chat.completion.chunk",
        created: 1,
        model: input.model,
        choices: [
          { index: 0, delta, finish_reason: name ? "tool_calls" : "stop" },
        ],
      })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const base = {
    ...(await fixture()),
    mode: "deepagents" as const,
    session: {
      id: "settings",
      title: "Settings",
      mode: "deepagents" as const,
      createdAt: new Date().toISOString(),
      messages: [],
    },
    env: {
      MODEL_PROVIDER: "openai-compatible",
      MODEL_ID: "fixture",
      COMPATIBLE_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
    },
    modelSettings: { contextWindowTokens: 128000 },
    prompt: "Test settings",
    emit: () => {},
    signal: AbortSignal.timeout(20000),
  };
  base.store.conversations.saveSession(base.session);
  Object.assign(base.session, {
    workContextId: base.store.conversations.activeId(base.session.id),
  });
  await runDeep(base);
  assert.equal(requests[0].max_tokens, 4096);
  const names = requests[0].tools.map((tool: any) => tool.function.name);
  assert.ok(names.includes("write_file"));
  assert.ok(names.includes("shell"));
  assert.ok(!names.includes("task"));
  assert.ok(!names.includes("execute"));
  assert.equal(requests[0].reasoning_effort, undefined);
  for (const name of ["task", "execute", "write_file"]) {
    nextTool = name;
    const start = requests.length;
    const options = {
      ...base,
      modelSettings: {
        displayName: "Friendly",
        maxOutputTokens: 8192,
        contextWindowTokens: 128000,
      },
    };
    const result = await runDeep(options);
    assert.equal(requests[start].model, "fixture");
    assert.equal(requests[start].max_tokens, 8192);
    assert.equal(requests.length - start, 2);
    if (name === "write_file") {
      assert.equal(result.engineState?.version, 1);
      assert.ok(
        await import("node:fs/promises").then((fs) =>
          fs.readFile(
            base.store.conversations.scratchRoot(
              base.session.id,
              base.store.conversations.activeId(base.session.id),
            ) + "/private.txt",
            "utf8",
          ),
        ),
      );
      await assert.rejects(base.workspace.read("private.txt"));
    } else {
      assert.match(
        JSON.stringify(requests.at(-1)?.messages),
        /not available|not a valid tool/,
      );
    }
  }
  const start = requests.length;
  nextTool = "write_file";
  const limited = { ...base, maxTurns: 1 };
  await assert.rejects(runDeep(limited), /recursion|limit/i);
  assert.ok(
    requests.length - start <= 1,
    "maxTurns=1 must not silently become 48",
  );
  nextTool = "write_file";
  const configured = {
    ...base,
    maxTurns: 48,
    runtimeSettings: {
      maxTurns: 1,
      taskTimeoutMs: 60000,
      shellTimeoutSeconds: 10,
      outputLimit: 100,
      maxDelegationDepth: 1,
      maxDelegatedJobs: 1,
      maxConcurrent: 1,
    },
  };
  const configuredStart = requests.length;
  await assert.rejects(runDeep(configured), /recursion|limit/i);
  assert.ok(requests.length - configuredStart <= 1);
});
