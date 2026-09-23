import type { TaskRun } from "../shared/types.ts";
export const runStatuses: Record<string, string> = {
  running: "執行中",
  completed: "回合結束",
  failed: "失敗",
  cancelled: "已停止",
  interrupted: "服務重啟中斷",
  started: "已開始",
  succeeded: "成功",
  unknown: "結果待確認",
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
export function renderRunEvidence(run: TaskRun) {
  const root = document.createElement("div");
  root.className = "run-evidence";
  root.append(
    node(
      "p",
      `${runStatuses[run.status]} · ${run.project?.name || "預設工作區"}`,
    ),
  );
  if (run.project) root.append(node("small", run.project.path));
  root.append(
    node(
      "p",
      "工具成功表示該操作執行成功；測試是否通過，請查看實際命令與輸出。",
    ),
  );
  if (run.recoveryRunIds?.length)
    root.append(
      node(
        "small",
        `本次已帶入 ${run.recoveryRunIds.length} 次未完成任務的操作紀錄，供模型核對現況。`,
      ),
    );
  if (!run.operations.length) root.append(node("p", "沒有工具操作。"));
  for (const op of run.operations) {
    const detail = document.createElement("details");
    detail.className = "operation-evidence";
    detail.append(
      node(
        "summary",
        `${runStatuses[op.status]} · ${op.name}${op.target ? " · " + op.target : ""}`,
      ),
    );
    if (op.error) detail.append(node("p", op.error));
    const evidence = op.evidence;
    if (evidence?.exitCode !== undefined)
      detail.append(
        node(
          "p",
          `退出碼：${evidence.exitCode === null ? "未取得（可能已部分執行）" : evidence.exitCode}`,
        ),
      );
    for (const [label, text] of [
      ["執行命令", evidence?.command],
      ["修改差異", evidence?.patch],
      ["工具輸出", evidence?.output],
    ]) {
      if (text !== undefined) {
        detail.append(node("strong", label!));
        detail.append(node("pre", text || "（無輸出）"));
      }
    }
    if (evidence?.truncated)
      detail.append(
        node(
          "small",
          "內容較長，這裡只保留部分紀錄；請檢查實際檔案確認完整結果。",
        ),
      );
    if (!evidence) detail.append(node("small", "這項操作未保存詳細輸出。"));
    root.append(detail);
  }
  return root;
}
