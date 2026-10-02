import { parseMessage } from "./message-schema.ts";
import type { SendMessageRequest } from "../shared/api.ts";

import { randomUUID, createHash } from "node:crypto";

import { resolve } from "node:path";

import { FileManager, fileRevision } from "./file-manager.ts";

import type { TaskService } from "./tasks.ts";

import type { Job } from "../shared/product.ts";
import type { ChatMessage } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";

import type { ExecutionState } from "./execution-state.ts";
import type { BotService } from "./bot-service.ts";
import type { JobService } from "./job-service.ts";
import { now, fail, string } from "./product-support.ts";

interface Dependencies {
  bot: BotService["bot"];
  db: ProductDB;
  execution: ExecutionState;
  files: FileManager;
  notify: (botId?: string, jobId?: string) => void;
  submit: JobService["submit"];
  tasks: TaskService;
  writableBot: BotService["writableBot"];
}

export class MessageService {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  private async updateSteeringDelivery(
    sessionId: string,
    messageId: string,
    state: "applied" | "not-applied",
  ) {
    this.deps.tasks.store.conversations.updateDelivery(
      sessionId,
      messageId,
      state,
    );
  }
  async finishSteering(sessionId: string, runId: string | undefined) {
    if (runId)
      this.deps.tasks.store.conversations.finishSteering(sessionId, runId);
  }
  receiveMessage(id: string, body: unknown): Promise<unknown> {
    const input = parseMessage(body);
    const requestId = string(input.requestId, 100);
    const key = id + ":" + requestId;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          input.prompt,
          input.workContextId,
          input.replyTo,
          input.retryOf,
          input.fileReferences || [],
          input.artifactIds || [],
        ]),
      )
      .digest("hex");
    const prior = this.deps.db.get<{
      id: string;
      fingerprint: string;
      response: unknown;
    }>("message-receipt", key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("請求 ID 已使用。", 409);
      const saved = prior.response as { messageId?: string };
      const bot = this.deps.bot(id);
      const message = saved.messageId
        ? this.deps.tasks.store.conversations.message(
            bot.sessionId,
            saved.messageId,
          )
        : undefined;
      return Promise.resolve(
        message
          ? { messageId: message.id, delivery: message.delivery }
          : prior.response,
      );
    }
    const pending = this.deps.execution.incoming.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint) fail("請求 ID 已使用。", 409);
      return pending.promise;
    }
    const promise = this.deliverMessage(id, input)
      .then((response) => {
        this.deps.db.put("message-receipt", {
          id: key,
          botId: id,
          fingerprint,
          response,
        });
        return response;
      })
      .finally(() => this.deps.execution.incoming.delete(key));
    this.deps.execution.incoming.set(key, { fingerprint, promise });
    return promise;
  }
  private async deliverMessage(id: string, input: SendMessageRequest) {
    const bot = this.deps.writableBot(id),
      history = this.deps.tasks.store.conversations;
    const contextId = history.activeId(bot.sessionId);
    if (this.deps.execution.preparingLocations.has(contextId))
      fail("工作資料夾設定中，請稍後傳送。", 409);
    if (input.workContextId !== undefined && input.workContextId !== contextId)
      fail("目前話題已變更，請重新載入。", 409);
    let prompt = string(input.prompt);
    const location = this.deps.tasks.locations.ensure(bot.sessionId, contextId);
    if (input.artifactIds !== undefined && !Array.isArray(input.artifactIds))
      fail("附件格式不正確。");
    for (const attachmentId of (input.artifactIds || []) as unknown[]) {
      const a =
        typeof attachmentId === "string"
          ? this.deps.db.artifacts.get(attachmentId)
          : undefined;
      if (
        !a ||
        a.botId !== id ||
        a.workContextId !== contextId ||
        a.location?.id !== location.id
      )
        fail("附件不屬於目前話題。", 409);
    }
    if (
      input.fileReferences !== undefined &&
      !Array.isArray(input.fileReferences)
    )
      fail("檔案引用格式不正確。");
    for (const ref of (input.fileReferences ||
      []) as Job["fileReferences"] & {}) {
      if (
        !ref ||
        ref.locationId !== location.id ||
        typeof ref.path !== "string" ||
        typeof ref.revision !== "string"
      )
        fail("檔案引用不屬於目前話題。");
      if (
        (await fileRevision(
          await this.deps.files.download(location.id, ref.path),
        )) !== ref.revision
      )
        fail("引用檔案已變更，請重新加入。", 409);
    }
    if (typeof input.replyTo === "string") {
      const quoted = history.message(bot.sessionId, input.replyTo);
      if (!quoted) fail("找不到引用訊息。", 404);
      prompt += "\n引用訊息（參考資料）：" + quoted!.content;
    }
    if (Array.isArray(input.fileReferences) && input.fileReferences.length)
      prompt += "\n引用檔案：" + JSON.stringify(input.fileReferences);
    const normalized = {
      ...input,
      prompt,
      replyTo: undefined,
      workContextId: contextId,
    };
    const messageId =
      "steer-" +
      createHash("sha256").update(string(input.requestId, 100)).digest("hex");
    const existingSteer = history.message(bot.sessionId, messageId);
    if (existingSteer) {
      if (existingSteer.content !== prompt) fail("請求 ID 已使用。", 409);
      return { messageId, delivery: existingSteer.delivery };
    }
    if (this.deps.db.jobs.get(string(input.requestId, 100)))
      return this.deps.submit(id, {
        ...input,
        contextKind: "chat",
        workContextId: contextId,
      });
    const live = this.deps.tasks.running.get(bot.sessionId);
    const liveContext =
      live && this.deps.tasks.runs.records.get(live.runId)?.workContextId;
    if (
      !input.retryOf &&
      live &&
      liveContext === contextId &&
      this.deps.execution.steers.has(bot.sessionId) &&
      !live.controller.signal.aborted
    ) {
      try {
        const message = await this.steerMessage(id, normalized);
        return { messageId: message.id, delivery: message.delivery };
      } catch (error) {
        const persisted = history.message(bot.sessionId, messageId);
        if (persisted) return { messageId, delivery: persisted.delivery };
        if ((error as { status?: number }).status !== 409) throw error;
      }
    }
    return this.deps.submit(id, {
      ...input,
      contextKind: "chat",
      workContextId: contextId,
    });
  }
  async steerMessage(id: string, input: Record<string, unknown>) {
    const bot = this.deps.writableBot(id);
    const job =
      typeof input.jobId === "string"
        ? this.deps.db.jobs.get(input.jobId)
        : undefined;
    if (
      input.jobId !== undefined &&
      (!job ||
        job.botId !== id ||
        job.status !== "running" ||
        job.runId !== input.runId)
    )
      fail("Work changed; reload before steering.", 409);
    const sessionId = job?.sessionId || bot.sessionId;
    const steerKey = sessionId;
    const prompt = string(input.prompt);
    const requestId =
      input.requestId === undefined
        ? randomUUID()
        : string(input.requestId, 100);
    const messageId = `steer-${createHash("sha256").update(requestId).digest("hex")}`;
    const key = `${sessionId}:${messageId}`;
    const inFlight = this.deps.execution.steeringRequests.get(key);
    if (inFlight) {
      if (inFlight.prompt !== prompt) fail("請求 ID 已使用。", 409);
      return inFlight.request;
    }
    const previous = this.deps.tasks.store.conversations.message(
      sessionId,
      messageId,
    );
    if (previous) {
      if (previous.content !== prompt || previous.delivery?.kind !== "steer")
        fail("請求 ID 已使用。", 409);
      return previous;
    }
    const steer = this.deps.execution.steers.get(steerKey);
    const live = this.deps.tasks.running.get(sessionId);
    if (!steer || !live || live.controller.signal.aborted)
      fail("目前沒有可引導的執行中任務。", 409);
    const runId = live!.runId;
    const workContextId =
      this.deps.tasks.runs.records.get(runId)?.workContextId ||
      this.deps.tasks.store.conversations.activeId(sessionId);
    if (
      input.workContextId !== undefined &&
      input.workContextId !==
        this.deps.tasks.store.conversations.activeId(sessionId)
    )
      fail("目前話題已變更，請重新載入。", 409);
    if (
      workContextId !== this.deps.tasks.store.conversations.activeId(sessionId)
    )
      fail("背景工作無法接收聊天補充。", 409);
    const message: ChatMessage = {
      id: messageId,
      createdAt: now(),
      workContextId,
      runId,
      role: "user",
      content: prompt,
      status: "complete",
      delivery: { kind: "steer", state: "pending", updatedAt: now() },
    };
    const request = (async () => {
      // Persist before enqueueing so even an immediate acknowledgement updates
      // an existing message. Recheck the original run after the awaited write.
      this.deps.tasks.store.conversations.append(
        sessionId,
        message,
        workContextId,
      );
      this.deps.notify(id);
      try {
        if (
          this.deps.execution.steers.get(steerKey) !== steer ||
          this.deps.tasks.running.get(sessionId) !== live ||
          live!.controller.signal.aborted
        )
          fail("目前回合已結束，補充指示尚未採用。", 409);
        await steer!(prompt, async () => {
          await this.updateSteeringDelivery(sessionId, messageId, "applied");
          this.deps.notify(id);
        });
      } catch (error) {
        await this.updateSteeringDelivery(sessionId, messageId, "not-applied");
        this.deps.notify(id);
        throw error;
      }
      return this.deps.tasks.store.conversations.message(sessionId, messageId)!;
    })();
    this.deps.execution.steeringRequests.set(key, { prompt, request });
    try {
      return await request;
    } finally {
      this.deps.execution.steeringRequests.delete(key);
    }
  }
  newContext(id: string) {
    const bot = this.deps.writableBot(id);
    if (
      this.deps.execution.preparingLocations.has(
        this.deps.tasks.store.conversations.activeId(bot.sessionId),
      ) ||
      [...this.deps.execution.incoming.keys()].some((key) =>
        key.startsWith(id + ":"),
      ) ||
      this.deps.tasks.running.has(bot.sessionId) ||
      this.deps.db.jobs
        .list()
        .some(
          (j) => j.botId === id && ["queued", "running"].includes(j.status),
        ) ||
      this.deps.db.approvals
        .list()
        .some((a) => a.botId === id && a.status === "pending")
    )
      fail(
        "尚有執行中、排隊或等待核准的工作，請完成或停止後再建立新話題。",
        409,
      );
    const context = this.deps.tasks.store.conversations.createContext(
      bot.sessionId,
    );
    context.location = this.deps.tasks.locations.ensure(
      bot.sessionId,
      context.id,
    );
    this.deps.notify(id);
    return context;
  }
}
