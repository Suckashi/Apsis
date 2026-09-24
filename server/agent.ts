import type { RunResult } from "../shared/types.ts";
import type { RunOptions } from "./runtime.ts";

/** Product orchestration stays in ProductService; providers select a runtime. */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  if (options.env?.MODEL_PROVIDER === "codex") {
    if (!options.codex) throw new Error("Codex 執行服務尚未初始化。");
    return options.codex.run(options);
  }
  return (await import("./engines/deep.ts")).runDeep(options);
}
