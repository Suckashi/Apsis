import type {
  Bot,
  BotTemplate,
  Job,
  Approval,
  Artifact,
  Routine,
  Draft,
} from "../shared/product.ts";
import { RecordRepository, type RecordFilter } from "./record-repository.ts";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/** Small transactional record store. Credentials are never returned by list APIs. */
export class ProductDB {
  db!: DatabaseSync;
  readonly bots = new RecordRepository<Bot>(this, "bot");
  readonly templates = new RecordRepository<BotTemplate>(this, "template");
  readonly jobs = new RecordRepository<Job>(this, "job");
  readonly approvals = new RecordRepository<Approval>(this, "approval");
  readonly artifacts = new RecordRepository<Artifact>(this, "artifact");
  readonly routines = new RecordRepository<Routine>(this, "routine");
  readonly drafts = new RecordRepository<Draft>(this, "draft");
  async init(directory: string) {
    await mkdir(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "product.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, createdAt TEXT NOT NULL, value TEXT NOT NULL)",
    );
    this.db
      .exec(`CREATE INDEX IF NOT EXISTS records_bot ON records(kind,json_extract(value,'$.botId'));
      CREATE INDEX IF NOT EXISTS records_session ON records(kind,json_extract(value,'$.sessionId'));
      CREATE INDEX IF NOT EXISTS records_queue ON records(kind,json_extract(value,'$.botId'),json_extract(value,'$.status'));
      CREATE INDEX IF NOT EXISTS records_run ON records(kind,json_extract(value,'$.runId'));`);
    // Retire only the removed avatar economy. Keep catalog choices, Bots,
    // templates, conversations and all other job evidence intact.
    try {
      this.transaction(() => {
        this.db
          .prepare(
            "DELETE FROM records WHERE kind IN ('avatar-collection','avatar-reward','avatar-draw')",
          )
          .run();
        this.db
          .prepare(
            "UPDATE records SET value=json_remove(value,'$.avatarRewardsEligible') WHERE kind='job' AND json_type(value,'$.avatarRewardsEligible') IS NOT NULL",
          )
          .run();
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
    return this;
  }
  all<T>(kind: string): T[] {
    return this.query<T>(kind, {});
  }
  query<T>(kind: string, filter: RecordFilter<T>): T[] {
    const allowed = new Set([
      "id",
      "botId",
      "sessionId",
      "runId",
      "status",
      "parentJobId",
      "rootJobId",
      "workContextId",
      "delegatedBy",
      "deletedAt",
    ]);
    const predicates = ["kind=?"];
    const args: SQLInputValue[] = [kind];
    for (const [field, value] of Object.entries(filter)) {
      if (!allowed.has(field))
        throw new Error("Unsupported record filter: " + field);
      if (value === undefined) continue;
      if (
        value !== null &&
        !["string", "number", "boolean"].includes(typeof value)
      )
        throw new Error("Record filters require scalar values");
      predicates.push(
        field === "id" ? "id IS ?" : `json_extract(value,'$.${field}') IS ?`,
      );
      args.push(
        typeof value === "boolean" ? Number(value) : (value as SQLInputValue),
      );
    }
    return this.db
      .prepare(
        `SELECT value FROM records WHERE ${predicates.join(" AND ")} ORDER BY rowid`,
      )
      .all(...args)
      .map((row) => JSON.parse(String(row.value)) as T);
  }
  /** Synchronous only: no asynchronous work may run inside a transaction. */
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }
  put<T extends { id: string }>(kind: string, value: T) {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  remove(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  event(value: unknown) {
    const id = Number(
      this.db
        .prepare("INSERT INTO events(createdAt,value) VALUES(?,?)")
        .run(new Date().toISOString(), JSON.stringify(value)).lastInsertRowid,
    );
    if (id % 100 === 0)
      this.db.prepare("DELETE FROM events WHERE id < ?").run(id - 10000);
    return id;
  }
  events(after: number) {
    return this.db
      .prepare("SELECT id,value FROM events WHERE id>? ORDER BY id LIMIT 1000")
      .all(after);
  }
}
