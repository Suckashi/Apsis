import { classifyAction } from "./action-effects.ts";
import { randomUUID, createHash } from "node:crypto";

import { lstatSync, realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import type { TaskService } from "./tasks.ts";

import type { Bot, Approval } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";

import { McpConfig } from "./mcp-config.ts";

import { SettingsService } from "./settings.ts";
import { evaluatePolicy, type PolicyDecision } from "./policy.ts";
import { filePolicyContext } from "./policy-paths.ts";
import type { AuthorizationReceipt } from "./runtime.ts";

import type { ExecutionState } from "./execution-state.ts";
import type { BotService } from "./bot-service.ts";
import { now, fail, denyOperation } from "./product-support.ts";

interface Dependencies {
  bot: BotService["bot"];
  connectors: McpConfig;
  db: ProductDB;
  execution: ExecutionState;
  notify: (botId?: string, jobId?: string) => void;
  settings: SettingsService;
  tasks: TaskService;
  workLocation: (bot: Bot, runId?: string) => WorkLocation;
  browserTarget?: (sessionId: string) => unknown;
}

export class ApprovalService {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  permissionContext(botId: string, runId: string) {
    const jobs = this.deps.db.jobs.list();
    const job = jobs.find((j) => j.botId === botId && j.runId === runId);
    let root = job;
    const visited = new Set<string>();
    while (root?.parentJobId && !visited.has(root.id)) {
      visited.add(root.id);
      const parent = jobs.find((j) => j.id === root!.parentJobId);
      if (!parent) break;
      root = parent;
    }
    const ids = [
      ...new Set([
        ...(job?.permissionBotIds || job?.delegationPath || []),
        botId,
      ]),
    ];
    const session = this.deps.tasks.store.conversations.metadata(
      this.deps.bot(botId).sessionId,
    );
    const workspace =
      this.deps.tasks.runs.records.get(runId)?.project?.path ||
      job?.location?.path ||
      root?.location?.path ||
      (root?.workContextId
        ? this.deps.tasks.locations.ensure(root.sessionId!, root.workContextId)
            .path
        : this.deps.workLocation(this.deps.bot(botId), runId).path);
    const scopeKey = root
      ? JSON.stringify([root.botId, root.workContextId || root.id])
      : JSON.stringify([
          botId,
          this.deps.tasks.store.conversations.activeId(
            this.deps.bot(botId).sessionId,
          ),
        ]);
    return { owners: ids.map((id) => this.deps.bot(id)), scopeKey, workspace };
  }
  policy(
    botId: string,
    runId: string,
    tool: string,
    args: unknown,
  ): PolicyDecision {
    const job = this.deps.db.jobs
      .list()
      .find((j) => j.botId === botId && j.runId === runId);
    const confirmKnowledge =
      !!job?.workContextId &&
      !!this.deps.tasks.store.conversations.context(
        job.sessionId!,
        job.workContextId,
      ).git &&
      !!job.location?.projectId &&
      ["remember", "update_memory", "manage_memory"].includes(tool);
    const a = (args && typeof args === "object" ? args : {}) as Record<
      string,
      unknown
    >;
    const settings = this.deps.settings.read();
    const context = this.permissionContext(botId, runId);
    if (
      typeof a.connectorId === "string" &&
      context.owners.some(
        (owner) => !owner.connectorIds?.includes(a.connectorId as string),
      )
    )
      return {
        effect: "deny",
        reason: "connector",
        explicitAsk: false,
        matchedRuleIds: [],
      };
    const rules = [
      ...settings.permissionRules,
      ...context.owners.flatMap((owner) => owner.permissionRules || []),
    ];
    const path =
      typeof a.path === "string"
        ? a.path
        : tool === "shell"
          ? String(a.cwd || ".")
          : undefined;
    const key = this.approvalKey(botId, runId, tool, args);
    const remembered = this.deps.db
      .all<{
        key: string;
        ownerBotId: string;
        version: number;
      }>("session-allow")
      .some(
        (entry) =>
          entry.version === 1 &&
          entry.key === key &&
          context.owners.some((owner) => owner.id === entry.ownerBotId),
      );
    const decision = evaluatePolicy(
      rules,
      {
        tool,
        args: a,
        botId,
        botIds: context.owners.map((owner) => owner.id),
        path,
        command: typeof a.command === "string" ? a.command : undefined,
        targetBotId: typeof a.botId === "string" ? a.botId : undefined,
        action: typeof a.action === "string" ? a.action : undefined,
        readonly: context.owners.some(
          (owner) => owner.permissionMode === "readonly",
        ),
      },
      {
        caseInsensitive: process.platform === "win32",
        approvalMode: settings.approvalMode,
        dangerousCommandGuard: settings.dangerousCommandGuard,
        remembered,
        targetExists: path
          ? existsSync(resolve(context.workspace, path))
          : undefined,
        ...filePolicyContext(
          context.workspace,
          tool === "shell" ? undefined : path,
        ),
      },
    );
    return decision.effect !== "deny" && confirmKnowledge
      ? {
          effect: "ask",
          reason: "default",
          explicitAsk: true,
          matchedRuleIds: decision.matchedRuleIds,
        }
      : decision;
  }
  approvalKey(botId: string, runId: string, tool: string, args: unknown) {
    const context = this.permissionContext(botId, runId);
    const connectorId = (args as { connectorId?: unknown } | null)?.connectorId;
    const connector =
      typeof connectorId === "string"
        ? this.deps.connectors.get(connectorId)
        : undefined;
    const connectorFingerprint =
      typeof connectorId === "string"
        ? createHash("sha256")
            .update(
              JSON.stringify({
                connector: connector || null,
                token: connector?.bearerTokenEnvVar
                  ? process.env[connector.bearerTokenEnvVar]
                  : undefined,
              }),
            )
            .digest("hex")
        : undefined;
    return JSON.stringify({
      runId,
      scope: context.scopeKey,
      workspace: context.workspace,
      tool,
      args,
      connectorFingerprint,
    });
  }
  permissionFingerprint(
    botId: string,
    runId: string,
    tool: string,
    args: unknown,
  ) {
    const context = this.permissionContext(botId, runId);
    const settings = this.deps.settings.read();
    const a = args as { path?: string } | null;
    return createHash("sha256")
      .update(
        JSON.stringify({
          mode: settings.approvalMode,
          guard: settings.dangerousCommandGuard,
          rules: settings.permissionRules,
          owners: context.owners.map((owner) => ({
            id: owner.id,
            mode: owner.permissionMode,
            rules: owner.permissionRules,
            connectors: owner.connectorIds,
          })),
          key: this.approvalKey(botId, runId, tool, args),
          grants: this.deps.db
            .all<{ id: string; key: string; ownerBotId: string }>(
              "session-allow",
            )
            .filter(
              (entry) =>
                entry.key === this.approvalKey(botId, runId, tool, args) &&
                context.owners.some((owner) => owner.id === entry.ownerBotId),
            )
            .map((entry) => entry.id)
            .sort(),
          target: (() => {
            if (tool === "browser") {
              const job = this.deps.db.jobs.list({ runId })[0];
              return this.deps.browserTarget?.(
                job?.sessionId || this.deps.bot(botId).sessionId,
              );
            }
            if (!a?.path) return undefined;
            const target = resolve(context.workspace, a.path);
            try {
              const stat = lstatSync(target);
              return {
                path: realpathSync(target),
                ino: stat.ino,
                size: stat.size,
                modified: stat.mtimeMs,
              };
            } catch {
              return { path: target, missing: true };
            }
          })(),
          paths: filePolicyContext(
            context.workspace,
            tool === "shell" ? undefined : a?.path,
          ),
        }),
      )
      .digest("hex");
  }
  async authorize(
    botId: string,
    runId: string,
    tool: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<AuthorizationReceipt> {
    signal?.throwIfAborted();
    args = structuredClone(args);
    const decision = () => this.policy(botId, runId, tool, args);
    const policy = decision();
    if (policy.effect === "deny") denyOperation(policy);
    const fingerprint = this.permissionFingerprint(botId, runId, tool, args);
    const receipt: AuthorizationReceipt = {
      fingerprint,
      reason: policy.reason,
      dangerousCommand: policy.dangerousCommand,
      matchedRuleIds: policy.matchedRuleIds,
    };
    if (policy.effect === "allow") return receipt;
    signal?.throwIfAborted();
    const ownerJob = this.deps.db.jobs.list({ runId })[0];
    const approval: Approval = {
      impact: classifyAction(tool, args as Record<string, unknown>).impact,
      jobId: ownerJob?.id,
      sessionId: ownerJob?.sessionId,
      workContextId: this.deps.tasks.runs.records.get(runId)?.workContextId,
      location: this.deps.workLocation(this.deps.bot(botId), runId),
      reason: policy.reason,
      dangerousCommand: policy.dangerousCommand,
      matchedRuleIds: policy.matchedRuleIds,
      rememberAllowed:
        !["remember", "update_memory", "manage_memory"].includes(tool) &&
        ![
          "dangerous-command",
          "unanalyzable-command",
          "critical-action",
          "unknown-effect",
        ].includes(policy.reason),
      fingerprint,
      id: randomUUID(),
      botId,
      runId,
      tool,
      args,
      status: "pending",
      createdAt: now(),
    };
    this.deps.db.approvals.put(approval);

    const job = this.deps.db.jobs
      .list()
      .find(
        (j) => j.botId === botId && j.runId === runId && j.status === "running",
      );
    const resume =
      job && this.deps.execution.jobControllers.has(job.id)
        ? this.deps.execution.slots.suspend(job.id)
        : async () => {};
    const approved = await new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        this.deps.execution.pending.delete(approval.id);
        this.deps.db.approvals.put({ ...approval, status: "expired" });
        this.deps.notify(botId);
        reject(new Error("核准等待已取消。"));
      };
      this.deps.execution.pending.set(approval.id, (value) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.deps.notify(botId);
      if (signal?.aborted) abort();
    }).finally(resume);
    if (!approved)
      throw new Error("使用者拒絕這項操作，請改用其他方式或詢問使用者。");
    signal?.throwIfAborted();
    if (fingerprint !== this.permissionFingerprint(botId, runId, tool, args))
      return this.authorize(botId, runId, tool, args, signal);
    const current = decision();
    if (current.effect === "deny") denyOperation(current);
    return receipt;
  }
  decide(id: string, input: Record<string, unknown>) {
    const approval =
      this.deps.db.approvals.get(id) || fail("找不到核准要求。", 404);
    if (approval.status !== "pending" || !this.deps.execution.pending.has(id))
      fail("這項核准已失效。", 409);
    const approved = input.approved === true;
    this.deps.db.approvals.put({
      ...approval,
      status: approved ? "approved" : "denied",
    });
    if (
      approved &&
      input.remember === true &&
      approval.rememberAllowed !== false &&
      approval.fingerprint ===
        this.permissionFingerprint(
          approval.botId,
          approval.runId,
          approval.tool,
          approval.args,
        )
    )
      this.deps.db.put("session-allow", {
        version: 1,
        ownerBotId: approval.botId,
        scopeKey: this.permissionContext(approval.botId, approval.runId)
          .scopeKey,
        id: randomUUID(),
        key: this.approvalKey(
          approval.botId,
          approval.runId,
          approval.tool,
          approval.args,
        ),
        tool: approval.tool,
        botId: approval.botId,
        args: approval.args,
      });
    this.deps.execution.pending.get(id)!(approved);
    this.deps.execution.pending.delete(id);
    this.deps.notify(approval.botId);
  }
}
