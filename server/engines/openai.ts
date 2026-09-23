import {
  Agent,
  Runner,
  OpenAIProvider,
  tool,
  type AgentInputItem,
} from "@openai/agents";
import { agentContext } from "../context.ts";
import { createTools } from "../tools.ts";
import type { RunOptions } from "../runtime.ts";
import { connection, executeTool, toolSchema } from "./common.ts";

export async function runOpenAI(options: RunOptions) {
  const config = connection(options);
  if (config.provider === "anthropic")
    throw new Error(
      "此引擎尚未提供 Anthropic 原生連線，請使用 Pi 或 Deep Agents。",
    );
  const provider = new OpenAIProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    useResponses: config.provider === "openai",
  });
  const runner = new Runner({ modelProvider: provider, tracingDisabled: true });
  const agent = new Agent({
    name: options.agent?.name || "Talaria",
    instructions: agentContext(
      options.store,
      options.allowWrites,
      options.agent,
      options.prompt,
      options.permissions,
    ),
    model: config.model,
    modelSettings: {
      maxTokens: 4096,
      parallelToolCalls: false,
      ...(config.provider === "ollama"
        ? { providerData: { reasoning_effort: "none" } }
        : {}),
    },
    tools: createTools(options).map((t) =>
      tool({
        name: t.name,
        description: t.description,
        parameters: toolSchema(t),
        execute: (args) => executeTool(t, args, options),
      }),
    ),
  });
  const history =
    (options.session.engineState as { history: AgentInputItem[] } | undefined)
      ?.history || [];
  try {
    const result = await runner.run(
      agent,
      [...history, { role: "user", content: options.prompt }],
      { stream: true, signal: options.signal, maxTurns: 12 },
    );
    let text = "";
    for await (const delta of result.toTextStream()) {
      text += delta;
      options.emit({ type: "delta", text: delta });
    }
    await result.completed;
    options.signal.throwIfAborted();
    if (!text) {
      text = result.finalOutput || "工具操作已完成。";
      options.emit({ type: "delta", text });
    }
    return {
      text,
      usage: {
        inputTokens: result.state.usage.inputTokens,
        outputTokens: result.state.usage.outputTokens,
      },
      engineState: { history: result.history },
    };
  } finally {
    await provider.close();
  }
}
