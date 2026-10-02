import type { ServerResponse } from "node:http";

import { join, resolve, relative, isAbsolute, sep } from "node:path";

import { FileManager } from "./file-manager.ts";
import { HtmlPreview } from "./html-preview.ts";

import type { TaskService } from "./tasks.ts";
import type { Connections } from "./connections.ts";
import type { Bot } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { buildRunConfig } from "./run-config.ts";
import { ProductDB } from "./product-db.ts";
import { BotBrowser } from "./bot-browser.ts";

import { McpConfig } from "./mcp-config.ts";

import { SettingsService } from "./settings.ts";

import { ChatWorkspaces } from "./chat-workspaces.ts";

import { BotService } from "./bot-service.ts";
import { ApprovalService } from "./approval-service.ts";
import { RoutineService } from "./routine-service.ts";
import { ArtifactService } from "./artifact-service.ts";
import { MessageService } from "./message-service.ts";
import { JobService } from "./job-service.ts";
import { ProductQueries } from "./product-queries.ts";
import { ProductTools } from "./product-tools.ts";
import { ProductRoutes } from "./product-routes.ts";
import { ExecutionState } from "./execution-state.ts";
import { transitionJob, recoverJob } from "./task-lifecycle.ts";
import { fail, now, denyOperation } from "./product-support.ts";

export class ProductService {
  readonly execution = new ExecutionState();
  readonly bots: BotService;
  readonly approvals: ApprovalService;
  readonly routines: RoutineService;
  readonly artifacts: ArtifactService;
  readonly messages: MessageService;
  readonly jobs: JobService;
  readonly queries: ProductQueries;
  readonly toolRegistry: ProductTools;
  readonly routes: ProductRoutes;
  readonly workspaces: ChatWorkspaces;
  db = new ProductDB();
  settings: SettingsService;
  connectors: McpConfig;

  tasks: TaskService;
  connections: Connections;
  browser: BotBrowser;
  files: FileManager;
  htmlPreview = new HtmlPreview();
  subscribers = new Set<ServerResponse>();

  timer?: ReturnType<typeof setInterval>;

  private bootstrapPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private readonly background = new Set<Promise<unknown>>();

