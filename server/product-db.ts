import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/** Small transactional record store. Credentials are never returned by list APIs. */
export class ProductDB {
  db!: DatabaseSync;
  async init(directory: string) {
    await mkdir(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "product.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, createdAt TEXT NOT NULL, value TEXT NOT NULL)",
    );
    return this;
  }
  all<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT value FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((row) => JSON.parse(String(row.value)) as T);
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
