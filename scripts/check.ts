// Retained as a direct Node entry point for contributors.
import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
