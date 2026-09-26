import type { RunResult } from "../shared/types.ts";
import type { RunOptions } from "./runtime.ts";

/** Product orchestration stays in ProductService; all active providers use Deep Agents. */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  rejectLegacyCodex(options);
  return (await import("./engines/deep.ts")).runDeep(options);
}

/** Persisted Codex selections must never fall through to another provider. */
export function rejectLegacyCodex(
  options: Pick<RunOptions, "session"> &
    Partial<Pick<RunOptions, "mode" | "env" | "agent">>,
): void {
  if (
    options.env?.MODEL_PROVIDER === "codex" ||
    options.mode === "codex" ||
    options.session.mode === "codex" ||
    options.session.provider === "codex" ||
    options.session.agent?.provider === "codex" ||
    options.session.agent?.engine === "codex" ||
    options.agent?.provider === "codex" ||
    options.agent?.engine === "codex"
  )
    throw Object.assign(
      new Error(
        "Codex 已停止支援；請明確選擇其他模型連線，不會自動切換供應商。",
      ),
      { status: 400 },
    );
}
