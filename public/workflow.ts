import type { Mode, Status } from "../shared/types.ts";

export function modeRequirement(
  mode: Mode,
  status: Partial<Status>,
): string | null {
  if (mode === "pi" && !status.piReady)
    return "先設定 Apsis 的模型（雲端 API 或本機 Ollama），就能開始真實任務。";
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
