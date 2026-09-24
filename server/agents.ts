import type { AgentDefinition, StoreState } from "../shared/types.ts";
export function scopedState(
  state: StoreState,
  agent?: AgentDefinition,
): StoreState {
  const scope = agent?.memoryScope === "private" ? agent.id : undefined;
  return {
    ...state,
    memories: state.memories.filter(
      (m) => m.agentId === scope && m.enabled !== false && !m.mergedInto,
    ),
    skills: state.skills.filter(
      (s) =>
        s.enabled !== false &&
        !s.mergedInto &&
        (agent
          ? s.agentId === agent.id ||
            (!s.agentId && agent.skillIds.includes(s.id))
          : !s.agentId),
    ),
    sessions: state.sessions.filter((s) =>
      scope
        ? s.agent?.id === scope
        : !s.agent || s.agent.memoryScope === "shared",
    ),
  };
}
