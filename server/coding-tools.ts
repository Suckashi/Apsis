import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Type } from "typebox";
import { createTwoFilesPatch } from "diff";
import {
  boundedEvidence,
  evidenceLimit,
  ToolExecutionError,
} from "./evidence.ts";
import {
  createEditTool,
  createBashTool,
  createPowerShellTool,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "./tools.ts";
import type { ToolOptions } from "./runtime.ts";

export function codingTools({
  workspace,
  permissions,
  allowWrites,
}: ToolOptions): AgentTool[] {
  const edit = createEditTool(workspace.root, {
    operations: {
      readFile: async (p) =>
        Buffer.from(await workspace.read(path.relative(workspace.root, p))),
      writeFile: async (p, content) => {
        await workspace.write(path.relative(workspace.root, p), content);
      },
      access: async (p) => {
        await workspace.resolve(path.relative(workspace.root, p));
      },
    },
  });
  const shellFactory =
    process.platform === "win32" ? createPowerShellTool : createBashTool;
  const shellOptions = {
    exposeSessionEnvironment: false,
    spawnHook: (
      context: import("@earendil-works/pi-coding-agent").BashSpawnContext,
    ) => ({
      ...context,
      env: Object.fromEntries(
        Object.entries(context.env).filter(([key]) =>
          /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|psmodulepath|lang|lc_all)$/i.test(
            key,
          ),
        ),
      ),
    }),
  };
  const shell = shellFactory(workspace.root, shellOptions);
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
        if (!(permissions ? permissions.files : allowWrites))
          throw new Error("使用者尚未開啟「允許修改」此類資料的權限。");
        const input = args as { path: string; content: string };
        const full = await workspace.resolve(input.path, true);
        return withFileMutationQueue(full, async () => {
          signal?.throwIfAborted();
          let before = "";
          let exists = true;
          try {
            before = await workspace.read(input.path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            exists = false;
          }
          const patch = createTwoFilesPatch(
            exists ? input.path : "/dev/null",
            input.path,
            before,
            input.content,
            undefined,
            undefined,
            { context: 3 },
          );
          signal?.throwIfAborted();
          const text = await workspace.write(input.path, input.content);
          return {
            content: [{ type: "text", text }],
            details: { evidence: boundedEvidence({ patch, output: text }) },
          };
        });
      },
    },
    {
      ...edit,
      name: "edit_file",
      label: "精準修改檔案",
      async execute(id, args, signal) {
        signal?.throwIfAborted();
        if (!(permissions ? permissions.files : allowWrites))
          throw new Error("尚未允許修改檔案。");
        const input = args as {
          path: string;
          edits: { oldText: string; newText: string }[];
        };
        await workspace.resolve(input.path);
        const output = await edit.execute(id, input, signal);
        return {
          content: output.content.filter((c) => c.type === "text"),
          details: {
            evidence: boundedEvidence({
              patch: (output.details as { patch?: string } | undefined)?.patch,
              output: output.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n"),
            }),
          },
        };
      },
    },
    // Do not expose shell at all without an explicit per-run grant.
    ...(permissions?.shell && permissions.files
      ? [
          {
            ...shell,
            name: "shell",
            label: "執行命令",
            description: `Run ${process.platform === "win32" ? "PowerShell" : "Bash"} on the host computer, starting in the workspace. This is not a sandbox. Timeout defaults to 60 seconds, maximum 120 seconds.`,
            async execute(id: string, args: unknown, signal?: AbortSignal) {
              signal?.throwIfAborted();
              if (!permissions?.shell || !permissions.files)
                throw new Error("尚未允許執行命令與修改檔案。");
              const input = args as { command: string; timeout?: number };
              if (
                !input ||
                typeof input.command !== "string" ||
                !input.command.trim()
              )
                throw new Error("請提供命令。");
              const timeout =
                typeof input.timeout === "number" &&
                Number.isFinite(input.timeout)
                  ? Math.max(1, Math.min(120, input.timeout))
                  : 60;
              let captured = "";
              let truncated = false;
              let exitCode: number | null = null;
              const decoder = new StringDecoder("utf8");
              const local =
                process.platform === "win32"
                  ? createLocalPowerShellOperations()
                  : createLocalBashOperations();
              const execution = shellFactory(workspace.root, {
                ...shellOptions,
                operations: {
                  async exec(command, cwd, options) {
                    const result = await local.exec(command, cwd, {
                      ...options,
                      onData(data) {
                        const text = decoder.write(data);
                        truncated ||=
                          captured.length + text.length > evidenceLimit;
                        captured = (captured + text).slice(0, evidenceLimit);
                        options.onData(data);
                      },
                    });
                    exitCode = result.exitCode;
                    return result;
                  },
                },
              });
              try {
                const output = await execution.execute(
                  id,
                  { command: input.command, timeout },
                  signal,
                );
                return {
                  content: output.content.filter((c) => c.type === "text"),
                  details: {
                    evidence: boundedEvidence({
                      command: input.command,
                      output: captured + decoder.end(),
                      exitCode,
                      truncated,
                    }),
                  },
                };
              } catch (error) {
                throw new ToolExecutionError(
                  (error as Error).message,
                  boundedEvidence({
                    command: input.command,
                    output: captured + decoder.end(),
                    exitCode,
                    truncated,
                  }),
                );
              }
            },
          },
        ]
      : []),
  ];
}
