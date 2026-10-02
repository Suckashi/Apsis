import { z } from "zod";
const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
});
export const runSchema = z
  .object({
    project: projectSchema.optional(),
    recoveryRunIds: z.array(z.string()).optional(),
    id: z.string().uuid(),
    sessionId: z.string(),
    engine: z.literal("deepagents"),
    agentName: z.string(),
    model: z.string(),
    permissions: z.object({
      shell: z.boolean().optional(),
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
    timeline: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("subagent"),
            id: z.string(),
            at: z.string(),
            activity: z.object({
              id: z.string(),
              name: z.string().optional(),
              task: z.string(),
              status: z.enum(["running", "completed", "failed", "cancelled"]),
              progress: z.string().optional(),
              resultSummary: z.string().optional(),
              startedAt: z.string(),
              endedAt: z.string().optional(),
            }),
          }),
          z.object({
            kind: z.literal("planning"),
            id: z.string(),
            at: z.string(),
            subagentId: z.string().optional(),
            todos: z.array(
              z.object({
                content: z.string(),
                status: z.enum(["pending", "in_progress", "completed"]),
              }),
            ),
          }),
          z.object({
            kind: z.literal("commentary"),
            id: z.string(),
            at: z.string(),
            text: z.string(),
          }),
          z.object({
            kind: z.literal("operation"),
            id: z.string(),
            at: z.string(),
            operationId: z.string(),
          }),
        ]),
      )
      .optional(),
    progress: z
      .object({
        kind: z.enum(["message", "reply"]),
        text: z.string().optional(),
        updatedAt: z.string(),
      })
      .optional(),
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
          evidence: z
            .object({
              command: z.string().optional(),
              output: z.string().optional(),
              patch: z.string().optional(),
              exitCode: z.number().nullable().optional(),
              truncated: z.boolean().optional(),
            })
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const knowledge = z
  .object({
    id: z.string(),
    content: z.string(),
    agentId: z.string().optional(),
    scopeKey: z.string().optional(),
    enabled: z.boolean().optional(),
    revisions: z
      .array(z.object({ content: z.string(), at: z.string() }))
      .optional(),
  })
  .passthrough();
export const storageSchema = z.strictObject({
  schemaVersion: z.literal(5),
  projects: z.array(projectSchema),
  memories: z.array(knowledge),
  skills: z.array(knowledge.extend({ name: z.string(), agentId: z.string() })),
});
export const sessionSchema = z.strictObject({
  id: z.string(),
  botId: z.string().optional(),
  title: z.string(),
  createdAt: z.string(),
  workContextId: z.string().optional(),
  project: projectSchema.optional(),
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
  engineState: z.unknown().optional(),
});
