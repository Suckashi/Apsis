import {
  parseRequest,
  steerSchema,
  botMemorySchema,
} from "../request-schema.ts";
import { visibleMemory, memoryOwner, changeMemory } from "../memory.ts";

import { fail, reply } from "../product-support.ts";
import { transitionJob } from "../task-lifecycle.ts";

import type { RouteDependencies, BotRequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  | "db"
  | "detail"
  | "execution"
  | "memoryScope"
  | "newContext"
  | "notify"
  | "receiveMessage"
  | "remove"
  | "runRecord"
  | "steerMessage"
  | "tasks"
  | "update"
  | "workLocation"
>;
export class BotConversationRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: BotRequestContext): Promise<boolean> {
    const { req, res, url, path, method, body, id, action, bot } = context;
    if (!action && method === "DELETE") {
      await this.deps.remove(id);
      reply(res, { ok: true });
      return true;
    }
    if (!action && method === "GET") {
      reply(
        res,
        this.deps.detail(id, url.searchParams.get("view") !== "summary"),
      );
      return true;
    }
    if (action === "memories" && method === "GET") {
      reply(res, this.deps.detail(id, false).memories);
      return true;
    }
    if (action === "memories" && method === "POST") {
      const input = parseRequest(botMemorySchema, await body(req));
      const memory = await this.deps.tasks.store.mutate((state) => {
        if (
          input.workContextId !== undefined &&
          input.workContextId !==
            this.deps.tasks.store.conversations.activeId(bot.sessionId)
        )
          fail("目前話題已變更，請重新載入。", 409);
        const key = this.deps.workLocation(bot).memoryKey;
        const existing = input.id
          ? state.memories.find(
              (m) =>
                m.id === input.id &&
                visibleMemory(m, this.deps.memoryScope(bot), key),
            )
          : undefined;
        if (input.id && !existing) fail("找不到記憶。", 404);
        const target = input.scopeKey === "global" ? "global" : key;
        if (existing) {
          if (input.revision !== (existing.revision ?? 1))
            fail("記憶已變更，請重新載入。", 409);
          existing.scopeKey = target;
          existing.agentId = memoryOwner(this.deps.memoryScope(bot), target);
        }
        return changeMemory(
          state,
          this.deps.memoryScope(bot),
          input,
          { kind: "manual" },
          target,
        );
      });
      this.deps.notify(id);
      reply(res, memory);
      return true;
    }
    const history = this.deps.tasks.store.conversations;
    const cursorValue = url.searchParams.get("before");
    const cursor = cursorValue ? Number(cursorValue) : undefined;
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
      fail("無效的分頁游標。", 400);
    if (action === "history" && method === "GET") {
      reply(
        res,
        history.page(
          bot.sessionId,
          cursor,
          50,
          url.searchParams.get("context") || undefined,
        ),
      );
      return true;
    }
    if (action === "history/search" && method === "GET") {
      reply(
        res,
        history.search(
          url.searchParams.get("q") || "",
          [bot.sessionId],
          cursor,
        ),
      );
      return true;
    }
    if (action === "history/message" && method === "GET") {
      reply(
        res,
        history.fullMessage(
          [bot.sessionId],
          Number(url.searchParams.get("sequence")),
        ),
      );
      return true;
    }
    if (action === "history/around" && method === "GET") {
      reply(
        res,
        history.around(
          [bot.sessionId],
          Number(url.searchParams.get("sequence")),
        ),
      );
      return true;
    }
    if (action === "contexts" && method === "GET") {
      reply(
        res,
        history.contexts(
          bot.sessionId,
          url.searchParams.get("beforeId") || undefined,
        ),
      );
      return true;
    }
    if (action === "contexts" && method === "POST") {
      reply(res, this.deps.newContext(id), 201);
      return true;
    }
    if (action === "context" && method === "GET") {
      reply(res, {
        context: history.context(bot.sessionId),
        compactions: history.compactions(bot.sessionId),
      });
      return true;
    }
    const runMatch = action.match(/^runs\/([^/]+)$/);
    if (runMatch && method === "GET") {
      reply(res, this.deps.runRecord(id, runMatch[1]));
      return true;
    }
    if (!action && method === "PATCH") {
      reply(res, await this.deps.update(id, await body(req)));
      return true;
    }
    if (action === "messages" && method === "POST") {
      reply(res, await this.deps.receiveMessage(id, await body(req)), 202);
      return true;
    }
    const dismiss = action.match(/^jobs\/([^/]+)\/dismiss$/);
    if (dismiss && method === "POST") {
      const job = this.deps.db.jobs.get(dismiss[1]);
      if (!job || job.botId !== id) fail("找不到任務。", 404);
      if (
        job!.status !== "interrupted" &&
        !(job!.status === "failed" && !job!.runId)
      )
        fail("這項任務沒有可關閉的提示。", 409);
      if (!job!.dismissedAt) {
        this.deps.db.jobs.put({
          ...job!,
          dismissedAt: new Date().toISOString(),
        });
        this.deps.notify(id);
      }
      reply(res, { ok: true });
      return true;
    }
    if (action === "steer" && method === "POST") {
      const message = await this.deps.steerMessage(
        id,
        parseRequest(steerSchema, await body(req)),
      );
      reply(res, {
        ok: true,
        messageId: message.id,
        delivery: message.delivery,
      });
      return true;
    }
    if (action === "stop" && method === "POST") {
      this.deps.tasks.stop(bot.sessionId);
      for (const job of this.deps.db.jobs.list({ botId: id }))
        this.deps.execution.jobControllers.get(job.id)?.abort();
      for (const job of this.deps.db.jobs.list({ botId: id, status: "queued" }))
        this.deps.db.jobs.put(transitionJob(job, "cancelled"));
      this.deps.notify(id);
      reply(res, { ok: true });
      return true;
    }
    return false;
  }
}
