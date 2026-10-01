import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
  writeFile,
  mkdir,
  rename,
  cp,
  rm,
  readdir,
  open,
} from "node:fs/promises";
import { dirname, join, relative, isAbsolute, resolve, sep } from "node:path";
import type { WorkLocation } from "../shared/types.ts";
import type { ProductDB } from "./product-db.ts";
import type { WorkLocations } from "./work-locations.ts";

const fail = (text: string, status = 400): never => {
  throw Object.assign(new Error(text), { status });
};
export const revision = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export async function fileRevision(path: string) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(path)) hash.update(data);
  return hash.digest("hex");
}
export interface TrashEntry {
  id: string;
  locationId: string;
  path: string;
  deletedAt: string;
  fingerprint?: string;
  state: "pending" | "ready" | "restoring" | "restored";
}
export class FileManager {
  private tail: Promise<unknown> = Promise.resolve();
  private locations: WorkLocations;
  private db: ProductDB;
  private dataDir: string;
  private busy: (location: WorkLocation) => boolean;
  constructor(
    locations: WorkLocations,
    db: ProductDB,
    dataDir: string,
    busy: (location: WorkLocation) => boolean,
  ) {
    this.locations = locations;
    this.db = db;
    this.dataDir = dataDir;
    this.busy = busy;
  }
  async wait() {
    await this.tail;
  }
  isBusy(id: string) {
    return this.busy(this.locations.get(id));
  }
  private async target(id: string, path: string, create = false) {
    const workspace = this.locations.workspace(this.locations.get(id));
    const full = await workspace.resolve(path, create);
    const data = resolve(this.dataDir),
      target = resolve(full);
    const rel = relative(data, target);
    // The configured workspace may live within the data directory, but cannot reach its siblings.
    const rootRel = relative(data, workspace.root);
    if (
      (rel === "" || (!rel.startsWith(".." + sep) && !isAbsolute(rel))) &&
      (rootRel === "" || rootRel.startsWith(".." + sep) || isAbsolute(rootRel))
    )
      fail("不能操作 Apsis 系統資料。", 403);
    return full;
  }
  async list(id: string, path = "", offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) fail("無效的分頁游標。");
    await this.target(id, path);
    const entries = await this.locations
      .workspace(this.locations.get(id))
      .list(path);
    return {
      entries: entries.slice(offset, offset + 200),
      next: offset + 200 < entries.length ? offset + 200 : undefined,
      busy: this.isBusy(id),
    };
  }
  async read(id: string, path: string) {
    const file = await this.target(id, path);
    const info = await lstat(file);
    if (!info.isFile()) fail("請選擇檔案。");
    if (info.size > 1024 * 1024)
      return {
        size: info.size,
        editable: false,
        content: "",
        revision: await fileRevision(file),
      };
    const data = await readFile(file);
    let content = "",
      editable = true;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (content.includes("\0")) editable = false;
    } catch {
      editable = false;
    }
    return {
      size: data.length,
      editable,
      content: editable ? content : "",
      revision: revision(data),
    };
  }
  async status(id: string, path: string) {
    try {
      const info = await lstat(await this.target(id, path));
      return { available: info.isFile(), size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { available: false };
      throw error;
    }
  }
  async download(id: string, path: string) {
    const full = await this.target(id, path);
    const info = await lstat(full);
    if (!info.isFile()) fail("請選擇檔案。");
    return full;
  }
  trash(id: string) {
    this.locations.get(id);
    return this.db
      .all<TrashEntry>("file-trash")
      .filter((r) => r.locationId === id && r.state === "ready");
  }
  mutate<T>(id: string, operation: () => Promise<T>) {
    const task = this.tail.then(async () => {
      if (this.isBusy(id))
        fail(
          "此資料夾有執行中或等待核准的工作；可編輯草稿，完成後再儲存。",
          409,
        );
      return operation();
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async save(id: string, path: string, content: string, expected: unknown) {
    if (typeof content !== "string" || Buffer.byteLength(content) > 1024 * 1024)
      fail("文字編輯上限為 1 MiB。", 413);
    return this.mutate(id, async () => {
      const full = await this.target(id, path, true);
      if (!path) fail("不能修改工作資料夾根目錄。");
      if (expected === null) {
        await writeFile(full, content, { flag: "wx" }).catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code === "EEXIST") fail("同名檔案已存在。", 409);
            throw e;
          },
        );
      } else {
        const handle = await open(full, "r+");
        try {
          const data = await handle.readFile();
          if (typeof expected !== "string" || revision(data) !== expected)
            fail("檔案已變更，請比較目前版本後再儲存。", 409);
          await handle.write(
            Buffer.from(content),
            0,
            Buffer.byteLength(content),
            0,
          );
          await handle.truncate(Buffer.byteLength(content));
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      return this.read(id, path);
    });
  }
  async createDirectory(id: string, path: string) {
    return this.mutate(id, async () => {
      if (!path) fail("請輸入資料夾名稱。");
      await mkdir(await this.target(id, path, true));
      return { ok: true };
    });
  }
  async upload(id: string, path: string, data: Buffer) {
    if (data.length > 20 * 1024 * 1024) fail("檔案超過 20 MB。", 413);
    return this.mutate(id, async () => {
      if (!path) fail("請輸入檔案名稱。");
      await writeFile(await this.target(id, path, true), data, {
        flag: "wx",
      }).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "EEXIST") fail("同名檔案已存在。", 409);
        throw e;
      });
      return { ok: true };
    });
  }
  private async absent(path: string) {
    try {
      await lstat(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    fail("目的地已有同名檔案，請使用其他名稱。", 409);
  }
  private async validateTree(id: string, path: string): Promise<void> {
    const full = await this.target(id, path);
    if ((await lstat(full)).isDirectory())
      for (const entry of await readdir(full))
        await this.validateTree(id, path + "/" + entry);
  }
  async move(id: string, from: string, to: string, expected?: string) {
    return this.mutate(id, async () => {
      if (
        !from ||
        !to ||
        to.replaceAll("\\", "/").startsWith(from.replaceAll("\\", "/") + "/")
      )
        fail("不能搬移根目錄或搬入自身。");
      const source = await this.target(id, from),
        dest = await this.target(id, to, true);
      if ((await lstat(source)).isFile()) {
        if (
          typeof expected !== "string" ||
          (await fileRevision(source)) !== expected
        )
          fail("檔案已變更，請重新載入。", 409);
      }
      await this.validateTree(id, from);
      await this.absent(dest);
      await rename(source, dest);
      return { ok: true };
    });
  }
  private async fingerprint(path: string): Promise<string> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) fail("不允許 symbolic link 或 junction。", 403);
    if (info.isFile()) return fileRevision(path);
    if (!info.isDirectory()) fail("不支援此檔案類型。", 403);
    const entries = (await readdir(path)).sort();
    const hash = createHash("sha256");
    for (const name of entries)
      hash.update(
        JSON.stringify([name, await this.fingerprint(join(path, name))]),
      );
    return hash.digest("hex");
  }
  async recover() {
    for (const entry of this.db.all<TrashEntry>("file-trash")) {
      if (entry.state !== "pending" || !entry.fingerprint) continue;
      const dest = join(this.dataDir, "file-trash", entry.id);
      try {
        const source = join(
          this.locations.get(entry.locationId).path,
          entry.path,
        );
        const exists = await lstat(source).catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return undefined;
          throw e;
        });
        if (!exists && (await this.fingerprint(dest)) === entry.fingerprint)
          this.db.put("file-trash", { ...entry, state: "ready" });
      } catch {
        /* An incomplete copy stays recoverable on disk; never delete either copy. */
      }
    }
  }
  async remove(id: string, path: string) {
    return this.mutate(id, async () => {
      if (!path) fail("不能刪除工作資料夾根目錄。");
      await this.validateTree(id, path);
      const source = await this.target(id, path);
      const entry: TrashEntry = {
        id: randomUUID(),
        locationId: id,
        path,
        deletedAt: new Date().toISOString(),
        fingerprint: await this.fingerprint(source),
        state: "pending",
      };
      const dest = join(this.dataDir, "file-trash", entry.id);
      await mkdir(dirname(dest), { recursive: true });
      this.db.put("file-trash", entry);
      try {
        await rename(source, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
        // Keep a complete copy before removing the original on another volume.
        await cp(source, dest, {
          recursive: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true,
        });
        await this.validateTree(id, path);
        if (
          (await this.fingerprint(source)) !== entry.fingerprint ||
          (await this.fingerprint(dest)) !== entry.fingerprint
        )
          fail("檔案在回收時變更，已保留原檔與回收副本。", 409);
        await rm(source, { recursive: true });
      }
      this.db.put("file-trash", { ...entry, state: "ready" });
      return { ok: true };
    });
  }
  async restore(id: string, trashId: string, path?: string) {
    return this.mutate(id, async () => {
      const entry = this.db.get<TrashEntry>("file-trash", trashId);
      if (!entry || entry.locationId !== id || entry.state !== "ready")
        return fail("找不到回收檔案。", 404);
      const dest = await this.target(id, path || entry.path, true);
      await this.absent(dest);
      const source = join(this.dataDir, "file-trash", entry.id);
      if (
        entry.fingerprint &&
        (await this.fingerprint(source)) !== entry.fingerprint
      )
        fail("回收副本已變更，無法自動還原。", 409);
      // Copy first: a crash can leave an extra recoverable copy, never lose the only copy.
      await cp(source, dest, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      if (
        entry.fingerprint &&
        (await this.fingerprint(dest)) !== entry.fingerprint
      )
        fail("還原未完整完成；回收副本仍保留。", 409);
      this.db.put("file-trash", { ...entry, state: "restored" });
      return { ok: true };
    });
  }
}
