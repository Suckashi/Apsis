import type { Snapshot, BotDetail } from "../shared/api.ts";
import type { RunRecord } from "../shared/task-progress.ts";
import { visibleMemory } from "./memory.ts";

import type { TaskService } from "./tasks.ts";
import type { Connections } from "./connections.ts";
import type { Bot } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";
import { BotBrowser } from "./bot-browser.ts";

import { McpConfig } from "./mcp-config.ts";
import { taskPresentation } from "./task-progress.ts";

import type { ExecutionState } from "./execution-state.ts";
import type { BotService } from "./bot-service.ts";
import { fail } from "./product-support.ts";

interface Dependencies {
  bot: BotService["bot"];
  browser: BotBrowser;
  connections: Connections;
  connectors: McpConfig;
  db: ProductDB;
  execution: ExecutionState;
  memoryScope: BotService["memoryScope"];
  tasks: TaskService;
  validateContextModel: BotService["validateContextModel"];
  workLocation: (bot: Bot, runId?: string) => WorkLocation;
}

export class ProductQueries {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  snapshot(): Snapshot {
    const allJobs = this.deps.db.jobs.list();
    const approvals = this.deps.db.approvals.list();
    return {
      projects: this.deps.tasks.projects
        .list()
        .filter((p) => p.id !== "workspace"),
      bots: this.deps.db.bots
        .list()
        .filter((b) => !b.deletedAt)
        .map((bot) => {
          const session = this.deps.tasks.view(bot.sessionId);
          const jobs = allJobs.filter((j) => j.botId === bot.id);
          const latestMessage = session.messages.at(-1);
          const updatedAt = [
            bot.createdAt,
            jobs.at(-1)?.createdAt,
            latestMessage?.createdAt,
          ]
            .filter((at): at is string => !!at)
            .sort()
            .at(-1)!;
          const approval = approvals.some(
            (a) => a.botId === bot.id && a.status === "pending",
          );
          return {
            ...bot,
            chatRunning:
              session.running ||
              jobs.some((j) => ["running", "queued"].includes(j.status)),
            status: approval
              ? "waiting"
              : session.running ||
                  this.deps.execution.active.has(bot.id) ||
                  jobs.some((j) => ["running", "queued"].includes(j.status))
                ? "working"
                : jobs.at(-1)?.status === "failed"
                  ? "error"
                  : "idle",
            lastMessage:
              session.live?.text ||
              latestMessage?.content ||
              "傳個訊息，開始聊聊",
            updatedAt,
            unread:
              latestMessage?.role === "assistant" &&
              (latestMessage.createdAt || "") > bot.readAt,
          };
        }),
      connections: this.deps.connections.view(),
      defaultModel: this.deps.connections.defaultSelection(),
      connectors: this.deps.connectors.view(),
      skills: this.deps.tasks.store
        .skillState()
        .skills.filter((s) => !s.agentId),
      skillDiagnostics: this.deps.tasks.store.skills.diagnostics,
      computerOwner: this.deps.browser.owner,
    };
  }
  presentation(id: string) {
    return taskPresentation(
      this.deps.bot(id),
      [...this.deps.tasks.runs.records.values()],
      this.deps.db.jobs.list(),
      this.deps.db.bots.list(),
      this.deps.db.approvals.list(),
    );
  }
  runRecord(id: string, runId: string): RunRecord {
    const bot = this.deps.bot(id);
    const run = this.deps.tasks.runs.records.get(runId);
    if (!run || run.sessionId !== bot.sessionId)
      return fail("找不到任務紀錄。", 404);
    return this.presentation(id).records(run);
  }
  detail(id: string, includeRecords = true): BotDetail {
    const bot = this.deps.bot(id);
    const presentation = this.presentation(id);
    const sessionView = this.deps.tasks.view(bot.sessionId);
    const jobs = this.deps.db.jobs.list({ botId: id });
    const quotes = Object.fromEntries(
      jobs
        .filter(
          (j) =>
            j.replyTo && sessionView.messages.some((m) => m.runId === j.runId),
        )
        .map((j) => [
          j.replyTo!,
          this.deps.tasks.store.conversations.message(bot.sessionId, j.replyTo!)
            ?.content,
        ]),
    );
    let contextSetupError: string | undefined;
    try {
      this.deps.validateContextModel(bot);
    } catch (error) {
      contextSetupError = (error as Error).message;
    }
    return {
      contextSetupError,
      quotes,
      bot,
      runSummaries: presentation.summaries,
      currentProgress: presentation.summaries.find(
        (r) => r.id === this.deps.tasks.running.get(bot.sessionId)?.runId,
      )?.progress,
      unlinkedDelegations: presentation.unlinked,
      drafts: this.deps.db.drafts.list({ botId: id }),
      session: sessionView,
      jobs,
      delegations: this.deps.db.jobs
        .list()
        .filter(
          (j) =>
            includeRecords &&
            j.delegatedBy &&
            (j.delegatedBy === id || j.botId === id),
        )
        .map((j) => ({
          ...j,
          targetName: this.deps.db.bots.get(j.botId)?.name || "已刪除的 Bot",
          waitingApproval: this.deps.db.approvals
            .list()
            .some(
              (a) =>
                a.botId === j.botId &&
                a.runId === j.runId &&
                a.status === "pending",
            ),
        })),
      approvals: this.deps.db.approvals.list({ botId: id }),
      artifacts: this.deps.db.artifacts.list({ botId: id }),
      routines: this.deps.db.routines.list({ botId: id }),
      memories: this.deps.tasks.store.state.memories.filter((m) =>
        visibleMemory(
          m,
          this.deps.memoryScope(bot),
          this.deps.workLocation(bot).memoryKey,
        ),
      ),
      runs: [...this.deps.tasks.runs.records.values()]
        .filter((r) => includeRecords && r.sessionId === bot.sessionId)
        .slice(-30),
      browserUrl: this.deps.browser.pages.get(id)?.url(),
      computerOwner: this.deps.browser.owner,
    };
  }
}
