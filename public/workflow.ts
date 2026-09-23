import type { Mode, Status } from "../shared/types.ts";

export function modeRequirement(
  mode: Mode,
  status: Partial<Status>,
  allowWrites: boolean,
): string | null {
  if ((mode === "pi" || mode === "hybrid") && !status.piReady)
    return "先設定 Talaria 的模型（雲端 API 或本機 Ollama），就能開始真實任務。";
  if ((mode === "hermes" || mode === "hybrid") && !status.hermesReady)
    return "先連接 Hermes gateway，才能使用這個回覆模式。";
  if (mode === "hermes" && !allowWrites)
    return "Hermes 會在遠端執行工具，請先在任務選項開啟「允許修改與保存」。";
  return null;
}

// Browser storage can be disabled or full. Neither should prevent a task from running.
export const preferences = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Optional persistence. */
    }
  },
};
