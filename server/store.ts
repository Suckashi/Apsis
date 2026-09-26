import type { StoreState } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  copyFile,
  access,
} from "node:fs/promises";
import { storageSchema } from "./storage-schema.ts";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ConversationStore } from "./conversations.ts";

export class Store {
  directory: string;
  file!: string;
  state!: StoreState;
  conversations!: ConversationStore;
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
      const parsed = storageSchema.safeParse(this.state);
      if (!parsed.success)
        throw new Error(
          "本機資料格式不符，已停止載入以保留原檔。請檢查 state.json 與 state.json.bak。",
        );
    } catch (caught) {
      const error = asError(caught);
      if (error.code !== "ENOENT") throw error;
      this.state = {
        schemaVersion: 2,
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
    if (this.state.schemaVersion === 3)
      await access(join(this.directory, "conversations.sqlite")).catch(() => {
        throw new Error("對話資料庫遺失，已停止啟動，請還原完整備份。");
      });
    this.conversations = new ConversationStore(this.directory);
    if (
      this.state.schemaVersion === 3 &&
      !this.conversations.db
        .prepare("SELECT 1 FROM meta WHERE key LIKE 'import:%' LIMIT 1")
        .get()
    ) {
      this.conversations.db.close();
      throw new Error(
        "對話資料庫缺少完成遷移的標記，已停止啟動，請檢查完整備份。",
      );
    }
    if (this.state.schemaVersion !== 3) {
      const original = JSON.stringify(this.state);
      const fingerprint = createHash("sha256").update(original).digest("hex");
      const backup = join(
        this.directory,
        `state-before-conversations-${fingerprint}.json`,
      );
      await writeFile(backup, original, { flag: "wx", mode: 0o600 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
      await this.conversations.migrate(this.state.sessions, fingerprint);
      this.state.schemaVersion = 3;
      for (const memory of this.state.memories) {
        memory.tier ??= "reference";
        memory.revision ??= 1;
      }
      const temporary = this.file + ".migration.tmp";
      await writeFile(
        temporary,
        JSON.stringify({ ...this.state, sessions: [] }, null, 2),
        { mode: 0o600 },
      );
      await rename(temporary, this.file);
    }
    this.conversations.transaction(() => {
      const pending = this.conversations.db
        .prepare(
          "SELECT session_id,context_id,value FROM messages WHERE channel='chat' AND json_extract(value,'$.status')='pending'",
        )
        .all();
      const interrupted = new Map<
        string,
        { sessionId: string; contextId: string; runId?: string }
      >();
      for (const row of pending) {
        const message = JSON.parse(String(row.value));
        this.conversations.append(
          String(row.session_id),
          { ...message, status: "failed" },
          String(row.context_id),
        );
        interrupted.set(String(row.context_id) + ":" + message.runId, {
          sessionId: String(row.session_id),
          contextId: String(row.context_id),
          runId: message.runId,
        });
      }
      for (const item of interrupted.values())
        this.conversations.append(
          item.sessionId,
          {
            id: randomUUID(),
            runId: item.runId,
            role: "assistant",
            content:
              "服務重新啟動，上次任務已中斷。請確認已完成的操作後再重試。",
            status: "error",
          },
          item.contextId,
        );
    });
    this.state.sessions = this.conversations.cachedSessions();
    return this;
  }
  async mutate<T>(fn: (state: StoreState) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = fn(next);
      if (!storageSchema.safeParse(next).success)
        throw new Error("拒絕保存不合法的資料格式。");
      const temp = join(this.directory, `state-${randomUUID()}.tmp`);
      await writeFile(
        temp,
        JSON.stringify({ ...next, schemaVersion: 3, sessions: [] }, null, 2),
        { mode: 0o600 },
      );
      await copyFile(this.file, this.file + ".bak").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
      await rename(temp, this.file);
      this.conversations.transaction(() => {
        for (const session of next.sessions)
          this.conversations.saveSession(session);
      });
      for (const old of this.state.sessions)
        if (!next.sessions.some((session) => session.id === old.id))
          await this.conversations.remove(old.id);
      next.sessions = this.conversations.cachedSessions();
      this.state = next;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
