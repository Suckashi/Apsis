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
  constructor(root) {
    this.root = path.resolve(root);
  }
  async init() {
    await mkdir(this.root, { recursive: true });
    this.root = await realpath(this.root);
    return this;
  }
  async resolve(input = "", create = false) {
    if (
      typeof input !== "string" ||
      input.includes("\0") ||
      input.includes(":") ||
      path.isAbsolute(input)
    )
      throw new Error("請使用工作區內的相對路徑。");
    const segments = input.replaceAll("\\", "/").split("/").filter(Boolean);
    if (segments.some((p) => p === ".." || p.startsWith(".")))
      throw new Error("不允許隱藏檔案或離開工作區。");
    let current = this.root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("不允許 symbolic link。");
      } catch (error) {
        if (error.code !== "ENOENT" || !create) throw error;
        if (i < segments.length - 1) await mkdir(current);
      }
    }
    return current;
  }
  async list(input = "") {
    return (await readdir(await this.resolve(input), { withFileTypes: true }))
      .filter((f) => !f.name.startsWith(".") && !f.isSymbolicLink())
      .slice(0, 200)
      .map((f) => ({
        name: f.name,
        type: f.isDirectory() ? "directory" : "file",
      }));
  }
  async read(input) {
    const file = await this.resolve(input);
    if ((await lstat(file)).size > 256_000)
      throw new Error("檔案超過 256 KB 上限。");
    return readFile(file, "utf8");
  }
  async write(input, content) {
    if (typeof content !== "string" || Buffer.byteLength(content) > 256_000)
      throw new Error("內容超過 256 KB 上限。");
    await writeFile(await this.resolve(input, true), content, "utf8");
    return `已寫入 ${input}`;
  }
}
