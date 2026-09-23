import { randomUUID } from "node:crypto";
import type { AgentDefinition, StoreState } from "../shared/types.ts";
import { agentTools, engineLabels } from "../shared/agents.ts";
import { ollamaModelName } from "./ollama.ts";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
export function parseAgent(
  input: Record<string, unknown>,
  state: StoreState,
  previous?: AgentDefinition,
): AgentDefinition {
  const text = (key: string, max: number, required = true) => {
    const value = input[key];
    if (
      typeof value !== "string" ||
      value.length > max ||
      (required && !value.trim())
    )
      invalid(`${key} 格式或長度不符。`);
    return value.trim();
  };
  const name = text("name", 80);
  const description = text("description", 300, false);
  const instructions = text("instructions", 12000);
  const model = text("model", 200);
  const engine = input.engine as AgentDefinition["engine"];
  const provider = input.provider as AgentDefinition["provider"];
  const memoryScope = input.memoryScope as AgentDefinition["memoryScope"];
  if (!Object.hasOwn(engineLabels, engine)) invalid("未知執行引擎。");
  if (
    !["openai", "anthropic", "ollama", "openai-compatible"].includes(provider)
  )
    invalid("未知模型供應商。");
  if (provider === "ollama") ollamaModelName(model);
  if (engine === "openai-agents" && provider === "anthropic")
    invalid(
      "此引擎目前支援 OpenAI、Ollama 與 OpenAI 相容端點。Anthropic 請使用 Pi 或 Deep Agents。",
    );
  if (!["private", "shared"].includes(memoryScope)) invalid("未知記憶範圍。");
  // A stable namespace prevents an edit from exposing previously private facts.
  if (previous && previous.memoryScope !== memoryScope)
    invalid("既有 agent 的記憶範圍不能更改；請建立新的 agent。");
  const list = (key: string, allowed: string[]) => {
    const value = input[key];
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some((v) => typeof v !== "string" || !allowed.includes(v))
    )
      invalid(`${key} 含有無效項目。`);
    return [...new Set(value as string[])];
  };
  return {
    id: previous?.id || randomUUID(),
    name,
    description,
    instructions,
    engine,
    provider,
    model,
    memoryScope,
    tools: list("tools", Object.keys(agentTools)),
    skillIds: list(
      "skillIds",
      state.skills
        .filter((s) => !s.agentId || s.agentId === previous?.id)
        .map((s) => s.id),
    ),
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export function scopedState(
  state: StoreState,
  agent?: AgentDefinition,
): StoreState {
  const scope = agent?.memoryScope === "private" ? agent.id : undefined;
  return {
    ...state,
    memories: state.memories.filter((m) => m.agentId === scope),
    skills: state.skills.filter((s) =>
      agent
        ? s.agentId === agent.id ||
          (!s.agentId && agent.skillIds.includes(s.id))
        : !s.agentId,
    ),
    sessions: state.sessions.filter((s) =>
      scope
        ? s.agent?.id === scope
        : !s.agent || s.agent.memoryScope === "shared",
    ),
  };
}
