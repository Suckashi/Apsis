import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskRun } from "../shared/types.ts";
import { runSchema } from "./storage-schema.ts";

/** Run journals are independent of conversation storage; tool boundaries are durable. */
export class RunStore {
  directory: string;
  records = new Map<string, TaskRun>();
  tails = new Map<string, Promise<void>>();
  constructor(directory: string) {
    this.directory = join(directory, "runs");
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      const run = JSON.parse(
        await readFile(join(this.directory, name), "utf8"),
      ) as TaskRun;
      if (run.id + ".json" !== name || !runSchema.safeParse(run).success)
        throw new Error("Invalid run journal: " + name);
      this.records.set(run.id, run);
      if (run.status === "running") {
        run.status = "interrupted";
        run.endedAt = new Date().toISOString();
        run.error = "服務重新啟動，任務中斷；請先檢查已完成與結果不明的操作。";
        for (const operation of run.operations)
          if (operation.status === "started") operation.status = "unknown";
        await this.save(run);
      }
    }
    return this;
  }
  save(run: TaskRun) {
    this.records.set(run.id, run);
    const snapshot = structuredClone(run);
    const next = (this.tails.get(run.id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const temporary = join(
          this.directory,
          run.id + "-" + randomUUID() + ".tmp",
        );
        await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
        await rename(temporary, join(this.directory, run.id + ".json"));
      });
    this.tails.set(run.id, next);
    void next.catch(() => {});
    return next;
  }
  async flush(id: string) {
    await this.tails.get(id);
  }
  list(sessionId?: string) {
    return [...this.records.values()]
      .filter((r) => !sessionId || r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
