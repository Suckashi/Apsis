import type { Mode, Status } from "../shared/types.ts";

export function modeRequirement(
  mode: Mode,
  status: Partial<Status>,
  allowWrites: boolean,
): string | null {
  if ((mode === "pi" || mode === "hybrid") && !status.piReady)
    return "先設定 Pi 的模型與 API key，就能開始真實任務。";
  if ((mode === "hermes" || mode === "hybrid") && !status.hermesReady)
    return "先連接 Hermes gateway，才能使用這個引擎。";
  if (mode === "hermes" && !allowWrites)
    return "Hermes 會在遠端執行工具，請先開啟「允許修改 / 遠端工具」。";
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
