import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { Connections } from "../server/connections.ts";
import { contextBudget } from "../server/context-budget.ts";
import { checkpoint, restoreCheckpoint } from "../server/context-checkpoint.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { runDeep } from "../server/engines/deep.ts";

// Uses configured credentials without modifying the real conversation store.
// Each run invokes the selected model and incurs the provider's normal usage.
const connections = await new Connections(resolve(".apsis")).init();
const selected = process.argv[2]
  ? connections.selection(process.argv[2], process.argv[3])
  : connections.defaultSelection();
if (!selected) throw new Error("請先配置可執行的模型。");
const row = connections.view().find((c) => c.id === selected.connectionId)!;
const settings = row.modelSettings?.[selected.model];
const budget = contextBudget(row.provider, selected.model, settings);
const env = connections.environment(selected.connectionId, selected.model);
const dir = await mkdtemp(join(tmpdir(), "apsis-real-context-"));
let store = await new Store(join(dir, "data")).init();
const workspace = await new Workspace(join(dir, "workspace")).init();
const id = randomUUID(),
  code = "APSIS-" + randomUUID().slice(0, 8);
await store.mutate((state) =>
  state.sessions.push({
    id,
    title: "Context verification",
    mode: "deepagents",
    createdAt: new Date().toISOString(),
    messages: [],
  }),
);
const contextId = store.conversations.activeId(id);
try {
  for (let cycle = 0; cycle < 3; cycle++) {
    const previous = restoreCheckpoint(
      store.conversations.load(id).engineState,
    );
    const messages = previous?.messages || [
      new HumanMessage(
        `專案識別碼是 ${code}。必須保留此識別碼。尚未完成工作是驗證 proof.txt；不要聲稱驗證已完成。`,
      ),
      new AIMessage("已記住目標、識別碼與尚未完成的驗證。"),
    ];
    // Append harmless synthetic logs until compaction is required.
    const filler =
      "Archived observation: unchanged fixture data, no action performed. ".repeat(
        20,
      );
    for (let n = 0; n < Math.ceil((budget.trigger * 4) / filler.length); n++)
      messages.push(
        new HumanMessage(`Archive ${cycle}/${n}: ${filler}`),
        new AIMessage("Observation retained."),
      );
    store.conversations.saveCheckpoint(
      id,
      contextId,
      checkpoint({
        messages,
        todos: [{ content: "驗證 proof.txt", status: "pending" }],
      }),
    );
    const result = await runDeep({
      store,
      workspace,
      session: store.conversations.load(id),
      mode: "deepagents",
      env,
      modelSettings: settings,
      prompt: "請簡短回答專案識別碼，以及仍未完成的工作。不要執行工具。",
      allowWrites: false,
      emit: () => {},
      signal: AbortSignal.timeout(180000),
      source: { sessionId: id, runId: randomUUID() },
      maxTurns: 8,
    });
    assert.ok(result.text.includes(code), "模型未保留專案識別碼");
    assert.ok(result.text.includes("proof.txt"), "模型未保留待辦證據路徑");
    assert.ok(
      store.conversations.compactions(id).length >= cycle + 1,
      "未觸發預期壓縮",
    );
    store.conversations.db.close();
    store = await new Store(join(dir, "data")).init();
    console.log(
      `Compaction ${cycle + 1}: identifiers and unfinished work retained after restart.`,
    );
  }
  console.log(
    JSON.stringify({
      passed: true,
      model: selected.model,
      evidenceDirectory: dir,
    }),
  );
} catch (error) {
  let message = (error as Error).message;
  for (const secret of [
    env.OPENAI_API_KEY,
    env.ANTHROPIC_API_KEY,
    env.COMPATIBLE_API_KEY,
  ])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(message);
  process.exitCode = 1;
} finally {
  store.conversations.db.close();
}