  private track(operation: Promise<unknown>) {
    this.background.add(operation);
    void operation
      .catch(console.error)
      .finally(() => this.background.delete(operation));
  }
  bootstrap() {
    if (!this.bootstrapPromise)
      this.bootstrapPromise = (async () => {
        if (!this.db.get("bootstrap", "default-bot")) {
          if (!this.db.bots.list().length)
            await this.bots.create("Apsis", { description: "你的研發夥伴" });
          this.db.put("bootstrap", { id: "default-bot", completedAt: now() });
        }
      })().catch((error) => {
        this.bootstrapPromise = undefined;
        throw error;
      });
    return this.bootstrapPromise;
  }
  constructor(tasks: TaskService, connections: Connections) {
    this.tasks = tasks;
    this.connections = connections;
    this.settings = new SettingsService(connections.config);
    this.connectors = new McpConfig(tasks.store.directory);
    this.browser = new BotBrowser(tasks.store.directory);
    this.workspaces = new ChatWorkspaces({
      db: this.db,
      tasks,
      execution: this.execution,
      bot: (...args) => this.bots.bot(...args),
      submit: (...args) => this.jobs.submit(...args),
      notify: (...args) => this.notify(...args),
    });
    this.files = new FileManager(
      tasks.locations,
      this.db,
      tasks.store.directory,
      (location) => this.locationBusy(location),
    );
    this.bots = new BotService({
      browser: this.browser,
      connections: this.connections,
      connectors: this.connectors,
      db: this.db,
      execution: this.execution,
      notify: (...args) => this.notify(...args),
      tasks: this.tasks,
    });
    this.approvals = new ApprovalService({
      bot: (...args) => this.bots.bot(...args),
      connectors: this.connectors,
      db: this.db,
      execution: this.execution,
      notify: (...args) => this.notify(...args),
      settings: this.settings,
      tasks: this.tasks,
      workLocation: (...args) => this.workLocation(...args),
    });
    this.routines = new RoutineService({
      bot: (...args) => this.bots.bot(...args),
      db: this.db,
      execution: this.execution,
      notify: (...args) => this.notify(...args),
      submit: (...args) => this.jobs.submit(...args),
      tasks: this.tasks,
      validateContextModel: (...args) =>
        this.bots.validateContextModel(...args),
      workspaces: this.workspaces,
      writableBot: (...args) => this.bots.writableBot(...args),
    });
    this.artifacts = new ArtifactService({
      authorize: (...args) => this.approvals.authorize(...args),
      db: this.db,
      notify: (...args) => this.notify(...args),
      tasks: this.tasks,
      workLocation: (...args) => this.workLocation(...args),
      writableBot: (...args) => this.bots.writableBot(...args),
    });
    this.messages = new MessageService({
      bot: (...args) => this.bots.bot(...args),
      db: this.db,
      execution: this.execution,
      files: this.files,
      notify: (...args) => this.notify(...args),
      submit: (...args) => this.jobs.submit(...args),
      tasks: this.tasks,
      writableBot: (...args) => this.bots.writableBot(...args),
    });
    this.jobs = new JobService({
      db: this.db,
      execution: this.execution,
      files: this.files,
      finishSteering: (...args) => this.messages.finishSteering(...args),
      notify: (...args) => this.notify(...args),
      settings: this.settings,
      tasks: this.tasks,
      validateContextModel: (...args) =>
        this.bots.validateContextModel(...args),
      writableBot: (...args) => this.bots.writableBot(...args),
    });
    this.queries = new ProductQueries({
      bot: (...args) => this.bots.bot(...args),
      browser: this.browser,
      connections: this.connections,
      connectors: this.connectors,
      db: this.db,
      execution: this.execution,
      memoryScope: (...args) => this.bots.memoryScope(...args),
      tasks: this.tasks,
      validateContextModel: (...args) =>
        this.bots.validateContextModel(...args),
      workLocation: (...args) => this.workLocation(...args),
    });
    this.toolRegistry = new ProductTools({
      browser: this.browser,
      connectors: this.connectors,
      createDocument: (...args) => this.artifacts.createDocument(...args),
      db: this.db,
      delegate: (...args) => this.jobs.delegate(...args),
      execution: this.execution,
      notify: (...args) => this.notify(...args),
      publish: (...args) => this.artifacts.publish(...args),
      readDocument: (...args) => this.artifacts.readDocument(...args),
      routine: (...args) => this.routines.routine(...args),
      tasks: this.tasks,
      update: (...args) => this.bots.update(...args),
      workLocation: (...args) => this.workLocation(...args),
      workspaces: this.workspaces,
    });
    this.routes = new ProductRoutes({
      bootstrap: (...args) => this.bootstrap(...args),
      bot: (...args) => this.bots.bot(...args),
      browser: this.browser,
      connector: (...args) => this.toolRegistry.connector(...args),
      connectors: this.connectors,
      create: (...args) => this.bots.create(...args),
      db: this.db,
      decide: (...args) => this.approvals.decide(...args),
      detail: (...args) => this.queries.detail(...args),
      execution: this.execution,
      files: this.files,
      htmlPreview: this.htmlPreview,
      memoryScope: (...args) => this.bots.memoryScope(...args),
      newContext: (...args) => this.messages.newContext(...args),
      notify: (...args) => this.notify(...args),
      policy: (...args) => this.approvals.policy(...args),
      publish: (...args) => this.artifacts.publish(...args),
      readDocument: (...args) => this.artifacts.readDocument(...args),
      receiveMessage: (...args) => this.messages.receiveMessage(...args),
      remove: (...args) => this.bots.remove(...args),
      routine: (...args) => this.routines.routine(...args),
      runRecord: (...args) => this.queries.runRecord(...args),
      runRoutine: (...args) => this.routines.runRoutine(...args),
      settings: this.settings,
      snapshot: (...args) => this.queries.snapshot(...args),
      steerMessage: (...args) => this.messages.steerMessage(...args),
      subscribers: this.subscribers,
      tasks: this.tasks,
      template: (...args) => this.bots.template(...args),
      update: (...args) => this.bots.update(...args),
      workLocation: (...args) => this.workLocation(...args),
      workspaces: this.workspaces,
      writableBot: (...args) => this.bots.writableBot(...args),
    });
  }
  locationBusy(location: WorkLocation) {
    const overlaps = (path: string) => {
      const inside = (a: string, b: string) => {
        const r = relative(a, b);
        return (
          r === "" ||
          (!r.startsWith(".." + sep) && r !== ".." && !isAbsolute(r))
        );
      };
      return inside(location.path, path) || inside(path, location.path);
    };
    return this.db.jobs
      .list()
      .some(
        (j) =>
          j.status === "running" && j.location && overlaps(j.location.path),
      );
  }
  workLocation(bot: Bot, runId?: string) {
    if (runId) {
      const run = this.tasks.runs.records.get(runId);
      if (run?.location) return run.location;
      const job = this.db.jobs.list({ botId: bot.id, runId })[0];
      if (job?.location) return job.location;
    }
    return this.tasks.locations.ensure(bot.sessionId);
  }
  async init() {
    await this.db.init(this.tasks.store.directory);
    this.connections.attachDB(this.db);
    this.connectors.init();
    await this.files.recover();
    for (const bot of this.db.bots.list())
      if (bot.deletedAt) await this.bots.removeBotData(bot);
    for (const approval of this.db.approvals.list())
      if (approval.status === "pending")
        this.db.approvals.put({ ...approval, status: "expired" });
    for (const job of this.db.jobs.list())
      if (["running", "queued"].includes(job.status))
        this.db.jobs.put(
          recoverJob(job, this.tasks.runs.records.get(job.runId || "")),
        );
    this.tasks.timeoutMs = 30 * 60 * 1000;
    for (const draft of this.db.drafts.list())
      if (draft.status === "sending")
        this.db.drafts.put({
          ...draft,
          status: "unknown",
          result: "傳送時服務中斷；請先向外部服務確認結果，避免重複傳送。",
        });
    this.tasks.isWaiting = (sessionId) =>
      this.db.jobs
        .list()
        .some(
          (j) =>
            this.db.bots.get(j.botId)?.sessionId === sessionId &&
            this.execution.slots.isSuspended(j.id),
        ) ||
      this.db.approvals
        .list()
        .some(
          (a) =>
            a.status === "pending" &&
            (this.tasks.runs.records.get(a.runId)?.sessionId ||
              this.db.bots.get(a.botId)?.sessionId) === sessionId,
        );
    this.tasks.extensions = (session, runId) => {
      const bot = session.botId ? this.db.bots.get(session.botId) : undefined;
      if (!bot) return {};
      const job = this.db.jobs.list({ botId: bot.id, status: "running" })[0];
      const quoted = job?.replyTo
        ? this.tasks.store.conversations.message(session.id, job.replyTo)
        : undefined;
      const settings =
        (job && this.execution.jobSettings.get(job.id)) || this.settings.read();
      return {
        ...buildRunConfig(bot, this.connections, this.connectors.all(), job),
        executionContext: [
          "Work directly in this conversation and its working folder. Complete the user's requested scope and verify the result. Do not create independent tasks. If asked to plan first, return a plan and wait for the user before implementing.",
          "Pushing, creating a PR, publishing or deploying requires explicit user authorization. Earlier authorization remains valid unless narrowed or revoked. Finish local work with a report of changes and actual checks. For static HTML/JS interfaces use verify_web after the last edit; never claim verification without passing evidence.",
          "Successful create_document and publish_file calls automatically add result cards with preview and download actions. Refer to readable filenames and these cards; do not repeat UUID directories, artifact IDs, source hashes or internal tool field names in an ordinary delivery reply. Include a working path when it is needed to use an unpublished file, or exact technical details when requested. Reports to a delegating Bot may include the evidence references it needs to verify or continue work. Do not publish an already published artifact again merely to add a card.",
          "For a static web app with separate local CSS, scripts, modules, images, fonts or data files, use publish_file with its HTML entry and an explicit assets list containing every required local file (including dependencies imported by other assets). This creates one immutable preview and a complete ZIP download. assets only works with an HTML entry; publish a standalone Markdown or other file by omitting assets. Paths are relative to the task workspace; the bundle includes at most 64 files and 20 MB. Verify the final app with verify_web before publishing, and do not claim undeclared or remote resources are included.",
          job?.workContextId &&
          this.tasks.store.conversations.context(session.id, job.workContextId)
            .git
            ? "Work in the current working folder. After creating an authorized PR, call track_pull_request with its returned HTTPS URL. Never claim a PR exists without a returned URL. Git context: " +
              JSON.stringify(
                this.tasks.store.conversations.context(
                  session.id,
                  job.workContextId,
                ).git,
              )
            : "",
          quoted
            ? `The user is replying to this earlier message: ${JSON.stringify(quoted.content)}`
            : "",
          job?.fileReferences?.length
            ? `User referenced files (relative to this task): ${JSON.stringify(job.fileReferences)}`
            : "",
          job?.location?.projectId
            ? `Project background (reference data): ${JSON.stringify(this.tasks.projects.get(job.location.projectId).description || "")}`
            : "",
          "Final response: choose its depth from the current user request, not the length or format of earlier assistant replies. For ordinary work, use 3–6 short lines: result, actual checks, and material unresolved limitations. A feature-existence confirmation needs one direct answer and a short statement of how it was checked; a request to read source alone does not request an implementation walkthrough. Explain functions, selectors and storage keys when asked how it works. Give requested paths or checksums precisely without expanding into an unrelated report. Detailed reports, debugging and audits receive the requested detail. Preserve every material failure, partial result and uncertainty. Avoid repeating the acceptance checklist, excluded features or routine compliance with instructions.",
          "回報範例（只示範語氣，所有事實須依本次證據）：一般功能確認：『有，支援全部、未完成與已完成篩選，項目與完成狀態會保存。這次已讀取原始碼確認，未實際操作網頁；篩選條件本身不會保存。』一般文件交付：『已完成〈檔名〉的 Word 和 PDF，可由成果卡預覽或下載。PDF 共 N 頁，兩份內容已讀回核對。尚未檢查實際版面，尤其 Word 分頁。』使用者問如何實作或要求詳細報告時，依要求展開；不能套用範例裡尚未核對的事實。",
          "Use the user's language consistently in your own prose. For Traditional Chinese, proofread 顏色、否則、儲存、檔案、驗證 before sending; preserve quoted sources, filenames and code exactly. Report only the scope actually checked: source inspection is not a tested reload or browser result, and functional tests are not overall quality certification. Include limitations relevant to this request; do not append unrelated mobile or whole-product compliance caveats to a desktop confirmation. If extraction is uncertain, state that uncertainty without guessing its cause.",
        ]
          .filter(Boolean)
          .join("\n"),
        maxTurns: settings.maxTurns,
        runtimeSettings: settings,
        extraTools: this.toolRegistry.tools(bot, runId),
        authorize: (name, args, signal) =>
          this.approvals.authorize(bot.id, runId, name, args, signal),
        checkToolPermission: async (name, args, signal, receipt) => {
          if (
            !receipt ||
            receipt.fingerprint !==
              this.approvals.permissionFingerprint(bot.id, runId, name, args)
          )
            return this.approvals.authorize(bot.id, runId, name, args, signal);
          const policy = this.approvals.policy(bot.id, runId, name, args);
          if (policy.effect === "deny") denyOperation(policy);
        },
        executeAuthorizedTool: <T>(
          name: string,
          operation: () => Promise<T>,
          signal?: AbortSignal,
        ) =>
          job && name !== "delegate_task"
            ? this.execution.slots.withWork(job.id, operation, signal)
            : operation(),
        registerSteer: (steer) => {
          this.execution.steers.set(bot.id, async (text, onApplied) => {
            const live = this.tasks.running.get(session.id);
            if (!live || live.runId !== runId || live.controller.signal.aborted)
              fail("目前回合已結束，補充指示尚未採用。", 409);
            await steer(text, onApplied);
          });
        },
      };
    };
    this.timer = setInterval(() => {
      this.track(this.routines.tick());
      this.track(this.workspaces.checkPullRequests());
      for (const res of this.subscribers) res.write(": heartbeat\n\n");
    }, 15000);
    this.timer.unref();
    return this;
  }
  notify(botId?: string, jobId?: string) {
    const bot = botId ? this.db.bots.get(botId) : undefined;
    const liveRunId = bot && this.tasks.running.get(bot.sessionId)?.runId;
    const job = jobId
      ? this.db.jobs.get(jobId)
      : liveRunId
        ? this.db.jobs.list({ runId: liveRunId })[0]
        : undefined;
    const data = {
      botId,
      at: now(),
      jobId: job?.id,
      runId: job?.runId,
      workContextId:
        job?.workContextId ||
        (bot && !bot.deletedAt
          ? this.tasks.store.conversations.activeId(bot.sessionId)
          : undefined),
      locationId: job?.location?.id,
    };
    const id = this.db.event(data);
    for (const res of this.subscribers)
      res.write(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  stop() {
    if (this.execution.closed) return;
    this.execution.closed = true;
    clearInterval(this.timer);
    for (const job of this.db.jobs.list({ status: "queued" }))
      this.db.jobs.put(transitionJob(job, "cancelled", "服務正在關閉。"));
    this.tasks.stopAll();
    for (const controller of this.execution.jobControllers.values())
      controller.abort();
    this.execution.slots.close();
    for (const res of this.subscribers) res.end();
    this.subscribers.clear();
  }
  close(): Promise<void> {
    if (!this.closePromise) {
      this.stop();
      this.closePromise = (async () => {
        await Promise.allSettled([...this.background]);
        while (this.execution.active.size || this.tasks.running.size)
          await new Promise((resolve) => setTimeout(resolve, 10));
        const results = await Promise.allSettled([
          this.browser.close(),
          this.tasks.runs.flush(),
          this.tasks.store.flush(),
        ]);
        // Release every database even if a journal flush failed.
        for (const db of [this.tasks.store.conversations.db, this.db.db]) {
          try {
            db.close();
          } catch (error) {
            results.push({ status: "rejected", reason: error });
          }
        }
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, "關機清理失敗。");
      })();
    }
    return this.closePromise;
  }
}
