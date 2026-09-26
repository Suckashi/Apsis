import { spawn, execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { findBash, shellMissing } from "./shell.ts";
import { createTwoFilesPatch } from "diff";
import { Type } from "typebox";
import {
  boundedEvidence,
  evidenceLimit,
  ToolExecutionError,
} from "./evidence.ts";
import type { AgentTool } from "./tools.ts";
import type { ToolOptions } from "./runtime.ts";

const mutations = new Map<string, Promise<unknown>>();
async function serialize<T>(
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = mutations.get(path) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  mutations.set(path, current);
  try {
    return await current;
  } finally {
    if (mutations.get(path) === current) mutations.delete(path);
  }
}

function visibleEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|psmodulepath|lang|lc_all)$/i.test(
        key,
      ),
    ),
  );
}

async function runShell(
  command: string,
  cwd: string,
  timeoutSeconds: number,
  outputLimit: number,
  signal?: AbortSignal,
) {
  const windows = process.platform === "win32";
  signal?.throwIfAborted();
  const executable = findBash();
  if (!executable) throw new Error(shellMissing);
  const env = visibleEnvironment();
  if (windows) {
    const key =
      Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    env[key] = [
      dirname(executable),
      join(dirname(executable), "../usr/bin"),
      env[key],
    ]
      .filter(Boolean)
      .join(";");
  }
  const child = spawn(executable, ["--noprofile", "--norc", "-c", command], {
    cwd,
    env,
    detached: !windows,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let truncated = false;
  const capture = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    truncated ||= output.length + text.length > outputLimit;
    output = (output + text).slice(0, outputLimit);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (!child.pid) return;
    if (windows) {
      const pid = child.pid;
      const fallback = () => {
        if (child.exitCode !== null) return;
        const killer = spawn(
          "taskkill.exe",
          ["/pid", String(pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
        killer.on("exit", (code) => {
          if (code) child.kill();
        });
      };
      // MSYS forks can escape the Windows parent tree; kill the precise Bash
      // process group, including descendants that still own output pipes.
      execFile(
        executable,
        ["--noprofile", "--norc", "-c", "/usr/bin/ps -W"],
        { env, windowsHide: true, timeout: 3000 },
        (error, output) => {
          const row = output
            .split("\n")
            .map((line) => line.trim().split(/\s+/))
            .find((parts) => parts[3] === String(pid));
          const group = row?.[2];
          if (
            error ||
            !group ||
            !/^[1-9]\d*$/.test(group) ||
            row?.[0] !== group
          ) {
            fallback();
            return;
          }
          execFile(
            executable,
            ["--noprofile", "--norc", "-c", `kill -KILL -- -${group}`],
            { env, windowsHide: true, timeout: 3000 },
            (error) => {
              if (error) fallback();
            },
          );
        },
      );
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill();
      }
    }
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutSeconds * 1000);
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const evidence = boundedEvidence(
      { command, output, exitCode, truncated },
      outputLimit,
    );
    if (signal?.aborted) throw new ToolExecutionError("命令已停止。", evidence);
    if (timedOut) throw new ToolExecutionError("命令執行逾時。", evidence);
    if (exitCode !== 0)
      throw new ToolExecutionError(`命令結束碼：${exitCode}`, evidence);
    return {
      content: [{ type: "text" as const, text: output || "命令已完成。" }],
      details: { evidence },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

export function codingTools({
  workspace,
  permissions,
  allowWrites,
  runtimeSettings,
}: ToolOptions): AgentTool[] {
  const canWrite = () => {
    if (!(permissions ? permissions.files : allowWrites))
      throw new Error("尚未允許修改檔案。");
  };
  return [
    {
      name: "write_file",
      label: "修改檔案",
      description:
        "Create or replace a UTF-8 workspace file. Requires file write permission.",
      parameters: Type.Object(
        { path: Type.String(), content: Type.String() },
        { additionalProperties: false },
      ),
      async execute(_id, args, signal) {
        canWrite();
        const { path, content } = args as { path: string; content: string };
        const full = await workspace.resolve(path, true);
        return serialize(full, async () => {
          signal?.throwIfAborted();
          let before = "";
          try {
            before = await workspace.read(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          const patch = createTwoFilesPatch(path, path, before, content);
          signal?.throwIfAborted();
          const text = await workspace.write(path, content);
          return {
            content: [{ type: "text" as const, text }],
            details: { evidence: boundedEvidence({ patch, output: text }) },
          };
        });
      },
    },
    {
      name: "edit_file",
      label: "精準修改檔案",
      description:
        "Replace exact text in a workspace file. Each oldText must occur exactly once.",
      parameters: Type.Object(
        {
          path: Type.String(),
          edits: Type.Array(
            Type.Object({ oldText: Type.String(), newText: Type.String() }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id, args, signal) {
        canWrite();
        const { path, edits } = args as {
          path: string;
          edits: { oldText: string; newText: string }[];
        };
        if (!Array.isArray(edits) || !edits.length)
          throw new Error("請提供修改內容。");
        const full = await workspace.resolve(path);
        return serialize(full, async () => {
          signal?.throwIfAborted();
          const before = await workspace.read(path);
          let after = before;
          for (const { oldText, newText } of edits) {
            if (!oldText || after.split(oldText).length !== 2)
              throw new Error("每段舊文字必須在檔案中恰好出現一次。");
            after = after.replace(oldText, newText);
          }
          const patch = createTwoFilesPatch(path, path, before, after);
          signal?.throwIfAborted();
          const text = await workspace.write(path, after);
          return {
            content: [{ type: "text" as const, text }],
            details: { evidence: boundedEvidence({ patch, output: text }) },
          };
        });
      },
    },
    ...(permissions?.shell && permissions.files && findBash()
      ? [
          {
            name: "shell",
            label: "執行命令",
            description:
              "Run Bash on the host from the workspace (Git Bash on Windows). Approval follows the selected permission mode. Timeout 1–120 seconds.",
            parameters: Type.Object(
              { command: Type.String(), timeout: Type.Optional(Type.Number()) },
              { additionalProperties: false },
            ),
            async execute(_id: string, args: unknown, signal?: AbortSignal) {
              if (!permissions?.shell || !permissions.files)
                throw new Error("尚未允許執行命令。");
              const { command, timeout } = args as {
                command: string;
                timeout?: number;
              };
              if (!command?.trim()) throw new Error("請提供命令。");
              return runShell(
                command,
                workspace.root,
                Math.max(
                  1,
                  Math.min(
                    120,
                    Number.isFinite(timeout)
                      ? timeout!
                      : Number.isFinite(runtimeSettings?.shellTimeoutSeconds)
                        ? runtimeSettings!.shellTimeoutSeconds
                        : 60,
                  ),
                ),
                Number.isFinite(runtimeSettings?.outputLimit)
                  ? Math.max(1, Math.floor(runtimeSettings!.outputLimit))
                  : evidenceLimit,
                signal,
              );
            },
          } satisfies AgentTool,
        ]
      : []),
  ];
}
