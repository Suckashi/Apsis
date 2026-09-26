import type { Job } from "./product.ts";
import type { TaskRun, ToolOperation } from "./types.ts";

export const taskStatusLabels = {
  queued: "排隊中",
  running: "執行中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已取消",
  interrupted: "已中斷",
  started: "執行中",
  succeeded: "已完成",
  unknown: "結果不明",
} as const;

const toolLabels: Record<string, string> = {
  read_file: "讀取文件",
  read_image: "讀取圖片",
  list_files: "查看檔案",
  write_file: "寫入文件",
  edit_file: "編輯文件",
  apply_patch: "修改檔案",
  shell: "執行指令",
  browser: "操作瀏覽器",
  webSearch: "搜尋網路",
  list_bots: "尋找協作 Bot",
  delegate_task: "交辦任務",
  publish_file: "發布成果",
  create_document: "建立文件",
  list_skills: "查詢技能",
  read_skill: "讀取技能",
  save_skill: "儲存技能",
  search_history: "查詢歷史",
  remember: "儲存記憶",
  update_memory: "更新記憶",
  create_routine: "建立排程",
  call_connector: "使用連接服務",
  commandExecution: "執行指令",
  fileChange: "修改檔案",
  mcpToolCall: "使用工具",
};

export function operationLabel(
  operation: Pick<ToolOperation, "name" | "target">,
) {
  const label = toolLabels[operation.name] || "使用工具";
  // Commands and opaque IDs belong in the expanded record, not the status bar.
  const showTarget =
    /^(read_file|read_image|write_file|edit_file|publish_file|list_files)$/.test(
      operation.name,
    );
  const target = showTarget
    ? operation.target?.split(/[\\/]/).at(-1)
    : undefined;
  return target ? `${label} ${target}` : label;
}

export interface TaskProgress {
  phase?:
    | "waiting"
    | "working"
    | "reply"
    | "approval"
    | "delegating"
    | "queued";
  label: string;
  updatedAt: string;
  approvalBotId?: string;
}

export interface DelegationRecord extends Job {
  targetName: string;
  peerId: string;
  peerName: string;
  outgoing: boolean;
  waitingApproval: boolean;
  progress?: TaskProgress;
}

export interface RunSummary {
  id: string;
  status: TaskRun["status"];
  createdAt: string;
  endedAt?: string;
  operationCount: number;
  botCount: number;
  completedBotCount: number;
  delegationCount: number;
  warning?: string;
  progress?: TaskProgress;
  revision: string;
}

export interface RunRecord {
  run: TaskRun;
  delegations: DelegationRecord[];
}

export function elapsedLabel(start: string, end: string | number = Date.now()) {
  const seconds = Math.max(
    0,
    Math.floor(
      ((typeof end === "number" ? end : Date.parse(end)) - Date.parse(start)) /
        1000,
    ),
  );
  if (!Number.isFinite(seconds)) return "—";
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
