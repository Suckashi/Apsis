import { createHash } from "node:crypto";
import { ToolExecutionError } from "./evidence.ts";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pathKey = (value: string) =>
  value
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(?:\.\/)+/, "");

function commandTarget(command: string) {
  // This is only a retry identity, never an execution or authorization parser.
  const withoutCd = command
    .trim()
    .replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/, "");
  const tokens: string[] =
    withoutCd.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|]+/g) || [];
  while (/^[\w]+=/u.test(tokens[0] || "")) tokens.shift();
  const executable = pathKey(tokens.shift() || "")
    .split("/")
    .at(-1)!
    .replace(/\.exe$/i, "");
  const clean = (value: string) =>
    pathKey(value.replace(/^(['"])(.*)\1$/, "$2"));
  if (
    /^(node|python[\d.]*|ruby|perl|bash|sh|pwsh|powershell)$/.test(executable)
  ) {
    const inline =
      tokens.some(
        (token) =>
          ["-e", "--eval", "-c", "-command", "-encodedcommand", "-"].includes(
            token.toLowerCase(),
          ) || /^-[il]*c$/.test(token),
      ) || /<<\s*\S/.test(withoutCd);
    if (inline) return { target: `${executable}:inline`, exactRecovery: true };
    const files = tokens.filter((token) => !token.startsWith("-")).map(clean);
    return {
      target: `${executable}:${tokens.includes("--test") ? "test:" : ""}${files.join(" ")}`,
      exactRecovery: false,
    };
  }
  if (/^(npm|pnpm|yarn|bun|git)$/.test(executable)) {
    const verbs = tokens
      .filter((token) => !token.startsWith("-"))
      .slice(0, tokens[0] === "run" ? 2 : 1);
    return { target: `${executable}:${verbs.join(":")}`, exactRecovery: false };
  }
  return {
    target: `${executable}:${clean(tokens.find((token) => !token.startsWith("-")) || "")}`,
    exactRecovery: true,
  };
}

function identity(name: string, args: Record<string, unknown>) {
  if (name === "shell" || name === "workspace_shell") {
    const command = typeof args.command === "string" ? args.command : "";
    const { target, exactRecovery } = commandTarget(command);
    return {
      scope: digest(["shell", target]),
      recovery: exactRecovery ? digest(command.trim()) : undefined,
    };
  }
  const target = ["path", "file_path", "id", "botId", "tool", "action"]
    .map((key) => args[key])
    .find((value) => typeof value === "string");
  return {
    scope: digest([name, typeof target === "string" ? pathKey(target) : ""]),
    recovery: undefined,
  };
}

function failureCategory(message: string, error?: unknown): string {
  if (
    /虛擬檔案路徑|工作區路徑無效|invalid.{0,20}path|path.{0,20}(invalid|relative)|路徑必須/i.test(
      message,
    )
  )
    return "invalid-path";
  if (/拒絕|未允許|permission|access denied|EACCES|EPERM/i.test(message))
    return "permission-denied";
  if (
    /舊文字|exactly once|not unique|multiple matches|not found in.*file/i.test(
      message,
    )
  )
    return "edit-target-mismatch";
  if (
    /syntaxerror|syntax error|unexpected token|unterminated/i.test(
      message +
        (error instanceof ToolExecutionError
          ? error.evidence.output || ""
          : ""),
    )
  )
    return "syntax";
  if (/逾時|timed? out|timeout/i.test(message)) return "timeout";
  if (/assertion|斷言|驗證.*失敗|檢查.*失敗|expected.*received/i.test(message))
    return "check-failed";
  if (
    error instanceof ToolExecutionError &&
    typeof error.evidence.exitCode === "number" &&
    error.evidence.exitCode !== 0
  )
    return "exit-nonzero";
  if (
    /命令結束碼[:：]\s*-?\d+|exit(?:ed)?(?: with)?(?: status| code)?[:： ]+\d+/i.test(
      message,
    )
  )
    return "exit-nonzero";
  if (/ENOENT|not found|找不到|不存在/i.test(message)) return "not-found";
  if (
    /validation|schema|參數|expected|invalid.*(input|argument)/i.test(message)
  )
    return "arguments";
  // Keep unrelated failures separate without retaining full output or arguments.
  const normalized = message
    .split("\n")[0]
    .toLowerCase()
    .replace(/^tool failed:\s*/, "")
    .replace(/(['"`]).*?\1/g, "<value>")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return `other:${digest(normalized)}`;
}

export class ToolFailureLoopError extends Error {
  constructor() {
    super(
      "同一操作持續失敗 3 次，已停止自動重試，需要你處理。已完成的變更與操作紀錄會保留；請檢查失敗原因後重新交辦。",
    );
    this.name = "ToolFailureLoopError";
  }
}

/** Run-local, monotonic once stopped; success must match the failed operation. */
export class ToolFailureGuard {
  private failures = new Map<
    string,
    { count: number; scope: string; recoveries: Set<string | undefined> }
  >();
  private stopped?: ToolFailureLoopError;
  assertActive() {
    if (this.stopped) throw this.stopped;
  }
  failure(
    name: string,
    args: Record<string, unknown>,
    message: string,
    error?: unknown,
  ) {
    this.assertActive();
    const { scope, recovery } = identity(name, args);
    const key = digest([scope, failureCategory(message, error)]);
    const item = this.failures.get(key) || {
      count: 0,
      scope,
      recoveries: new Set<string | undefined>(),
    };
    item.count++;
    item.recoveries.add(recovery);
    this.failures.set(key, item);
    if (item.count >= 3) this.stopped = new ToolFailureLoopError();
    return item.count;
  }
  success(name: string, args: Record<string, unknown>) {
    this.assertActive();
    const { scope, recovery } = identity(name, args);
    for (const [key, item] of this.failures)
      if (item.scope === scope && item.recoveries.has(recovery))
        this.failures.delete(key);
  }
}
