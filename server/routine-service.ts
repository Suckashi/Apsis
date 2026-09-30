import {
  parseRequest,
  routineSchema,
  routinePatchSchema,
} from "./request-schema.ts";
import { randomUUID, createHash } from "node:crypto";

import { Cron } from "croner";
import type { TaskService } from "./tasks.ts";

import type { Routine } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";

import { ChatWorkspaces } from "./chat-workspaces.ts";
import { repositoryInfo, createTaskWorktree } from "./git-workspaces.ts";

import type { ExecutionState } from "./execution-state.ts";
import type { BotService } from "./bot-service.ts";
import type { JobService } from "./job-service.ts";
import { now, fail, string } from "./product-support.ts";

interface Dependencies {
  bot: BotService["bot"];
  db: ProductDB;
  execution: ExecutionState;
  notify: (botId?: string, jobId?: string) => void;
  submit: JobService["submit"];
  tasks: TaskService;
  validateContextModel: BotService["validateContextModel"];
  workspaces: ChatWorkspaces;
  writableBot: BotService["writableBot"];
}

export class RoutineService {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async routine(
    botId: string,
    request: unknown,
    id: string = randomUUID(),
    permissionBotIds?: string[],
    location?: WorkLocation,
  ) {
    this.deps.writableBot(botId);
    const old = this.deps.db.routines.get(id);
    const input = parseRequest(
      old ? routinePatchSchema : routineSchema,
      request,
    );
    if (
      input.enabled !== false &&
      (input.enabled === true || old?.enabled !== false)
    )
      this.deps.validateContextModel(this.deps.bot(botId));
    const cron = string(input.cron ?? old?.cron, 100);
    const timezone = string(
      input.timezone ?? old?.timezone ?? "Asia/Taipei",
      80,
    );
    let nextAt: string;
    try {
      nextAt =
        new Cron(cron, { timezone }).nextRun()?.toISOString() ||
        fail("排程沒有下一次執行時間。");
    } catch {
      return fail("Cron 或時區格式錯誤。");
    }
    const projectId =
      typeof input.projectId === "string"
        ? input.projectId || undefined
        : old?.projectId;
    const branch =
      typeof input.branch === "string" ? input.branch : old?.branch;
    if (projectId) {
      const info = await repositoryInfo(
        this.deps.tasks.projects.get(projectId).path,
      );
      if (!branch || !info.branches.includes(branch))
        fail("請選擇排程固定使用的分支。");
    }
    const routine = this.deps.db.routines.put({
      projectId,
      branch,
      id,
      botId,
      name: string(input.name ?? old?.name, 100),
      prompt: string(input.prompt ?? old?.prompt),
      cron,
      timezone,
      enabled:
        typeof input.enabled === "boolean"
          ? input.enabled
          : (old?.enabled ?? true),
      nextAt,
      history: old?.history || [],
      lastAt: old?.lastAt,
      permissionBotIds: old?.permissionBotIds || permissionBotIds,
      location:
        (projectId
          ? this.deps.tasks.locations.project(projectId)
          : undefined) ||
        old?.location ||
        location ||
        this.deps.tasks.locations.lock(
          this.deps.bot(botId).sessionId,
          this.deps.tasks.store.conversations.activeId(
            this.deps.bot(botId).sessionId,
          ),
        ),
    });
    this.deps.notify(botId);
    return routine;
  }
  async runRoutine(r: Routine, requestId: string) {
    const existing = this.deps.db.jobs.get(requestId);
    if (existing) return existing;
    let location = r.location;
    let gitContext: import("../shared/coding.ts").ConversationWorkspace["git"];
    if (r.projectId) {
      this.deps.validateContextModel(this.deps.writableBot(r.botId));
      const project = this.deps.tasks.projects.get(r.projectId);
      const work = await createTaskWorktree(
        this.deps.tasks.store.directory,
        project.path,
        createHash("sha256").update(requestId).digest("hex").slice(0, 32),
        r.branch,
        "exclude",
        this.deps.workspaces.worktreeRoot,
      );
      location = {
        ...this.deps.tasks.locations.project(project.id),
        id:
          "routine-" +
          createHash("sha256").update(requestId).digest("hex").slice(0, 24),
        path: work.path,
        kind: "worktree",
      };
      gitContext = work.git;
    }
    return this.deps.submit(
      r.botId,
      { requestId, prompt: r.prompt, contextKind: "routine" },
      { permissionBotIds: r.permissionBotIds },
      location,
      gitContext,
    );
  }
  async tick() {
    for (const r of this.deps.db.routines.list())
      if (
        !this.deps.execution.closed &&
        r.enabled &&
        !this.deps.execution.deleting.has(r.botId) &&
        r.nextAt <= now()
      ) {
        try {
          this.deps.validateContextModel(this.deps.bot(r.botId));
        } catch (error) {
          this.deps.db.routines.put({
            ...r,
            enabled: false,
            blockedReason: (error as Error).message,
          });
          this.deps.notify(r.botId);
          continue;
        }
        const at = r.nextAt;
        const id = `${r.id}:${at}`;
        r.lastAt = now();
        r.nextAt =
          new Cron(r.cron, { timezone: r.timezone }).nextRun()?.toISOString() ||
          "9999";
        r.history = [...r.history, { at: r.lastAt, jobId: id }].slice(-100);
        this.deps.db.routines.put(r);
        try {
          await this.runRoutine(r, id);
        } catch (error) {
          r.blockedReason = (error as Error).message;
          this.deps.db.routines.put(r);
          this.deps.notify(r.botId);
        }
      }
  }
}
