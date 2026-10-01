import { createHash } from "node:crypto";

import { resolve } from "node:path";

import { FileManager, fileRevision } from "./file-manager.ts";

import type { TaskService } from "./tasks.ts";
import type { Bot, Job } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";

import { SettingsService } from "./settings.ts";

import type { ExecutionState } from "./execution-state.ts";
import type { BotService } from "./bot-service.ts";

import { now, fail, string } from "./product-support.ts";
import { transitionJob } from "./task-lifecycle.ts";

interface Dependencies {
  db: ProductDB;
  execution: ExecutionState;
  files: FileManager;
  finishSteering: (sessionId: string, runId?: string) => Promise<void>;
  notify: (botId?: string, jobId?: string) => void;
  settings: SettingsService;
  tasks: TaskService;
  validateContextModel: BotService["validateContextModel"];
  writableBot: BotService["writableBot"];
}

export class JobService {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async submit(
    id: string,
    input: Record<string, unknown>,
    delegation: Pick<
      Job,
      | "delegatedBy"
      | "delegatedByName"
      | "parentJobId"
      | "rootJobId"
      | "delegationPath"
      | "permissionBotIds"
    > = {},
    inheritedLocation?: WorkLocation,
    contextGit?: import("../shared/coding.ts").ConversationWorkspace["git"],
  ) {
    if (this.deps.execution.closed) fail("服務正在關閉。", 503);
    const bot = this.deps.writableBot(id);
    const executionSessionId = bot.sessionId;
    const prompt = string(input.prompt);
    const requestId = string(input.requestId, 100);
    const existing = this.deps.db.jobs.get(requestId);
    if (existing) {
      if (existing.botId !== id || existing.prompt !== prompt)
        fail("請求 ID 已使用。", 409);
      return existing;
    }
    this.deps.validateContextModel(bot);
    if (
      typeof input.replyTo === "string" &&
      !this.deps.tasks.store.conversations.message(
        executionSessionId,
        input.replyTo,
      )
    )
      fail("找不到引用訊息。", 404);
    const retry =
      typeof input.retryOf === "string"
        ? this.deps.db.jobs.get(input.retryOf)
        : undefined;
    if (
      input.retryOf !== undefined &&
      (!retry ||
        retry.botId !== id ||
        !["failed", "cancelled", "interrupted"].includes(retry.status))
    )
      fail("只能重新交辦這位 Bot 已停止或失敗的任務。", 409);
    if (retry)
      delegation = {
        delegatedBy: retry.delegatedBy,
        delegatedByName: retry.delegatedByName,
        parentJobId: retry.parentJobId,
        rootJobId: retry.rootJobId,
        delegationPath: retry.delegationPath,
        permissionBotIds: retry.permissionBotIds,
      };
    if (
      !retry &&
      !inheritedLocation &&
      input.workContextId !== undefined &&
      input.workContextId !==
        this.deps.tasks.store.conversations.activeId(executionSessionId)
    )
      fail("目前話題已變更，請重新載入。", 409);
    const contextKind =
      retry?.contextKind ??
      (delegation.delegatedBy
        ? "delegation"
        : input.contextKind === "routine"
          ? "routine"
          : "chat");
    const workContextId =
      retry?.workContextId ??
      (contextKind === "chat"
        ? this.deps.tasks.store.conversations.activeId(executionSessionId)
        : this.deps.tasks.store.conversations.createContext(
            executionSessionId,
            contextKind,
          ).id);
    this.deps.tasks.store.conversations.context(
      executionSessionId,
      workContextId,
    );
    const carried = retry?.location || inheritedLocation;
    if (carried && !retry)
      this.deps.tasks.locations.bind(
        executionSessionId,
        workContextId,
        contextKind === "routine" && !carried.projectId
          ? { ...carried, memoryKey: `task:${workContextId}` }
          : carried,
      );
    if (contextGit)
      this.deps.tasks.store.conversations.updateContext(
        executionSessionId,
        workContextId,
        { git: contextGit },
      );
    const priorContext = this.deps.tasks.store.conversations.context(
      executionSessionId,
      workContextId,
    );
    const priorLocation = this.deps.tasks.locations.ensure(
      executionSessionId,
      workContextId,
    );
    if (
      !priorContext.locationLockedAt &&
      priorLocation.kind === "task" &&
      !carried
    )
      this.deps.tasks.locations.bind(executionSessionId, workContextId, {
        ...priorLocation,
        name: prompt.slice(0, 44),
      });
    const location = this.deps.tasks.locations.lock(
      executionSessionId,
      workContextId,
    );
    const fileReferences = Array.isArray(input.fileReferences)
      ? input.fileReferences
      : retry?.fileReferences || [];
    for (const ref of fileReferences) {
      if (
        !ref ||
        typeof ref.path !== "string" ||
        ref.locationId !== location.id ||
        typeof ref.revision !== "string"
      )
        fail("檔案引用不屬於目前話題。");
      const file = await this.deps.files.download(location.id, ref.path);
      if ((await fileRevision(file)) !== ref.revision)
        fail("引用檔案已變更，請重新加入。", 409);
    }
    if (
      !retry &&
      contextKind === "chat" &&
      this.deps.tasks.store.conversations.activeId(executionSessionId) !==
        workContextId
    )
      fail("目前話題已變更，請重新載入。", 409);
    const duplicate = this.deps.db.jobs.get(requestId);
    if (duplicate) {
      if (duplicate.botId !== id || duplicate.prompt !== prompt)
        fail("請求 ID 已使用。", 409);
      return duplicate;
    }
    if (this.deps.execution.closed) fail("服務正在關閉。", 503);
    const job: Job = {
      location,
      fileReferences,
      workContextId,
      retryOf: retry?.id,
      contextKind,
      id: requestId,
      botId: id,
      prompt,
      createdAt: now(),
      status: "queued",
      ...delegation,
      replyTo: typeof input.replyTo === "string" ? input.replyTo : undefined,
    };
    this.deps.db.jobs.put(job);
    this.deps.notify(id, job.id);
    void this.drain(bot).catch(console.error);
    return job;
  }
  async delegate(
    source: Bot,
    runId: string,
    callId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    this.deps.writableBot(source.id);
    const target = this.deps.writableBot(string(input.botId, 100));
    const prompt = string(input.prompt, 12000);
    if (target.hidden) fail("這位 Bot 已隱藏，請選擇其他 Bot。");
    const parent =
      this.deps.db.jobs
        .list()
        .find(
          (j) =>
            j.botId === source.id &&
            j.runId === runId &&
            j.status === "running",
        ) || fail("只能在執行中的任務派工。", 409);
    const path = parent.delegationPath || [source.id];
    const settings =
      this.deps.execution.jobSettings.get(parent.id) ||
      this.deps.settings.read();
    if (path.includes(target.id)) fail("不能派工給自己或上游 Bot。");
    if (path.length > settings.maxDelegationDepth)
      fail("派工層數已達上限，請回報目前結果。");
    const requestId =
      "delegate-" +
      createHash("sha256").update(`${parent.id}:${callId}`).digest("hex");
    const rootJobId = parent.rootJobId || parent.id;
    const jobs = this.deps.db.jobs.list();
    if (!this.deps.db.jobs.get(requestId)) {
      if (
        jobs.filter((j) => j.rootJobId === rootJobId).length >=
        settings.maxDelegatedJobs
      )
        fail("本次工作的派工數已達上限，請整理目前結果。");
      // Include other roots: two independent conversations must not wait on each other.
      const pending = jobs.filter(
        (j) => j.delegatedBy && ["queued", "running"].includes(j.status),
      );
      const visited = new Set<string>();
      const reachesSource = (id: string): boolean => {
        if (id === source.id) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        return pending.some(
          (j) => j.delegatedBy === id && reachesSource(j.botId),
        );
      };
      if (reachesSource(target.id))
        fail("這次派工會形成互相等待，請改派其他 Bot。");
    }
    const resume = this.deps.execution.slots.suspend(parent.id);
    let child: Job;
    try {
      child = await this.submit(
        target.id,
        { prompt, requestId },
        {
          delegatedBy: source.id,
          delegatedByName: source.name,
          parentJobId: parent.id,
          rootJobId,
          delegationPath: [...path, target.id],
          permissionBotIds: [
            ...new Set([...(parent.permissionBotIds || path), target.id]),
          ],
        },
        parent.location,
      );
    } catch (error) {
      await resume();
      throw error;
    }
    const cancel = () => {
      const current = this.deps.db.jobs.get(child.id);
      if (!current) return;
      if (current.status === "queued")
        this.deps.db.jobs.put(
          transitionJob(current, "cancelled", "派工來源已停止。"),
        );
      else if (current.status === "running") {
        this.deps.execution.cancelledDelegations.add(current.id);
        this.deps.execution.jobControllers.get(current.id)?.abort();
        this.deps.tasks.stop(target.sessionId);
      }
      this.deps.notify(target.id);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        if (signal?.aborted) {
          cancel();
          signal.throwIfAborted();
        }
        const current = this.deps.db.jobs.get(child.id);
        if (!current) fail("接收派工的 Bot 或任務已刪除。", 404);
        if (!["queued", "running"].includes(current!.status)) {
          return {
            jobId: child.id,
            botId: target.id,
            name: target.name,
            status: current!.status,
            result: current!.result || "",
            error: current!.error,
            artifacts: this.deps.db.artifacts
              .list()
              .filter(
                (a) =>
                  a.botId === target.id &&
                  !!current!.runId &&
                  a.runId === current!.runId,
              ),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      signal?.removeEventListener("abort", cancel);
      await resume();
    }
  }
  async drain(bot: Bot) {
    const queueKey = bot.id;
    const sessionId = bot.sessionId;
    if (this.deps.execution.active.has(queueKey) || this.deps.execution.closed)
      return;
    this.deps.execution.active.add(queueKey);
    try {
      for (;;) {
        const job = this.deps.db.jobs.list({
          botId: bot.id,
          status: "queued",
        })[0];
        if (
          !job ||
          this.deps.execution.closed ||
          this.deps.execution.deleting.has(bot.id)
        )
          break;
        Object.assign(job, transitionJob(job, "running"));
        this.deps.execution.jobSettings.set(
          job.id,
          (job.parentJobId &&
            this.deps.execution.jobSettings.get(job.parentJobId)) ||
            this.deps.settings.read(),
        );
        const controller = new AbortController();
        this.deps.execution.jobControllers.set(job.id, controller);
        this.deps.db.jobs.put(job);
        try {
          await this.deps.execution.slots.acquire(
            job.id,
            job.rootJobId || job.id,
            this.deps.execution.jobSettings.get(job.id)!.maxConcurrent,
            controller.signal,
          );
          await this.deps.files.wait();
          for (const ref of job.fileReferences || []) {
            if (
              !job.location ||
              ref.locationId !== job.location.id ||
              (await fileRevision(
                await this.deps.files.download(ref.locationId, ref.path),
              )) !== ref.revision
            )
              fail("引用檔案已變更，請重新加入。", 409);
          }
          this.deps.writableBot(bot.id);
          let notifyTimer: ReturnType<typeof setTimeout> | undefined;
          if (this.deps.execution.cancelledDelegations.has(job.id))
            fail("派工來源已停止。", 409);
          const promise = this.deps.tasks.run(
            sessionId,
            job.prompt,
            false,
            (event) => {
              const live = this.deps.tasks.running.get(sessionId);
              if (live && !job.runId) {
                job.runId = live.runId;
                this.deps.db.jobs.put(job);
              }
              if (["done", "error", "operation"].includes(event.type)) {
                clearTimeout(notifyTimer);
                notifyTimer = undefined;
                this.deps.notify(bot.id, job.id);
              } else if (!notifyTimer) {
                notifyTimer = setTimeout(() => {
                  notifyTimer = undefined;
                  this.deps.notify(bot.id, job.id);
                }, 200);
              }
            },
            controller.signal,
            { files: true, memory: true, skills: true, shell: true },
            job.workContextId,
          );
          job.runId = this.deps.tasks.running.get(sessionId)?.runId;
          this.deps.db.jobs.put(job);
          this.deps.notify(bot.id, job.id);
          try {
            job.result = (await promise).slice(0, 16000);
          } finally {
            clearTimeout(notifyTimer);
          }
          Object.assign(job, transitionJob(job, "completed"));
        } catch (error) {
          const status =
            controller.signal.aborted ||
            this.deps.execution.cancelledDelegations.has(job.id) ||
            this.deps.tasks.runs.records.get(job.runId || "")?.status ===
              "cancelled"
              ? "cancelled"
              : "failed";
          Object.assign(
            job,
            transitionJob(job, status, (error as Error).message),
          );
        } finally {
          this.deps.execution.cancelledDelegations.delete(job.id);
          this.deps.execution.slots.release(job.id);
          this.deps.execution.slots.forgetRoot(job.rootJobId || job.id);
          this.deps.execution.jobControllers.delete(job.id);
          this.deps.execution.jobSettings.delete(job.id);
          this.deps.execution.steers.delete(bot.id);
          await this.deps.finishSteering(sessionId, job.runId);
          this.deps.db.jobs.put(job);
          this.deps.notify(bot.id, job.id);
        }
      }
    } finally {
      this.deps.execution.active.delete(queueKey);
      this.deps.notify(bot.id);
    }
  }
}
