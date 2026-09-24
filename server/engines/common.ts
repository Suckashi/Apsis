import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "../tools.ts";
import type { RunOptions } from "../runtime.ts";
import { defaultOllamaUrl } from "../ollama.ts";

export function connection(options: RunOptions) {
  const env = options.env || {};
  const provider = env.MODEL_PROVIDER;
  const model = env.MODEL_ID;
  if (!provider || !model) throw new Error("請先到 Bot 設定完成模型連線。");
  if (
    !["openai", "anthropic", "ollama", "openai-compatible"].includes(provider)
  )
    throw new Error("模型供應商不受支援。");
  return {
    provider,
    model,
    apiKey:
      provider === "ollama"
        ? "ollama"
        : provider === "openai-compatible"
          ? env.COMPATIBLE_API_KEY || "not-required"
          : provider === "anthropic"
            ? env.ANTHROPIC_API_KEY
            : env.OPENAI_API_KEY,
    baseURL:
      provider === "ollama"
        ? (env.OLLAMA_URL || defaultOllamaUrl).replace(/\/$/, "") + "/v1"
        : provider === "openai-compatible"
          ? env.COMPATIBLE_BASE_URL
          : undefined,
  };
}
export function toolSchema(tool: AgentTool) {
  const convert = (schema: Record<string, any>): z.ZodTypeAny => {
    if (schema.type === "string") return z.string();
    if (schema.type === "number" || schema.type === "integer")
      return z.number();
    if (schema.type === "boolean") return z.boolean();
    if (schema.type === "array") return z.array(convert(schema.items || {}));
    if (schema.type === "object") {
      const required = new Set<string>(schema.required || []);
      const fields = Object.fromEntries(
        Object.entries(schema.properties || {}).map(([name, child]) => {
          const value = convert(child as Record<string, any>);
          return [name, required.has(name) ? value : value.optional()];
        }),
      );
      const shape = z.object(fields);
      return schema.additionalProperties === false ? shape.strict() : shape;
    }
    return z.unknown();
  };
  return convert(tool.parameters as Record<string, any>);
}
export async function executeTool(
  tool: AgentTool,
  args: Record<string, unknown>,
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
