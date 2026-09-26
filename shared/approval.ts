/** Shared by persisted tool activity and approval cards; no model-generated text. */
export function approvalReason(
  reason: string | undefined,
  locale: "zh-Hant" | "en",
  command?: string,
): string {
  const reasons: Record<string, [string, string]> = {
    readonly: ["唯讀權限限制", "Read-only permission"],
    rule: ["自訂權限規則", "Custom permission rule"],
    default: ["工具預設核准策略", "Default tool approval policy"],
    "invalid-path": ["無效的工作區路徑", "Invalid workspace path"],
    connector: ["連接器未授權", "Connector not authorized"],
    "dangerous-command": ["命中危險命令規則", "Dangerous command detected"],
    "unanalyzable-command": [
      "無法分析命令，一般核准模式需要確認",
      "Cannot analyze command; manual mode requires approval",
    ],
    "auto-mode": ["不要求核准模式", "Never ask mode"],
    "session-approval": ["本次任務已允許", "Approved for this task"],
    "sensitive-file": ["敏感檔案存取", "Sensitive file access"],
    "git-control": ["Git 控制路徑存取", "Git control path access"],
    "yolo-mode": [
      "需要時詢問模式：自動允許",
      "Ask when needed: automatically allowed",
    ],
    "git-workspace": ["Git 工作區內檔案寫入", "File write in a Git workspace"],
  };
  const label = reasons[reason ?? "default"] ?? reasons.default;
  return label[locale === "en" ? 1 : 0] + (command ? `: ${command}` : "");
}
