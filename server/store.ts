import type { StoreState } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class Store {
  directory: string;
  file!: string;
  state!: StoreState;
  tail: Promise<unknown>;
  constructor(directory: string) {
    this.directory = directory;
    this.tail = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.file = join(this.directory, "state.json");
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
    } catch (caught) {
      const error = asError(caught);
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
    const legacyMode = (mode: string) => mode === "hermes" || mode === "hybrid";
    if (
      this.state.sessions.some((s) => legacyMode(s.mode)) ||
      this.state.sessions.some((s) =>
        s.messages.some((m) => m.status === "pending"),
      )
    ) {
      await this.mutate((state) => {
        for (const session of state.sessions) {
          // Keep the transcript and ID; future turns use the configured Pi model.
          if (legacyMode(session.mode)) session.mode = "pi";
          if (!session.messages.some((m) => m.status === "pending")) continue;
          for (const message of session.messages)
            if (message.status === "pending") message.status = "failed";
          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content:
              "服務重新啟動，上次任務已中斷。請確認已完成的操作後再重試。",
            status: "error",
          });
        }
      });
    }
    return this;
  }
  async mutate<T>(fn: (state: StoreState) => T): Promise<T> {
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
