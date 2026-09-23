import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { configuration, type RunOptions } from "../agent.ts";
import { defaultOllamaUrl } from "../ollama.ts";

export function connection(options: RunOptions) {
  const env = options.env || {};
  const config = configuration(env);
  if (!config.piReady)
    throw new Error("請先到 Bot 設定完成此 agent 使用的模型連線。");
  return {
    ...config,
    apiKey:
      config.provider === "ollama"
        ? "ollama"
        : config.provider === "openai-compatible"
          ? env.COMPATIBLE_API_KEY || "not-required"
          : config.provider === "anthropic"
            ? env.ANTHROPIC_API_KEY
            : env.OPENAI_API_KEY,
    baseURL:
      config.provider === "ollama"
        ? (env.OLLAMA_URL || defaultOllamaUrl).replace(/\/$/, "") + "/v1"
        : config.provider === "openai-compatible"
          ? env.COMPATIBLE_BASE_URL
          : undefined,
  };
}
export function toolSchema(tool: AgentTool) {
  const properties =
    (tool.parameters as { properties?: Record<string, unknown> }).properties ||
    {};
  return z
    .object(
      Object.fromEntries(
        Object.keys(properties).map((key) => [key, z.string()]),
      ),
    )
    .strict();
}
export async function executeTool(
  tool: AgentTool,
  args: Record<string, string>,
  options: RunOptions,
) {
  options.signal.throwIfAborted();
  options.emit({
    type: "activity",
    tool: tool.name,
    text: `執行 ${tool.name}`,
  });
  try {
    const result = await tool.execute(randomUUID(), args, options.signal);
    options.emit({
      type: "activity",
      tool: tool.name,
      text: `${tool.name} 完成`,
    });
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  } catch (error) {
    options.signal.throwIfAborted();
    options.emit({
      type: "activity",
      tool: tool.name,
      text: `${tool.name} 失敗`,
    });
    throw error;
  }
}
