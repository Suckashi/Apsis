import { FilesystemBackend } from "deepagents/node";
import { lstatSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Private scratch never follows links into the workspace or another Bot. */
export function scratchBackend(rootDir: string) {
  const root = resolve(rootDir);
  const check = (path = "/") => {
    for (const ancestor of [root, dirname(root), dirname(dirname(root))]) {
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          throw new Error("暫存檔不允許符號連結。");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (/[\\:\0]/.test(path) || path.split("/").includes(".."))
      throw new Error("無效的虛擬檔案路徑。");
    const target = resolve(root, path.replace(/^\/+/, ""));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("暫存檔路徑超出工作 context。");
    let current = root;
    for (const part of ["", ...rel.split(/[\\/]/).filter(Boolean)]) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error("暫存檔不允許符號連結。");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
  // Globbing and grep can traverse descendants; reject links before traversal.
  const tree = (path: string) => {
    check(path);
    const dir = resolve(root, path.replace(/^\/+/, ""));
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("暫存檔不允許符號連結。");
      if (entry.isDirectory()) tree(path.replace(/\/$/, "") + "/" + entry.name);
    }
  };
  const backend = new FilesystemBackend({
    rootDir: root,
    virtualMode: true,
    maxFileSizeMb: 20,
  });
  return new Proxy(backend, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: any[]) => {
        if (
          ["read", "readRaw", "write", "edit", "delete", "ls"].includes(
            String(property),
          )
        )
          check(args[0]);
        if (["glob", "grep"].includes(String(property))) tree(args[1] || "/");
        if (property === "downloadFiles")
          args[0].forEach((path: string) => check(path));
        if (property === "uploadFiles")
          args[0].forEach(([path]: [string, Uint8Array]) => check(path));
        return value.apply(target, args);
      };
    },
  });
}
