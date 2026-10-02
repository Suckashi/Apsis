import type { RouteDependencies, RequestContext } from "./contracts.ts";
import { fail, reply } from "../product-support.ts";
import { transitionJob } from "../task-lifecycle.ts";
import { z } from "zod";
const start = z
  .object({
    requestId: z.string().min(1).max(100),
    prompt: z.string().min(1).max(16000),
  })
  .strict();
const control = z
  .object({
    sessionId: z.string(),
    runId: z.string().optional(),
    prompt: z.string().min(1).max(16000).optional(),
    requestId: z.string().max(100).optional(),
  })
  .strict();
export class AssistantRoutes {
  private readonly deps: RouteDependencies;
  constructor(deps: RouteDependencies) {
    this.deps = deps;
  }
  async handle({ path, method, req, res, body }: RequestContext) {
    if (path === "/work" && method === "POST") {
      await this.deps.bootstrap();
      const parsed = start.safeParse(await body(req));
      if (!parsed.success) fail("Invalid background work request", 400);
      const bot = this.deps.db.bots.list()[0];
      reply(
        res,
        await this.deps.submit(bot.id, {
          ...parsed.data!,
          contextKind: "routine",
        }),
        202,
      );
      return true;
    }
    const match = path.match(/^\/work\/([^/]+)(?:\/(stop|steer))?$/);
    if (!match) return false;
    const job = this.deps.db.jobs.get(match[1]) || fail("Work not found", 404);
    if (method === "GET" && !match[2]) {
      reply(res, {
        job,
        session: this.deps.tasks.view(job.sessionId!),
        run: job.runId ? this.deps.runRecord(job.botId, job.runId) : undefined,
      });
      return true;
    }
    if (method !== "POST" || !match[2]) return false;
    const parsed = control.safeParse(await body(req));
    if (!parsed.success) fail("Invalid work control", 400);
    const input = parsed.data!;
    if (
      input.sessionId !== job.sessionId ||
      input.runId !== job.runId ||
      !["running", "queued"].includes(job.status)
    )
      fail("Work changed; reload before controlling it", 409);
    if (match[2] === "stop") {
      this.deps.execution.jobControllers.get(job.id)?.abort();
      if (job.runId) this.deps.tasks.stop(job.sessionId!);
      if (job.status === "queued")
        this.deps.db.jobs.put(transitionJob(job, "cancelled"));
      this.deps.notify(job.botId, job.id);
      reply(res, { ok: true });
    } else {
      if (!input.prompt) fail("Steering needs a prompt", 400);
      reply(
        res,
        await this.deps.steerMessage(job.botId, { ...input, jobId: job.id }),
      );
    }
    return true;
  }
}
