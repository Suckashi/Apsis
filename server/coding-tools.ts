import path from "node:path";
import {
  createEditTool,
  createBashTool,
  createPowerShellTool,
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
  const shell = (
    process.platform === "win32" ? createPowerShellTool : createBashTool
  )(workspace.root, {
    exposeSessionEnvironment: false,
    spawnHook: (context) => ({
      ...context,
      env: Object.fromEntries(
        Object.entries(context.env).filter(([key]) =>
          /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|psmodulepath|lang|lc_all)$/i.test(
            key,
          ),
        ),
      ),
    }),
  });
  return [
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
          details: (output.details as Record<string, unknown>) || {},
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
              const output = await shell.execute(
                id,
                { command: input.command, timeout },
                signal,
              );
              return {
                content: output.content.filter((c) => c.type === "text"),
                details: (output.details as Record<string, unknown>) || {},
              };
            },
          },
        ]
      : []),
  ];
}
