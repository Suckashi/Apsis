import { t, translateServerText } from "./i18n.ts";
import type { TaskRun } from "../shared/types.ts";
export const runStatuses: Record<string, string> = {
  running: t("執行中"),
  completed: t("回合結束"),
  failed: t("失敗"),
  cancelled: t("已停止"),
  interrupted: t("服務重啟中斷"),
  started: t("已開始"),
  succeeded: t("成功"),
  unknown: t("結果待確認"),
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
      `${runStatuses[run.status]} · ${run.project && run.project.id !== "workspace" ? run.project.name : t("預設工作區")}`,
    ),
  );
  if (run.project) root.append(node("small", run.project.path));
  root.append(
    node(
      "p",
      t("工具成功表示該操作執行成功；測試是否通過，請查看實際命令與輸出。"),
    ),
  );
  if (run.recoveryRunIds?.length)
    root.append(
      node(
        "small",
        t(
          "本次已帶入 {0} 次未完成任務的操作紀錄，供模型核對現況。",
          run.recoveryRunIds.length,
        ),
      ),
    );
  if (!run.operations.length) root.append(node("p", t("沒有工具操作。")));
  for (const op of run.operations) {
    const detail = document.createElement("details");
    detail.className = "operation-evidence";
    detail.append(
      node(
        "summary",
        `${runStatuses[op.status]} · ${op.name}${op.target ? " · " + op.target : ""}`,
      ),
    );
    if (op.error) detail.append(node("p", translateServerText(op.error)));
    const evidence = op.evidence;
    if (evidence?.exitCode !== undefined)
      detail.append(
        node(
          "p",
          t(
            "退出碼：{0}",
            evidence.exitCode === null
              ? t("未取得（可能已部分執行）")
              : evidence.exitCode,
          ),
        ),
      );
    for (const [label, text] of [
      [t("執行命令"), evidence?.command],
      [t("修改差異"), evidence?.patch],
      [t("工具輸出"), evidence?.output],
    ]) {
      if (text !== undefined) {
        detail.append(node("strong", label!));
        detail.append(node("pre", text || t("（無輸出）")));
      }
    }
    if (evidence?.truncated)
      detail.append(
        node(
          "small",
          t("內容較長，這裡只保留部分紀錄；請檢查實際檔案確認完整結果。"),
        ),
      );
    if (!evidence) detail.append(node("small", t("這項操作未保存詳細輸出。")));
    root.append(detail);
  }
  return root;
}
