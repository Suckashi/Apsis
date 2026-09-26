import {
  elapsedLabel,
  operationLabel,
  taskStatusLabels,
} from "../shared/task-progress.ts";
import type { ToolOperation } from "../shared/types.ts";
import type { Locale } from "./settings-locale.ts";

const english = new Map<string, string>([
  ["訊息已送達", "Message delivered"],
  ["正在處理設定操作…", "Updating settings…"],
  ["正在取得可用模型…", "Fetching available models…"],
  ["正在處理供應商操作…", "Processing provider request…"],
  ["重新連線", "Reconnecting"],
  ["需要你處理", "Action needed"],
  ["等待模型", "Waiting"],
  ["回覆中", "Replying"],
  ["Bot 協作中", "Collaborating"],
  ["核准或拒絕後，任務才會繼續。", "Approve or deny the request to continue."],
  [
    "目前顯示最後收到的狀態，任務可能仍在執行。",
    "Showing the last known status. The task may still be running.",
  ],
  [
    "暫未收到新進度；你可以繼續等待，或停止任務。",
    "No recent progress received. You can keep waiting or stop the task.",
  ],
  ["距上次進度", "Since last update"],
  [
    "等待協作 Bot 開始後會自動更新。",
    "Updates will resume when the collaborating Bot starts.",
  ],
  ["回覆會持續出現在對話中。", "The reply is appearing in the conversation."],
  [
    "進度會隨模型與工具回報更新，你可以隨時補充指示。",
    "Progress follows model and tool updates. You can add instructions at any time.",
  ],
  ["查看結果", "View result"],
  [
    "尚未收到工具操作，模型回報後會顯示在這裡。",
    "No tool activity yet. Operations will appear here as they are reported.",
  ],
  ["正在載入對話", "Loading conversation"],
  ["正在送出補充指示…", "Sending instructions…"],
  ["正在送出訊息…", "Sending message…"],
  ["補充指示已送達", "Instructions delivered"],
  ["已排入下一個任務", "Added to the task queue"],
  ["訊息已送達，正在準備任務", "Message delivered. Preparing the task"],
  ["正在上傳附件", "Uploading attachment"],
  [
    "附件已加入，可以傳送訊息",
    "Attachments added. Your message is ready to send",
  ],
  [
    "即時連線中斷，正在重新連線。恢復後會自動同步。",
    "Live updates disconnected. Reconnecting and syncing automatically.",
  ],
  ["正在連接即時更新…", "Connecting to live updates…"],
  ["回到最新訊息", "Jump to latest message"],
  [
    "正在停止任務，等待執行中的操作結束…",
    "Stopping task. Waiting for active operations to finish…",
  ],
  ["正在準備任務，等待模型回應…", "Preparing task. Waiting for the model…"],
  ["排隊中", "Queued"],
  ["執行中", "Running"],
  ["已完成", "Completed"],
  ["失敗", "Failed"],
  ["已取消", "Cancelled"],
  ["已中斷", "Interrupted"],
  ["結果不明", "Unknown outcome"],
  ["已結束", "Finished"],
  ["等待模型回應", "Waiting for model response"],
  ["正在產生回覆", "Generating reply"],
  ["等待你的核准", "Waiting for your approval"],
  ["連線中斷，正在重新連線", "Disconnected; reconnecting"],
  ["目前任務進度", "Current task progress"],
  ["前往核准", "Review approval"],
  ["收合過程", "Hide details"],
  ["查看過程", "View details"],
  ["工具：", "Tool: "],
  ["輸出過長，紀錄已截短。", "Output was too long and has been truncated."],
  ["交給", "Assigned to"],
  ["來自", "From"],
  ["結果", "Result"],
  ["開啟 Bot 對話", "Open Bot chat"],
  ["此 Bot 已無法開啟", "This Bot is no longer available"],
  ["較早協作紀錄", "Earlier collaborations"],
  ["顯示更早紀錄", "Show earlier records"],
  ["任務紀錄", "Task history"],
  ["重新載入", "Reload"],
  ["正在讀取紀錄…", "Loading history…"],
  [
    "無法讀取任務紀錄，請重試。",
    "Unable to load task history. Please try again.",
  ],
  [
    "這次任務沒有工具操作或 Bot 協作。",
    "No tool operations or Bot collaborations for this task.",
  ],
  ["原始活動紀錄", "Raw activity log"],
  ["有操作結果不明", "Some operation outcomes are unknown"],
  ["有操作失敗", "Some operations failed"],
  ["讀取文件", "Read file"],
  ["讀取圖片", "Read image"],
  ["查看檔案", "List files"],
  ["寫入文件", "Write file"],
  ["編輯文件", "Edit file"],
  ["修改檔案", "Modify files"],
  ["執行指令", "Run command"],
  ["操作瀏覽器", "Use browser"],
  ["搜尋網路", "Search web"],
  ["尋找協作 Bot", "Find collaborating Bots"],
  ["交辦任務", "Delegate task"],
  ["發布成果", "Publish file"],
  ["建立文件", "Create document"],
  ["查詢技能", "List skills"],
  ["讀取技能", "Read skill"],
  ["儲存技能", "Save skill"],
  ["查詢歷史", "Search history"],
  ["儲存記憶", "Save memory"],
  ["更新記憶", "Update memory"],
  ["建立排程", "Create schedule"],
  ["使用連接服務", "Use connector"],
  ["使用工具", "Use tool"],
]);

export function taskText(locale: Locale, text: string) {
  return locale === "en" ? (english.get(text) ?? text) : text;
}

export function taskStatus(
  locale: Locale,
  status: keyof typeof taskStatusLabels,
) {
  return taskText(locale, taskStatusLabels[status]);
}

// Only exact server-owned labels are translated. Never replace substrings in
// arbitrary model progress, commands, filenames, user prompts, or tool output.
export function taskProgress(locale: Locale, text: string) {
  if (locale !== "en") return text;
  if (text.startsWith("正在")) {
    const action = text.slice(2);
    if (english.has(action)) return `${english.get(action)}…`;
  }
  return taskText(locale, text);
}

export function taskWarning(locale: Locale, text: string) {
  const count = /^(\d+) 項協作未成功$/.exec(text);
  return locale === "en" && count
    ? `${count[1]} collaboration${count[1] === "1" ? "" : "s"} did not succeed`
    : taskText(locale, text);
}

export function taskOperation(
  locale: Locale,
  operation: Pick<ToolOperation, "name" | "target">,
) {
  const label = operationLabel(operation);
  const prefix = operationLabel({ name: operation.name });
  return taskText(locale, prefix) + label.slice(prefix.length);
}

export function taskElapsed(
  locale: Locale,
  start: string,
  end: string | number = Date.now(),
) {
  const label = elapsedLabel(start, end);
  return locale === "en"
    ? label.replace(" 分", "m").replace(" 秒", "s")
    : label;
}

export function taskCount(
  locale: Locale,
  count: number,
  kind: "operations" | "bots" | "completed" | "records",
) {
  if (locale === "zh-Hant")
    return `${count} ${{ operations: "項操作", bots: "位 Bot 協作", completed: "位已完成", records: "項" }[kind]}`;
  if (kind === "completed") return `${count} completed`;
  if (kind === "bots")
    return `${count} Bot${count === 1 ? "" : "s"} collaborating`;
  return `${count} ${kind === "operations" ? "operation" : "record"}${count === 1 ? "" : "s"}`;
}

export function taskEarlier(locale: Locale, remaining: number) {
  return locale === "en"
    ? `Show earlier records (${remaining} remaining)`
    : `顯示更早紀錄（還有 ${remaining} 筆）`;
}
