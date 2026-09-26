import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// Kimi be7d5f5, tool/path-access.ts (MIT; vendor/kimi-bash/LICENSE).
const names = ["id_rsa", "id_ed25519", "id_ecdsa", "credentials"];
const suffixes = new Set([
  ".bak",
  ".backup",
  ".copy",
  ".disabled",
  ".key",
  ".old",
  ".orig",
  ".pem",
  ".save",
  ".tmp",
]);
export function isSensitiveFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const name = normalized.split("/").at(-1)!;
  if (
    [
      ".env.example",
      ".env.sample",
      ".env.template",
      "id_rsa.pub",
      "id_ed25519.pub",
      "id_ecdsa.pub",
    ].includes(name)
  )
    return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (
    names.some(
      (prefix) =>
        name === prefix ||
        name.startsWith(prefix + "-") ||
        name.startsWith(prefix + "_") ||
        (name.startsWith(prefix) && suffixes.has(name.slice(prefix.length))),
    )
  )
    return true;
  return [".aws/credentials", ".gcp/credentials"].some(
    (suffix) =>
      normalized.endsWith("/" + suffix) ||
      normalized.includes("/" + suffix + "/") ||
      normalized === suffix,
  );
}

export function gitPaths(root: string): {
  worktree: boolean;
  controls: string[];
} {
  let directory = resolve(root);
  while (true) {
    const marker = join(directory, ".git");
    if (existsSync(marker)) {
      const controls = [marker];
      try {
        const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, "utf8"));
        if (match) {
          const control = resolve(directory, match[1].trim());
          controls.push(control);
          try {
            controls.push(
              resolve(
                control,
                readFileSync(join(control, "commondir"), "utf8").trim(),
              ),
            );
          } catch {}
        }
      } catch {
        /* A directory .git is the normal case. */
      }
      return { worktree: true, controls };
    }
    const parent = dirname(directory);
    if (parent === directory) return { worktree: false, controls: [] };
    directory = parent;
  }
}

export function filePolicyContext(root: string, path: string | undefined) {
  if (path === undefined) return { gitWorkspace: false, gitControl: false };
  const git = gitPaths(root);
  const target = resolve(root, path);
  return {
    gitWorkspace: git.worktree,
    gitControl:
      path
        .replaceAll("\\", "/")
        .split("/")
        .some((part) => part.toLowerCase() === ".git") ||
      git.controls.some((control) => {
        const rel = relative(control, target);
        return (
          rel === "" ||
          (!isAbsolute(rel) &&
            rel !== ".." &&
            !rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")))
        );
      }),
  };
}
