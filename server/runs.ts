import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskRun } from "../shared/types.ts";
import { recoverRun } from "./task-lifecycle.ts";
import { runSchema } from "./storage-schema.ts";

/** Run journals are independent of conversation storage; tool boundaries are durable. */
export class RunStore {
  directory: string;
  records = new Map<string, TaskRun>();
  tails = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, unknown>();
  private readonly completionCommitted?: (run: TaskRun) => boolean;
  constructor(
    directory: string,
    completionCommitted?: (run: TaskRun) => boolean,
  ) {
    this.directory = join(directory, "runs");
    this.completionCommitted = completionCommitted;
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
      const recovered = recoverRun(
        run,
        run.status !== "completed" ||
          !this.completionCommitted ||
          this.completionCommitted(run),
      );
      if (recovered !== run) await this.save(recovered);
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
        try {
          await writeFile(temporary, JSON.stringify(snapshot), {
            mode: 0o600,
            flag: "wx",
          });
          await rename(temporary, join(this.directory, run.id + ".json"));
        } finally {
          await rm(temporary, { force: true });
        }
      })
      .then(
        () => {
          this.failures.delete(run.id);
        },
        (error) => {
          this.failures.set(run.id, error);
          throw error;
        },
      );
    this.tails.set(run.id, next);
    // Observe rejection while retaining it for the caller and shutdown flush.
    void next
      .finally(() => {
        if (this.tails.get(run.id) === next) this.tails.delete(run.id);
      })
      .catch(() => {});
    return next;
  }
  async flush(id?: string) {
    const pending = id ? [this.tails.get(id)] : [...this.tails.values()];
    await Promise.allSettled(pending);
    const failures = id
      ? this.failures.has(id)
        ? [this.failures.get(id)]
        : []
      : [...this.failures.values()];
    if (failures.length)
      throw new AggregateError(failures, "任務日誌寫入失敗。");
  }
  list(sessionId?: string) {
    return [...this.records.values()]
      .filter((r) => !sessionId || r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
