import { useSyncExternalStore } from "react";

export type Locale = "zh-Hant" | "en";
let locale: Locale = "zh-Hant";
const listeners = new Set<() => void>();
export const getSettingsLocale = () => locale;
export function setSettingsLocale(next: Locale) {
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const dictionary = {
  settings: ["設定與工具", "Settings & tools"],
  general: ["執行與語言", "Execution & language"],
  models: ["模型連線", "Model connections"],
  connectors: ["連接器", "Connectors"],
  skills: ["技能", "Skills"],
  templates: ["Bot 範本", "Bot templates"],
  approvals: ["自動核准", "Auto approvals"],
  permissions: ["權限規則", "Permission rules"],
  save: ["儲存變更", "Save changes"],
  saving: ["儲存中…", "Saving…"],
  saved: ["已儲存變更", "Changes saved"],
  loading: ["載入中…", "Loading…"],
  retry: ["重新載入", "Reload"],
  cancel: ["取消", "Cancel"],
  name: ["名稱", "Name"],
  description: ["角色與工作方式", "Role & instructions"],
  model: ["使用的模型", "Model"],
  defaultModel: ["跟隨預設模型", "Use default model"],
  replacement: [
    "原模型已停用，請選擇可用的替代模型。",
    "The previous model is disabled. Select an available replacement.",
  ],
  selectModel: ["選擇替代模型", "Select a replacement model"],
  createBot: ["建立 Bot", "Create Bot"],
  selectedSkills: ["可使用的技能", "Available skills"],
  selectedConnectors: ["可使用的連接器", "Available connectors"],
  noSkills: [
    "尚無共用技能。可到設定新增。",
    "No shared skills. Add skills in Settings.",
  ],
  noConnectors: [
    "尚無連接器。可到設定新增。",
    "No connectors. Add connectors in Settings.",
  ],
  disabled: ["已停用", "Disabled"],
  mode: ["工作區權限", "Workspace access"],
  workspace: ["工作區讀寫", "Read and write workspace"],
  readonly: ["唯讀", "Read only"],
  accessHelp: [
    "唯讀模式禁止本機寫入、命令執行及 MCP 呼叫。允許規則不會覆寫這些限制。",
    "Read-only mode blocks local writes, command execution and MCP calls. Allow rules do not override these restrictions.",
  ],
  noneSelected: [
    "未勾選即不提供給此 Bot。",
    "Unchecked items are unavailable to this Bot.",
  ],
  locale: ["介面語言", "Interface language"],
  execution: ["全域執行控制", "Global execution controls"],
  executionHelp: [
    "執行上限套用到後續任務；核准模式與權限規則於下次工具操作生效。",
    "Execution limits apply to subsequent tasks; approval mode and permission rules apply at the next tool operation.",
  ],
  conflict: [
    "設定已由其他視窗更新。請重新載入後再編輯。你的輸入仍保留。",
    "Settings changed in another window. Reload before editing again. Your inputs are preserved.",
  ],
  unsaved: ["尚未儲存", "Unsaved changes"],
  addRule: ["新增規則", "Add rule"],
  remove: ["移除", "Remove"],
  noRules: ["尚無自訂規則。", "No custom rules."],
  templateHelp: [
    "從現有範本建立 Bot，或將 Bot 設定儲存為範本。",
    "Create a Bot from a template, or save a Bot configuration as a template.",
  ],
  noTemplates: [
    "尚無範本。可從 Bot 設定儲存一份。",
    "No templates yet. Save one from a Bot profile.",
  ],
  saveTemplate: ["儲存為範本", "Save as template"],
  templateSaved: ["範本已儲存", "Template saved"],
  templateCreated: ["已從範本建立 Bot", "Bot created from template"],
} satisfies Record<string, readonly [string, string]>;
export function settingsText(key: keyof typeof dictionary) {
  return dictionary[key][locale === "en" ? 1 : 0];
}
export function useSettingsLocale() {
  return useSyncExternalStore(
    subscribe,
    () => locale,
    () => "zh-Hant" as Locale,
  );
}
