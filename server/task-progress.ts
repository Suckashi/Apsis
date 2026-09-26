import type { Approval, Bot, Job } from "../shared/product.ts";
import { createHash } from "node:crypto";
import type { TaskRun } from "../shared/types.ts";
import {
  operationLabel,
  type DelegationRecord,
  type RunSummary,
  type TaskProgress,
} from "../shared/task-progress.ts";

export function taskPresentation(
  bot: Bot,
  runs: TaskRun[],
  jobs: Job[],
  bots: Bot[],
  approvals: Approval[],
) {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const runsById = new Map(runs.map((r) => [r.id, r]));
  const jobsByRun = new Map(
    jobs.filter((j) => j.runId).map((j) => [j.runId!, j]),
  );
  const botsById = new Map(bots.map((b) => [b.id, b]));
  const pending = approvals.filter((a) => a.status === "pending");
  function belongs(job: Job, parent: Job) {
    if (job.id === parent.id) return !!job.delegatedBy;
    const seen = new Set<string>();
    let current: Job | undefined = job;
    while (current?.parentJobId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentJobId === parent.id) return true;
      current = jobsById.get(current.parentJobId);
    }
    // The root link is reliable only for the actual root, never for sibling runs.
    return !parent.delegatedBy && job.rootJobId === parent.id;
  }
  function related(run: TaskRun) {
    const parent = jobsByRun.get(run.id);
    return parent
      ? jobs.filter((j) => j.delegatedBy && belongs(j, parent))
      : [];
  }
  function ownProgress(run: TaskRun): TaskProgress {
    const approval = pending.find((a) => a.runId === run.id);
    if (approval)
      return {
        phase: "approval",
        label: "等待你的核准",
        updatedAt: approval.createdAt,
        approvalBotId: approval.botId,
      };
    const active = run.operations.filter((o) => o.status === "started");
    const operation = active.at(-1);
    if (operation)
      return {
        phase: "working",
        label: `正在${operationLabel(operation)}${active.length > 1 ? `（另有 ${active.length - 1} 項操作）` : ""}`,
        updatedAt: operation.startedAt,
      };
    const lastOperationAt = run.operations.reduce((latest, item) => {
      const at = item.endedAt || item.startedAt;
      return at > latest ? at : latest;
    }, run.createdAt);
    if (run.progress && run.progress.updatedAt >= lastOperationAt)
      return {
        phase: run.progress.kind === "reply" ? "reply" : "working",
        label:
          run.progress.kind === "reply"
            ? "正在產生回覆"
            : run.progress.text || "等待模型回應",
        updatedAt: run.progress.updatedAt,
      };
    return {
      phase: "waiting",
      label: "等待模型回應",
      updatedAt: lastOperationAt,
    };
  }
  function delegation(job: Job): DelegationRecord {
    const outgoing = job.botId !== bot.id;
    const peerId = outgoing ? job.botId : job.delegatedBy!;
    const run = job.runId ? runsById.get(job.runId) : undefined;
    return {
      ...job,
      outgoing,
      peerId,
      targetName: botsById.get(job.botId)?.name || "已刪除的 Bot",
      peerName:
        botsById.get(peerId)?.name ||
        (outgoing ? "已刪除的 Bot" : job.delegatedByName || "已刪除的 Bot"),
      waitingApproval: pending.some(
        (a) => a.runId === job.runId && a.botId === job.botId,
      ),
      progress: run?.status === "running" ? ownProgress(run) : undefined,
    };
  }
  function progress(run: TaskRun, children: Job[]): TaskProgress {
    const approval = pending.find(
      (a) =>
        a.runId === run.id ||
        children.some((j) => j.runId === a.runId && j.botId === a.botId),
    );
    if (approval)
      return {
        phase: "approval",
        label:
          approval.botId === bot.id
            ? "等待你的核准"
            : `${botsById.get(approval.botId)?.name || "協作 Bot"} 等待你的核准`,
        updatedAt: approval.createdAt,
        approvalBotId: approval.botId,
      };
    const child =
      children.find((j) => j.botId !== bot.id && j.status === "running") ||
      children.find((j) => j.botId !== bot.id && j.status === "queued");
    // Prefer real local work when tools are running concurrently with delegation.
    if (
      child &&
      !run.operations.some(
        (o) => o.status === "started" && o.name !== "delegate_task",
      )
    ) {
      const name = botsById.get(child.botId)?.name || "協作 Bot";
      const childRun = child.runId ? runsById.get(child.runId) : undefined;
      const current = childRun ? ownProgress(childRun) : undefined;
      return {
        phase: child.status === "queued" ? "queued" : "delegating",
        label:
          child.status === "queued"
            ? `等待 ${name} 開始任務`
            : `${name}：${current?.label || "等待模型回應"}`,
        updatedAt: current?.updatedAt || child.createdAt,
      };
    }
    return ownProgress(run);
  }
  const ownRuns = runs
    .filter((r) => r.sessionId === bot.sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const associations = new Map(ownRuns.map((r) => [r.id, related(r)]));
  const summaries: RunSummary[] = ownRuns.map((run) => {
    const children = associations.get(run.id)!;
    const peerIds = new Set(
      children.map((j) => (j.botId === bot.id ? j.delegatedBy! : j.botId)),
    );
    const completedBotCount = [...peerIds].filter((id) =>
      children
        .filter((j) => (j.botId === bot.id ? j.delegatedBy : j.botId) === id)
        .every((j) => j.status === "completed"),
    ).length;
    const failed = children.filter((j) =>
      ["failed", "interrupted", "cancelled"].includes(j.status),
    );
    const uncertain = run.operations.some((o) => o.status === "unknown");
    const failedOperations = run.operations.some((o) => o.status === "failed");
    const current =
      run.status === "running" ? progress(run, children) : undefined;
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      endedAt: run.endedAt,
      operationCount: new Set(run.operations.map((o) => o.id)).size,
      delegationCount: children.length,
      botCount: peerIds.size,
      completedBotCount,
      warning: failed.length
        ? `${failed.length} 項協作未成功`
        : uncertain
          ? "有操作結果不明"
          : failedOperations
            ? "有操作失敗"
            : undefined,
      progress: current,
      revision: createHash("sha256")
        .update(
          JSON.stringify([
            run.status,
            run.endedAt,
            run.progress,
            current,
            run.operations.map((o) => [o.id, o.status, o.endedAt]),
            run.activity.length,
            children.map((j) => [
              j.id,
              j.status,
              j.runId,
              j.result?.length,
              j.error,
              j.runId &&
                runsById.get(j.runId)?.operations.map((o) => [o.id, o.status]),
            ]),
            pending.map((a) => a.id),
          ]),
        )
        .digest("hex")
        .slice(0, 20),
    };
  });
  const associated = new Set(
    [...associations.values()].flat().map((j) => j.id),
  );
  return {
    summaries,
    legacy: jobs
      .filter(
        (j) =>
          j.delegatedBy &&
          (j.delegatedBy === bot.id || j.botId === bot.id) &&
          !associated.has(j.id),
      )
      .map(delegation),
    records: (run: TaskRun) => ({
      run,
      delegations: (associations.get(run.id) || []).map(delegation),
    }),
  };
}
