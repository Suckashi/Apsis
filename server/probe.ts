import { randomUUID } from "node:crypto";
import { Connections } from "./connections.ts";
import { Store } from "./store.ts";
import { Workspace } from "./workspace.ts";
import { runAgent } from "./agent.ts";
import { engineLabels } from "../shared/agents.ts";
import type { AgentEngine, Session } from "../shared/types.ts";

export async function testConnection(
  connections: Connections,
  id: string,
  input: Record<string, unknown>,
) {
  const engine = (input.engine || "pi") as AgentEngine;
  if (!Object.hasOwn(engineLabels, engine))
    throw Object.assign(new Error("未知引擎。"), { status: 400 });
  const model =
    typeof input.model === "string" ? input.model.trim() : undefined;
  if (model && (model.length > 200 || /[\u0000-\u001f]/u.test(model)))
    throw Object.assign(new Error("模型格式錯誤。"), { status: 400 });
  const env = connections.environment(id, model);
  const fingerprint = connections.fingerprint(id);
  const nonce = randomUUID();
  let called = false;
  let streaming = false;
  const store = new Store("");
  store.state = { sessions: [], memories: [], skills: [] };
  const agent = {
    id: "probe",
    name: "Connection test",
    description: "",
    instructions:
      "Use connection_probe exactly once, then reply with its returned nonce. Do not use other tools.",
    engine,
    provider: env.PI_PROVIDER as import("../shared/types.ts").Provider,
    model: env.PI_MODEL!,
    tools: [],
    skillIds: [],
    memoryScope: "private" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const session: Session = {
    id: "probe",
    title: "Connection test",
    mode: "pi",
    createdAt: new Date().toISOString(),
    messages: [],
    piMessages: [],
    agent,
  };
  let message = "",
    ok = false;
  try {
    const result = await runAgent({
      mode: "pi",
      session,
      agent,
      store,
      workspace: new Workspace("."),
      env,
      prompt: `Call connection_probe with nonce ${nonce} and then reply with its exact output.`,
      allowWrites: false,
      signal: AbortSignal.timeout(45000),
      probe: {
        nonce,
        called: () => {
          called = true;
        },
      },
      emit: (event) => {
        if (event.type === "delta") streaming = true;
      },
    });
    ok = called && streaming && result.text.includes(nonce);
    message = ok
      ? "已驗證連線、串流與工具呼叫。"
      : "連線有回應，但模型未完整通過串流／工具測試。";
  } catch (e) {
    message = (e as Error).message;
  }
  for (const key of [
    env.OPENAI_API_KEY,
    env.ANTHROPIC_API_KEY,
    env.COMPATIBLE_API_KEY,
  ])
    if (key) message = message.replaceAll(key, "[redacted]");
  return connections.verified(
    id,
    {
      engine,
      model: env.PI_MODEL!,
      at: new Date().toISOString(),
      ok,
      streaming,
      tools: called,
      message: message.slice(0, 1000),
    },
    fingerprint,
  );
}
