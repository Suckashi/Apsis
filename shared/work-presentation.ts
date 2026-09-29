import type { Approval } from "./product.ts";
import {
  operationLabel,
  type RunSummary,
  type TaskProgress,
} from "./task-progress.ts";
import type { ToolOperation } from "./types.ts";

export type WorkPhase =
  | NonNullable<TaskProgress["phase"]>
  | "ready"
  | "unavailable"
  | "disconnected";

/** Connection, model availability and execution are independent facts. */
export function currentWorkStatus(input: {
  connected: boolean;
  modelIssue?: string;
  approvalCount?: number;
  active?: RunSummary;
  running?: boolean;
  queued?: boolean;
}) {
  const active = input.active?.status === "running" ? input.active : undefined;
  const progress = active?.progress;
  const awaitingApproval =
    !!input.approvalCount ||
    !!progress?.approvalBotId ||
    progress?.phase === "approval";
  const phase: WorkPhase = awaitingApproval
    ? "approval"
    : active || input.running
      ? progress?.phase || "waiting"
      : input.queued
        ? "queued"
        : input.modelIssue
          ? "unavailable"
          : !input.connected
            ? "disconnected"
            : "ready";
  const labels: Record<WorkPhase, string> = {
    approval: "等待你的核准",
    working: "正在執行操作",
    delegating: "Bot 協作中",
    queued: "排隊中",
    waiting: "等待模型回應",
    reply: "正在產生回覆",
    ready: "隨時可以交辦任務",
    unavailable: "模型需要設定",
    disconnected: "連線中斷，正在重新連線",
  };
  return {
    connection: input.connected
      ? ("connected" as const)
      : ("disconnected" as const),
    availability: input.modelIssue
      ? ("unavailable" as const)
      : ("ready" as const),
    phase,
    label:
      phase === "unavailable"
        ? input.modelIssue!
        : active && !awaitingApproval && progress?.label
          ? progress.label
          : labels[phase],
    detail: !input.connected
      ? "目前顯示最後收到的狀態，任務可能仍在執行。"
      : input.modelIssue,
    attention: awaitingApproval || !!input.modelIssue,
  };
}

/** Count affected work items once, then display only the highest priority. */
export function attentionSummary(
  items: {
    approvalCount?: number;
    needsInput?: boolean;
    failed?: boolean;
    running?: boolean;
    unread?: boolean;
  }[],
) {
  const attention = items.filter(
    (item) => !!item.approvalCount || item.needsInput || item.failed,
  ).length;
  if (attention)
    return { kind: "attention" as const, count: attention, label: "需處理" };
  const running = items.filter((item) => item.running).length;
  if (running)
    return { kind: "running" as const, count: running, label: "執行中" };
  const unread = items.filter((item) => item.unread).length;
  if (unread) return { kind: "unread" as const, count: unread, label: "未讀" };
  return { kind: "idle" as const, count: 0, label: "" };
}

/** A finished model turn is not evidence that a task or its tests succeeded. */
export function runOutcome(summary: RunSummary) {
  const quiet =
    summary.status === "completed" &&
    !summary.warning &&
    !summary.operationCount &&
    !summary.delegationCount &&
    !summary.botCount;
  const labels: Record<RunSummary["status"], string> = {
    running: "執行中",
    completed: "回覆結束",
    failed: "執行失敗",
    cancelled: "已取消",
    interrupted: "已中斷",
  };
  return {
    kind: summary.status,
    label: quiet ? "回覆紀錄" : labels[summary.status],
    quiet,
    verification:
      summary.warning ||
      summary.status === "failed" ||
      summary.status === "interrupted"
        ? ("needs-review" as const)
        : ("unverified" as const),
  };
}

export function operationGroupLabel(
  operations: Pick<ToolOperation, "name" | "target">[],
) {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const label = operationLabel({ name: operation.name });
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

export function approvalPresentation(
  approval: Pick<Approval, "tool" | "args" | "location">,
) {
  const args =
    approval.args && typeof approval.args === "object"
      ? (approval.args as Record<string, unknown>)
      : {};
  const value = (...keys: string[]) =>
    keys
      .map((key) => args[key])
      .find((entry) => typeof entry === "string" && entry.trim()) as
      | string
      | undefined;
  const target =
    value(
      "file_path",
      "path",
      "filename",
      "url",
      "command",
      "cmd",
      "query",
      "botId",
      "bot_id",
      "connectorId",
    ) || approval.location?.path;
  const impact =
    /^(write_file|edit_file|apply_patch|fileChange|scratch_write_file|scratch_edit_file)$/.test(
      approval.tool,
    )
      ? "這項操作會修改檔案。"
      : /^(shell|commandExecution)$/.test(approval.tool)
        ? "這項操作會執行指令；請確認指令與工作位置。"
        : /^(read_file|read_image|list_files|scratch_read_file|scratch_ls|scratch_glob|scratch_grep)$/.test(
              approval.tool,
            )
          ? "這項操作會讀取指定的內容。"
          : /^(publish_file|create_document)$/.test(approval.tool)
            ? "這項操作會建立或發布成果檔案。"
            : /^(browser|webSearch|call_connector|mcpToolCall)$/.test(
                  approval.tool,
                )
              ? "這項操作會存取外部服務，實際動作請查看技術詳情。"
              : "請確認操作對象與參數後再核准。";
  return { action: operationLabel({ name: approval.tool }), target, impact };
}
