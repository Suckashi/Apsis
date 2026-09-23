import type { EngineAdapter } from "../runtime.ts";
export const engines: Record<EngineAdapter["id"], EngineAdapter> = {
  pi: {
    id: "pi",
    run: async (options) => (await import("../agent.ts")).runPi(options),
  },
  deepagents: {
    id: "deepagents",
    run: async (options) => (await import("./deep.ts")).runDeep(options),
  },
  "openai-agents": {
    id: "openai-agents",
    run: async (options) => (await import("./openai.ts")).runOpenAI(options),
  },
};
