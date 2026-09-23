import { z } from "zod";
export const runSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string(),
    engine: z.enum(["demo", "pi", "deepagents", "openai-agents"]),
    agentName: z.string(),
    model: z.string(),
    permissions: z.object({
      files: z.boolean(),
      memory: z.boolean(),
      skills: z.boolean(),
    }),
    status: z.enum([
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    createdAt: z.string(),
    text: z.string(),
    activity: z.array(z.string()),
    operations: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          status: z.enum(["started", "succeeded", "failed", "unknown"]),
          startedAt: z.string(),
          mutating: z.boolean(),
          target: z.string().optional(),
          error: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const connectionsSchema = z.array(
  z
    .object({
      id: z.union([
        z.string().uuid(),
        z.enum([
          "legacy-openai",
          "legacy-anthropic",
          "legacy-ollama",
          "legacy-openai-compatible",
        ]),
      ]),
      name: z.string(),
      provider: z.enum(["openai", "anthropic", "ollama", "openai-compatible"]),
      model: z.string(),
      models: z.array(z.string()).optional(),
      vendor: z
        .enum([
          "ollama",
          "openai",
          "anthropic",
          "kimi",
          "deepseek",
          "openrouter",
          "qwen",
          "custom",
        ])
        .optional(),
      url: z.string().optional(),
      apiKey: z.string().optional(),
      archived: z.boolean().optional(),
    })
    .passthrough(),
);
const knowledge = z
  .object({
    id: z.string(),
    content: z.string(),
    agentId: z.string().optional(),
    enabled: z.boolean().optional(),
    revisions: z
      .array(z.object({ content: z.string(), at: z.string() }))
      .optional(),
  })
  .passthrough();
export const storageSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    sessions: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          mode: z.enum(["pi", "demo", "hermes", "hybrid"]),
          connectionId: z.string().optional(),
          provider: z
            .enum(["openai", "anthropic", "ollama", "openai-compatible"])
            .optional(),
          model: z.string().optional(),
          createdAt: z.string(),
          messages: z.array(
            z
              .object({
                id: z.string(),
                role: z.enum(["user", "assistant"]),
                content: z.string(),
                status: z.enum(["pending", "complete", "failed", "error"]),
              })
              .passthrough(),
          ),
          piMessages: z.array(z.unknown()),
          runtimeState: z
            .object({
              engine: z.enum(["pi", "deepagents", "openai-agents"]),
              version: z.literal(1),
              data: z.unknown(),
            })
            .optional(),
        })
        .passthrough(),
    ),
    memories: z.array(knowledge),
    skills: z.array(knowledge.extend({ name: z.string() })),
    agents: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            instructions: z.string(),
            engine: z.enum(["pi", "deepagents", "openai-agents"]),
            provider: z.enum([
              "openai",
              "anthropic",
              "ollama",
              "openai-compatible",
            ]),
            model: z.string(),
            tools: z.array(z.string()),
            skillIds: z.array(z.string()),
            memoryScope: z.enum(["private", "shared"]),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
