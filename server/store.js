import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.tail = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.file = join(this.directory, "state.json");
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = {
        sessions: [],
        memories: [],
        skills: [
          {
            id: "starter",
            name: "開發任務拆解",
            content:
              "先確認目標與限制，再提出小步驟。實作後驗證結果，清楚區分已完成、待驗證與下一步。",
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    return this;
  }
  async mutate(fn) {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = fn(next);
      const temp = join(this.directory, `state-${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temp, this.file);
      this.state = next;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
