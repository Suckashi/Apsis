import { z } from "zod";
import { validatePermissionRules } from "./settings-validation.ts";
import { SETTINGS_BOUNDS } from "../shared/settings.ts";
import type {
  BotCreateRequest,
  BotUpdateRequest,
  TemplateRequest,
  RoutineRequest,
} from "../shared/api.ts";

const id = z.string().trim().min(1).max(100);
const text = (max: number) => z.string().trim().min(1).max(max);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const permissionRules = z.array(z.unknown()).transform(validatePermissionRules);
const profile = {
  name: text(80).optional(),
  description: z.string().max(4000).optional(),
  avatar: id.optional(),
  connectionId: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  connectorIds: z.array(id).max(1000).optional(),
  permissionMode: z.enum(["workspace", "readonly"]).optional(),
  permissionRules: permissionRules.optional(),
};
export const botCreateSchema = z.strictObject({
  ...profile,
  templateId: id.optional(),
}) satisfies z.ZodType<BotCreateRequest>;
export const botUpdateSchema = z.strictObject({
  ...profile,
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  read: z.boolean().optional(),
}) satisfies z.ZodType<BotUpdateRequest>;
export const templateSchema = z.strictObject({
  ...profile,
  name: text(80),
}) satisfies z.ZodType<TemplateRequest>;
export const routineSchema = z.strictObject({
  name: text(100),
  prompt: text(16000),
  cron: text(100),
  timezone: text(80).optional(),
  enabled: z.boolean().optional(),
  projectId: z.string().max(100).optional(),
  branch: z.string().max(200).optional(),
}) satisfies z.ZodType<RoutineRequest>;
export const routinePatchSchema = routineSchema.partial();
export const memorySchema = z.strictObject({
  id: id.optional(),
  content: text(4000).optional(),
  tier: z.enum(["core", "reference"]).optional(),
  enabled: z.boolean().optional(),
  locked: z.boolean().optional(),
  revision: z.number().int().positive().optional(),
  mergeIds: z.array(id).optional(),
  mergeRevisions: z.record(z.string(), z.number().int().positive()).optional(),
});
export const botMemorySchema = memorySchema.extend({
  workContextId: id.optional(),
  scopeKey: z.enum(["global", "current"]).optional(),
});
export const approvalSchema = z.strictObject({
  approved: z.boolean(),
  remember: z.boolean().optional(),
});
export const projectSchema = z.strictObject({
  name: text(100),
  path: z.string().max(4096).optional(),
  description: z.string().max(4000).optional(),
});
export const projectPatchSchema = projectSchema.omit({ path: true }).partial();
export const workLocationSchema = z
  .strictObject({
    contextId: id,
    projectId: id.optional(),
    path: text(4096).optional(),
    name: text(100).optional(),
    worktree: z.boolean().optional(),
    branch: z.string().max(200).optional(),
    dirty: z.enum(["exclude", "include"]).optional(),
  })
  .refine((input) => Boolean(input.projectId) !== Boolean(input.path), {
    message: "請指定專案或資料夾。",
  });
export const connectorSchema = z.strictObject({
  name: text(100),
  url: text(2000),
  token: z.string().optional(),
});
export const draftSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("discard") }),
  z.strictObject({ action: z.literal("send"), arguments: text(32000) }),
]);
export const permissionPreviewSchema = z.strictObject({
  botId: id,
  tool: text(200),
  args: z.record(z.string(), z.unknown()),
  runId: id.optional(),
});
export const drawSchema = z.strictObject({ requestId: id });
export const takeoverSchema = z.strictObject({ take: z.boolean() });
export const artifactReferenceSchema = z.strictObject({
  contextId: id,
  artifactId: id,
});
export const skillSchema = z.strictObject({
  name: text(100),
  content: text(12000),
});
export const ollamaDiscoverySchema = z.strictObject({ url: text(2000) });
export const compatibleDiscoverySchema = z.strictObject({
  url: text(2000),
  apiKey: z.string().max(4096).optional(),
  connectionId: id.optional(),
});
export const connectionSchema = z.strictObject({
  name: text(100),
  provider: z.enum(["openai", "anthropic", "ollama", "openai-compatible"]),
  model: text(200),
  models: z.array(text(200)).min(1).max(1000).optional(),
  url: z.string().max(2000).optional(),
  vendor: z.string().max(100).optional(),
  apiKey: z.string().max(4096).nullable().optional(),
  configRevision: revision.optional(),
  modelSettings: z
    .record(
      z.string(),
      z.strictObject({
        displayName: text(100).optional(),
        maxOutputTokens: z.number().int().positive().optional(),
        contextWindowTokens: z.number().int().positive().optional(),
      }),
    )
    .optional(),
});
export const defaultConnectionSchema = z.strictObject({
  connectionId: id,
  model: text(200).optional(),
});
export const connectionTestSchema = z.strictObject({
  model: text(200).optional(),
});
export const fileContentSchema = z.strictObject({
  path: text(4096),
  content: z.string(),
  revision: revision.nullable(),
});
export const filePathSchema = z.strictObject({ path: text(4096) });
export const fileMoveSchema = z.strictObject({
  path: text(4096),
  to: text(4096),
  revision: revision.optional(),
});
export const fileRestoreSchema = z.strictObject({
  id,
  path: text(4096).optional(),
});
export const fileRequestSchemas: Record<
  string,
  z.ZodType<Record<string, unknown>>
> = {
  "PUT:content": fileContentSchema,
  "POST:directory": filePathSchema,
  "POST:move": fileMoveSchema,
  "POST:trash": filePathSchema,
  "POST:restore": fileRestoreSchema,
};
export const steerSchema = z.strictObject({
  requestId: id,
  prompt: text(16000),
  workContextId: id.optional(),
});
export const settingsSchema = z.strictObject({
  revision,
  approvalMode: z.enum(["manual", "yolo", "auto"]).optional(),
  dangerousCommandGuard: z.boolean().optional(),
  locale: z.enum(["zh-Hant", "en"]).optional(),
  permissionRules: permissionRules.optional(),
  ...Object.fromEntries(
    Object.entries(SETTINGS_BOUNDS).map(([key, [min, max]]) => [
      key,
      z.number().int().min(min).max(max).optional(),
    ]),
  ),
});

export function parseRequest<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw Object.assign(
      new Error(
        "請求格式錯誤：" +
          result.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
            )
            .join("; "),
      ),
      { status: 400 },
    );
  return result.data;
}
