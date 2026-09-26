import { existsSync } from "node:fs";
import path from "node:path";

export const shellMissing =
  "找不到 Bash。Windows 請安裝 Git for Windows；Linux 請安裝 Bash，或設定 APSIS_SHELL_PATH。";
export function findBash(
  options: {
    platform?: string;
    env?: NodeJS.ProcessEnv;
    exists?: (path: string) => boolean;
  } = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const windows = platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const valid = (value: string) =>
    paths.isAbsolute(value) &&
    !(
      windows &&
      /[\\/]Windows[\\/](?:System32|Sysnative|SysWOW64)[\\/]/i.test(value)
    ) &&
    exists(value);
  const native = (value: string) => {
    // Git's bin/bash.exe is a launcher; start the real interpreter so its
    // Windows PID maps directly to an MSYS process group for cancellation.
    const actual = paths.resolve(paths.dirname(value), "../usr/bin/bash.exe");
    return windows && /[\\/]bin[\\/]bash\.exe$/i.test(value) && valid(actual)
      ? actual
      : value;
  };
  if (env.APSIS_SHELL_PATH)
    return valid(env.APSIS_SHELL_PATH)
      ? native(env.APSIS_SHELL_PATH)
      : undefined;
  const search = (env.PATH ?? env.Path ?? "")
    .split(windows ? ";" : ":")
    .filter(Boolean);
  const candidates = windows
    ? [
        ...search
          .filter((dir) => /[\\/]Git[\\/](cmd|bin)$/i.test(dir))
          .flatMap((dir) => [
            paths.resolve(dir, "../bin/bash.exe"),
            paths.resolve(dir, "../usr/bin/bash.exe"),
          ]),
        ...[
          env.ProgramFiles ?? "C:\\Program Files",
          env["ProgramFiles(x86)"],
          env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, "Programs"),
        ]
          .filter((p): p is string => !!p)
          .flatMap((dir) => [
            paths.join(dir, "Git/bin/bash.exe"),
            paths.join(dir, "Git/usr/bin/bash.exe"),
          ]),
        ...search.map((dir) =>
          paths.join(dir.replace(/^"|"$/g, ""), "bash.exe"),
        ),
      ]
    : ["/bin/bash", ...search.map((dir) => paths.join(dir, "bash"))];
  const found = candidates.find(valid);
  return found ? native(found) : undefined;
}

export function bashPath(value: string, platform = process.platform): string {
  if (platform !== "win32") return value;
  return value
    .replaceAll("\\", "/")
    .replace(/^([a-z]):\//i, (_, drive: string) => `/${drive.toLowerCase()}/`);
}

export function shellContext(root: string): string {
  const executable = findBash();
  return executable
    ? `Shell is Bash (${JSON.stringify(executable)}), including on Windows. Native cwd: ${JSON.stringify(root)}; Bash cwd: ${JSON.stringify(bashPath(root))}. Use Bash syntax and quote paths. Historical PowerShell commands are evidence only; do not replay them as Bash.`
    : shellMissing;
}
