import { SkillCatalog } from "./skills.ts";
import type { StoreState, KnowledgeState } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  copyFile,
  access,
  realpath,
  rm,
} from "node:fs/promises";
import { storageSchema } from "./storage-schema.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationStore } from "./conversations.ts";
import { recoverConversations } from "./conversation-recovery.ts";

/** Knowledge is file-backed. Conversations have their own repository and transactions. */
export class Store {
  directory: string;
  skills: SkillCatalog;
  file!: string;
  state!: KnowledgeState;
  conversations!: ConversationStore;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(directory: string, globalSkillsDirectory?: string) {
    this.skills = new SkillCatalog(directory, globalSkillsDirectory);
    this.directory = directory;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.directory = await realpath(this.directory);
    this.file = join(this.directory, "state.json");
    let fresh = false;
    let knowledge: KnowledgeState;
    try {
      const parsed = storageSchema.safeParse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
      if (!parsed.success)
        throw new Error(
          "不支援的本機資料格式；此版本只接受 schema 4，不會遷移或覆寫舊資料。",
        );
      knowledge = parsed.data;
      await access(join(this.directory, "conversations.sqlite")).catch(() => {
        throw new Error("對話資料庫遺失，已停止啟動，請還原完整備份。");
      });
    } catch (caught) {
      if (asError(caught).code !== "ENOENT") throw caught;
      for (const database of ["conversations.sqlite", "product.sqlite"]) {
        if (
          await access(join(this.directory, database)).then(
            () => true,
            (error) => {
              if (asError(error).code !== "ENOENT") throw error;
              return false;
            },
          )
        )
          throw new Error("知識資料檔遺失，已停止啟動，請還原完整備份。");
      }
      fresh = true;
      knowledge = { schemaVersion: 4, projects: [], memories: [], skills: [] };
    }
    this.conversations = new ConversationStore(this.directory);
    this.state = knowledge;
    if (fresh) {
      await writeFile(this.file, JSON.stringify(knowledge, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      this.skills.create({
        id: "starter",
        name: "開發任務拆解",
        content:
          "先確認目標與限制，再提出小步驟。實作後驗證結果，清楚區分已完成、待驗證與下一步。",
      });
    }
    recoverConversations(this.conversations);
    return this;
  }
  async flush() {
    await this.tail;
  }
  skillState(): StoreState {
    return {
      ...this.state,
      sessions: this.conversations?.cachedSessions() || [],
      skills: [...this.skills.list(), ...this.state.skills],
    };
  }
  /** Only knowledge mutations enter this queue; chat writes never rewrite state.json. */
  async mutate<T>(fn: (state: KnowledgeState) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = fn(next);
      if (!storageSchema.safeParse(next).success)
        throw new Error("拒絕保存不合法的資料格式。");
      const temp = join(this.directory, `state-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), {
          flag: "wx",
          mode: 0o600,
        });
        await copyFile(this.file, this.file + ".bak");
        await rename(temp, this.file);
      } finally {
        await rm(temp, { force: true });
      }
      this.state = next;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
