import { z } from "zod";
import type { SendMessageRequest } from "../shared/api.ts";

const id = z.string().trim().min(1).max(100);
const schema = z.strictObject({
  requestId: id,
  prompt: z.string().trim().min(1).max(16000),
  workContextId: id.optional(),
  replyTo: id.optional(),
  retryOf: id.optional(),
  fileReferences: z
    .array(
      z.strictObject({
        locationId: id,
        path: z.string().min(1).max(4096),
        revision: z.string().min(1).max(200),
      }),
    )
    .optional(),
  artifactIds: z.array(id).optional(),
}) satisfies z.ZodType<SendMessageRequest>;

export function parseMessage(input: unknown): SendMessageRequest {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw Object.assign(
      new Error(
        "訊息格式錯誤：" +
          parsed.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
            )
            .join("; "),
      ),
      { status: 400 },
    );
  return parsed.data;
}
