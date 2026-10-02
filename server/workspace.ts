import { DEFAULT_DATA_DIR } from "./app-directories.ts";
import type { WorkspaceFile } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

// A deliberately narrow file toolset. No shell, absolute paths, or symlinks.
export class Workspace {
  root: string;
  lazy: boolean;
  protectedRoots: string[];
  constructor(root: string, lazy = false, protectedRoots: string[] = []) {
    this.root = path.resolve(root);
    this.lazy = lazy;
    this.protectedRoots = protectedRoots;
  }
  async init() {
    await this.checkAncestors();
    await mkdir(this.root, { recursive: true });
    this.root = await realpath(this.root);
    return this;
  }
  async checkAncestors() {
    let current = this.root;
    while (true) {
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw Object.assign(new Error("不允許 symbolic link 或 junction。"), {
            status: 403,
          });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  async ready(create = false) {
    await this.checkAncestors();
    try {
      if (!(await lstat(this.root)).isDirectory())
        throw new Error("工作資料夾無法存取。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && this.lazy) {
        if (create) await this.init();
        return;
      }
      throw Object.assign(
        new Error("工作資料夾已移動或無法存取，請恢復原路徑。"),
        { status: 409 },
      );
    }
  }
  static contains(root: string, target: string) {
    const rel = path.relative(root, target);
    return (
      rel === "" ||
      (rel !== ".." &&
        !rel.startsWith(".." + path.sep) &&
        !path.isAbsolute(rel))
    );
  }
  static allowed(name: string) {
    return (
      ![
        ".git",
        ".apsis",
        ".apsis-v4",
        DEFAULT_DATA_DIR,
        ".apsis-trash",
      ].includes(name.toLowerCase()) &&
      name !== "." &&
      name !== ".." &&
      !/[\x00-\x1f<>:"|?*]/.test(name) &&
      !/[. ]$/.test(name) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    );
  }
  async resolve(input = "", create = false) {
    if (
      typeof input !== "string" ||
      input.includes("\0") ||
      input.includes(":") ||
      path.isAbsolute(input)
    )
      throw Object.assign(new Error("請使用工作區內的相對路徑。"), {
        status: 400,
      });
    // Current-directory segments are ordinary relative paths and are already
    // canonicalized by permission matching. Parent traversal stays forbidden.
    const segments = input
      .replaceAll("\\", "/")
      .split("/")
      .filter((part) => part !== "" && part !== ".");
    if (segments.some((p) => !Workspace.allowed(p)))
      throw Object.assign(new Error("不允許系統資料、無效路徑或離開工作區。"), {
        status: 403,
      });
    if (
      this.protectedRoots.some((root) =>
        Workspace.contains(root, path.resolve(this.root, ...segments)),
      )
    )
      throw Object.assign(new Error("不能操作 Apsis 系統資料。"), {
        status: 403,
      });
    await this.ready(create);
    let current = this.root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw Object.assign(new Error("不允許 symbolic link。"), {
            status: 403,
          });
      } catch (caught) {
        const error = asError(caught);
        if (error.code !== "ENOENT" || !create) throw error;
        if (i < segments.length - 1) await mkdir(current);
      }
    }
    return current;
  }
  async list(input = ""): Promise<WorkspaceFile[]> {
    const directory = await this.resolve(input);
    const entries = await readdir(directory, {
      withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && this.lazy && directory === this.root)
        return [];
      throw error;
    });
    return entries
      .filter(
        (f) =>
          Workspace.allowed(f.name) &&
          !f.isSymbolicLink() &&
          !this.protectedRoots.some((root) =>
            Workspace.contains(root, path.resolve(this.root, input, f.name)),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      )
      .map((f) => ({
        name: f.name,
        type: f.isDirectory() ? "directory" : "file",
      }));
  }
  async read(input: string) {
    const file = await this.resolve(input);
    if ((await lstat(file)).size > 256_000)
      throw new Error("檔案超過 256 KB 上限。");
    return readFile(file, "utf8");
  }
  async write(input: string, content: string) {
    if (typeof content !== "string" || Buffer.byteLength(content) > 256_000)
      throw new Error("內容超過 256 KB 上限。");
    await writeFile(await this.resolve(input, true), content, "utf8");
    return `已寫入 ${input}`;
  }
}
