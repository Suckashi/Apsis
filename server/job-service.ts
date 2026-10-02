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
  private readonly submissions = new Map<
    string,
    { fingerprint: string; promise: Promise<Job> }
  >();
  submit(
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
    const key = string(input.requestId, 100);
    const fingerprint = JSON.stringify([
      id,
      input,
      delegation,
      inheritedLocation,
      contextGit,
    ]);
    const pending = this.submissions.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint)
        fail("Request ID already used", 409);
      return pending.promise;
    }
    const promise = this.enqueue(
      id,
      input,
      delegation,
      inheritedLocation,
      contextGit,
    ).finally(() => this.submissions.delete(key));
    this.submissions.set(key, { fingerprint, promise });
    return promise;
  }
  private async enqueue(
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
    let executionSessionId = bot.sessionId;
    const prompt = string(input.prompt);
    const requestId = string(input.requestId, 100);
    const existing = this.deps.db.jobs.get(requestId);
    if (existing) {
      if (existing.botId !== id || existing.prompt !== prompt)
        fail("請求 ID 已使用。", 409);
      return existing;
    }
    if (delegation.parentJobId) {
      const parent =
        this.deps.db.jobs.get(delegation.parentJobId) ||
        fail("Parent work not found", 409);
      const settings =
        this.deps.execution.jobSettings.get(parent.id) ||
        this.deps.settings.read();
      let depth = 1,
        ancestor: Job | undefined = parent;
      const visited = new Set<string>();
      while (ancestor?.parentJobId) {
        if (visited.has(ancestor.id)) fail("Cyclic work ancestry", 409);
        visited.add(ancestor.id);
        depth++;
        ancestor = this.deps.db.jobs.get(ancestor.parentJobId);
      }
      if (
        depth > settings.maxDelegationDepth ||
        this.deps.db.jobs
          .list()
          .filter((j) => j.rootJobId === (parent.rootJobId || parent.id))
          .length >= settings.maxDelegatedJobs
      )
        fail("Background work limit reached", 409);
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
    if (contextKind !== "chat")
      executionSessionId = (await this.deps.tasks.create({ botId: bot.id })).id;
    const workContextId =
      (contextKind === "chat" ? retry?.workContextId : undefined) ||
      this.deps.tasks.store.conversations.activeId(executionSessionId);
    if (contextKind !== "chat")
      this.deps.tasks.store.conversations.updateContext(
        executionSessionId,
        workContextId,
        { kind: contextKind },
      );
    this.deps.tasks.store.conversations.context(
      executionSessionId,
      workContextId,
    );
    const carried = retry?.location || inheritedLocation;
    if (carried && (!retry || contextKind !== "chat"))
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
      sessionId: executionSessionId,
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
    void this.drain(bot, executionSessionId).catch(console.error);
    return job;
  }
  reportCompletion(job: Job) {
    const bot = this.deps.writableBot(job.botId);
    if (
      !job.sessionId ||
      job.sessionId === bot.sessionId ||
      ["queued", "running"].includes(job.status)
    )
      return;
    const id = `work-result-${job.id}`;
    const history = this.deps.tasks.store.conversations;
    // Transcript primary key deduplicates the crash window before the job marker.
    if (!history.message(bot.sessionId, id))
      history.append(
        bot.sessionId,
        {
          id,
          role: "assistant",
          status: "complete",
          createdAt: now(),
          content: `${job.prompt.slice(0, 120)} — ${job.status}\n${job.result || job.error || ""}`,
        },
        history.activeId(bot.sessionId),
      );
    this.deps.db.jobs.put({ ...job, completionMessageId: id });
  }
  private readonly workspaceOwners = new Map<string, WorkLocation>();
  private async workspaceTurn(job: Job, signal: AbortSignal) {
    if (!job.location) return;
    const { relative, isAbsolute, sep } = await import("node:path");
    const inside = (a: string, b: string) => {
      const r = relative(resolve(a), resolve(b));
      return !r || (r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r));
    };
    while (
      [...this.workspaceOwners.entries()].some(
        ([id, location]) =>
          id !== job.id &&
          (inside(location.path, job.location!.path) ||
            inside(job.location!.path, location.path)),
      )
    ) {
      signal.throwIfAborted();
      await new Promise((done) => setTimeout(done, 25));
    }
    signal.throwIfAborted();
    this.workspaceOwners.set(job.id, job.location);
    signal.throwIfAborted();
  }
  async drain(bot: Bot, sessionId = bot.sessionId) {
    const queueKey = sessionId;
    if (this.deps.execution.active.has(queueKey) || this.deps.execution.closed)
      return;
    this.deps.execution.active.add(queueKey);
    try {
      for (;;) {
        const job = this.deps.db.jobs
          .list({
            botId: bot.id,
            status: "queued",
          })
          .find((j) => j.sessionId === sessionId);
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
          await this.workspaceTurn(job, controller.signal);
          await this.deps.execution.slots.acquire(
            job.id,
            sessionId === bot.sessionId ? "main-chat" : "background",
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
          this.workspaceOwners.delete(job.id);
          this.deps.execution.cancelledDelegations.delete(job.id);
          this.deps.execution.slots.release(job.id);
          this.deps.execution.slots.forgetRoot(
            sessionId === bot.sessionId ? "main-chat" : "background",
          );
          this.deps.execution.jobControllers.delete(job.id);
          this.deps.execution.jobSettings.delete(job.id);
          this.deps.execution.steers.delete(sessionId);
          await this.deps.finishSteering(sessionId, job.runId);
          this.deps.db.jobs.put(job);
          this.reportCompletion(job);
          this.deps.notify(bot.id, job.id);
        }
      }
    } finally {
      this.deps.execution.active.delete(queueKey);
      this.deps.notify(bot.id);
    }
  }
}
