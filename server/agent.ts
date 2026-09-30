import type { RunResult } from "../shared/types.ts";
import type { RunOptions } from "./runtime.ts";
import { runDeep } from "./engines/deep.ts";

export async function runAgent(options: RunOptions): Promise<RunResult> {
  return runDeep(options);
}
