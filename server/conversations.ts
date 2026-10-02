import { finishDelivery } from "./task-lifecycle.ts";
import { sessionSchema } from "./storage-schema.ts";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  ChatMessage,
  Session,
  WorkContext,
  ContextUsage,
} from "../shared/types.ts";

const decode = <T>(row: any): T | undefined =>
  row ? JSON.parse(row.value) : undefined;
const fail = (message: string, status = 404): never => {
  throw Object.assign(new Error(message), { status });
};
export interface HistoryHit {
  createdAt?: string;
  truncated?: boolean;
  id: string;
  sessionId: string;
  workContextId: string;
  role: string;
  content: string;
  sequence: number;
  channel: string;
}

/** Full history lives here. The application's Store only caches the latest page. */
export class ConversationStore {
  db: DatabaseSync;
  directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
    this.db = new DatabaseSync(join(directory, "conversations.sqlite"));
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version > 1) {
      this.db.close();
      throw new Error("不支援的對話資料庫版本。");
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,value TEXT NOT NULL,active_context TEXT);
      CREATE TABLE IF NOT EXISTS contexts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,value TEXT NOT NULL,checkpoint TEXT);
      CREATE INDEX IF NOT EXISTS contexts_session ON contexts(session_id);
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,channel TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(context_id,channel,id));
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,channel,seq);
      CREATE INDEX IF NOT EXISTS messages_context ON messages(context_id,seq);
      CREATE TABLE IF NOT EXISTS compactions(id INTEGER PRIMARY KEY AUTOINCREMENT,context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,run_id TEXT NOT NULL,boundary TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(context_id,run_id,boundary));
      CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(content,content='messages',content_rowid='seq',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO history_fts(rowid,content) VALUES(new.seq,new.content); END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO history_fts(history_fts,rowid,content) VALUES('delete',old.seq,old.content); END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN INSERT INTO history_fts(history_fts,rowid,content) VALUES('delete',old.seq,old.content); INSERT INTO history_fts(rowid,content) VALUES(new.seq,new.content); END;
      INSERT OR IGNORE INTO meta VALUES('schema','1'); PRAGMA user_version=1;`);
    if (
      this.db.prepare("SELECT value FROM meta WHERE key='schema'").get()
        ?.value !== "1"
    )
      throw new Error("不支援的對話資料庫版本。");
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  metadata(id: string): Session {
    return (
      decode<Session>(
        this.db.prepare("SELECT value FROM sessions WHERE id=?").get(id),
      ) ?? fail("找不到工作階段。")
    );
  }
  updateSession(
    id: string,
    patch: Partial<Pick<Session, "title" | "project">>,
  ) {
    this.saveSession({ ...this.metadata(id), ...patch });
  }
  saveSession(session: Session) {
    sessionSchema.parse(session);
    const { messages, engineState, ...metadata } = session;
    const previous = this.db
      .prepare("SELECT active_context FROM sessions WHERE id=?")
      .get(session.id);
    const contextId = String(
      previous?.active_context ||
        session.workContextId ||
        `${session.id}:initial`,
    );
    this.db
      .prepare(
        "INSERT INTO sessions(id,value,active_context) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(
        session.id,
        JSON.stringify({ ...metadata, workContextId: contextId, messages: [] }),
        contextId,
      );
    if (!previous) {
      const context: WorkContext = {
        id: contextId,
        sessionId: session.id,
        kind: "chat",
        createdAt: session.createdAt,
      };
      this.db
        .prepare("INSERT INTO contexts(id,session_id,value) VALUES(?,?,?)")
        .run(contextId, session.id, JSON.stringify(context));
    }
    for (const message of messages)
      this.append(session.id, message, message.workContextId || contextId);
    if (engineState !== undefined)
      this.saveCheckpoint(session.id, contextId, engineState);
  }
  activeId(sessionId: string): string {
    const row = this.db
      .prepare("SELECT active_context FROM sessions WHERE id=?")
      .get(sessionId);
    return row ? String(row.active_context) : fail("找不到工作階段。");
  }
  context(sessionId: string, id = this.activeId(sessionId)): WorkContext {
    return (
      decode<WorkContext>(
        this.db
          .prepare("SELECT value FROM contexts WHERE id=? AND session_id=?")
          .get(id, sessionId),
      ) ?? fail("找不到工作 context。")
    );
  }
  contexts(sessionId: string, before?: string) {
    return this.db
      .prepare(
        "SELECT value FROM contexts WHERE session_id=? AND (? IS NULL OR rowid < (SELECT rowid FROM contexts WHERE id=? AND session_id=?)) ORDER BY rowid DESC LIMIT 50",
      )
      .all(sessionId, before || null, before || null, sessionId)
      .map((row) => decode<WorkContext>(row)!);
  }
  updateContext(sessionId: string, id: string, patch: Partial<WorkContext>) {
    const context = { ...this.context(sessionId, id), ...patch, id, sessionId };
    this.db
      .prepare("UPDATE contexts SET value=? WHERE id=? AND session_id=?")
      .run(JSON.stringify(context), id, sessionId);
    return context;
  }
  createContext(
    sessionId: string,
    kind: WorkContext["kind"] = "chat",
    id = randomUUID(),
  ) {
    const context: WorkContext = {
      id,
      sessionId,
      kind,
      createdAt: new Date().toISOString(),
    };
    this.transaction(() => {
      this.metadata(sessionId);
      if (kind === "chat") {
        const previous = this.context(sessionId);
        previous.endedAt = context.createdAt;
        this.db
          .prepare("UPDATE contexts SET value=? WHERE id=?")
          .run(JSON.stringify(previous), previous.id);
      }
      this.db
        .prepare("INSERT INTO contexts(id,session_id,value) VALUES(?,?,?)")
        .run(id, sessionId, JSON.stringify(context));
      if (kind === "chat") {
        const session = this.metadata(sessionId);
        session.workContextId = id;
        this.db
          .prepare("UPDATE sessions SET active_context=?,value=? WHERE id=?")
          .run(id, JSON.stringify(session), sessionId);
      }
    });
    return context;
  }
  append(
    sessionId: string,
    message: ChatMessage,
    contextId = this.activeId(sessionId),
  ) {
    this.context(sessionId, contextId);
    const value = { ...message, workContextId: contextId };
    delete value.sequence;
    this.db
      .prepare(
        `INSERT INTO messages(id,session_id,context_id,channel,role,content,value) VALUES(?,?,?,'chat',?,?,?)
      ON CONFLICT(context_id,channel,id) DO UPDATE SET content=excluded.content,value=excluded.value
      WHERE messages.value != excluded.value`,
      )
      .run(
        message.id,
        sessionId,
        contextId,
        message.role,
        message.content,
        JSON.stringify(value),
      );
  }
  /** Durable completion inbox; independent of the UI's paged transcript. */
  backgroundResults(sessionId: string, contextId: string, after: number) {
    this.context(sessionId, contextId);
    return this.db
      .prepare(
        "SELECT seq,value FROM messages WHERE session_id=? AND context_id=? AND channel='chat' AND id GLOB 'work-result-*' AND json_extract(value,'$.status')='complete' AND seq>? ORDER BY seq",
      )
      .all(sessionId, contextId, after)
      .map((row) => ({
        ...decode<ChatMessage>(row)!,
        sequence: Number(row.seq),
      }));
  }
  updateDelivery(
    sessionId: string,
    messageId: string,
    state: "applied" | "not-applied",
  ) {
    const message = this.message(sessionId, messageId);
    if (message?.delivery?.state !== "pending") return;
    this.append(
      sessionId,
      finishDelivery(message, state),
      message.workContextId,
    );
  }
  finishSteering(sessionId: string, runId: string) {
    this.transaction(() => {
      const pending = this.db
        .prepare(
          "SELECT value FROM messages WHERE session_id=? AND channel='chat' AND json_extract(value,'$.runId')=? AND json_extract(value,'$.delivery.kind')='steer' AND json_extract(value,'$.delivery.state')='pending'",
        )
        .all(sessionId, runId);
      for (const row of pending)
        this.updateDelivery(
          sessionId,
          (JSON.parse(String(row.value)) as ChatMessage).id,
          "not-applied",
        );
    });
  }
  message(sessionId: string, id: string): ChatMessage | undefined {
    const row = this.db
      .prepare(
        "SELECT seq,value FROM messages WHERE session_id=? AND id=? AND channel='chat'",
      )
      .get(sessionId, id);
    return row
      ? { ...decode<ChatMessage>(row)!, sequence: Number(row.seq) }
      : undefined;
  }
  page(sessionId: string, before?: number, limit = 50, contextId?: string) {
    limit = Math.min(100, Math.max(1, Math.floor(limit)));
    this.metadata(sessionId);
    if (contextId) this.context(sessionId, contextId);
    const rows = this.db
      .prepare(
        `SELECT seq,value FROM messages WHERE session_id=? AND channel='chat'
      AND (? IS NULL OR seq<?) AND (? IS NULL OR context_id=?) ORDER BY seq DESC LIMIT ?`,
      )
      .all(
        sessionId,
        before ?? null,
        before ?? null,
        contextId || null,
        contextId || null,
        Math.min(100, Math.max(1, limit)) + 1,
      );
    const more = rows.length > limit;
    const selected = rows.slice(0, limit).reverse();
    return {
      messages: selected.map((row) => ({
        ...decode<ChatMessage>(row)!,
        sequence: Number(row.seq),
      })),
      olderCursor: more ? Number(selected[0].seq) : undefined,
    };
  }
  load(sessionId: string, contextId = this.activeId(sessionId)): Session {
    this.context(sessionId, contextId);
    const row = this.db
      .prepare("SELECT checkpoint FROM contexts WHERE id=?")
      .get(contextId);
    return {
      ...this.metadata(sessionId),
      workContextId: contextId,
      messages: this.page(sessionId, undefined, 50, contextId).messages,
      ...(row?.checkpoint
        ? { engineState: JSON.parse(String(row.checkpoint)) }
        : {}),
    };
  }
  cachedSessions(): Session[] {
    return this.db
      .prepare("SELECT id FROM sessions ORDER BY rowid DESC")
      .all()
      .map((row) => ({
        ...this.metadata(String(row.id)),
        ...this.page(String(row.id)),
      }));
  }
  saveCheckpoint(sessionId: string, contextId: string, checkpoint: unknown) {
    this.context(sessionId, contextId);
    this.db
      .prepare("UPDATE contexts SET checkpoint=? WHERE id=?")
      .run(JSON.stringify(checkpoint), contextId);
  }
  setUsage(sessionId: string, contextId: string, usage: ContextUsage) {
    const context = this.context(sessionId, contextId);
    this.db
      .prepare("UPDATE contexts SET value=? WHERE id=?")
      .run(JSON.stringify({ ...context, usage }), contextId);
  }
  archiveEngine(
    sessionId: string,
    contextId: string,
    runId: string,
    messages: { type: string; data: Record<string, any> }[],
  ) {
    this.context(sessionId, contextId);
    this.transaction(() => {
      for (const message of messages) {
        const id = String(message.data.id);
        const content =
          typeof message.data.content === "string"
            ? message.data.content
            : JSON.stringify(message.data.content);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO messages(id,session_id,context_id,channel,role,content,value) VALUES(?,?,?,'engine',?,?,?)",
          )
          .run(
            id,
            sessionId,
            contextId,
            message.type,
            content || "",
            JSON.stringify({ ...message, runId }),
          );
      }
    });
  }
  recordCompaction(
    contextId: string,
    runId: string,
    boundary: string,
    value: unknown,
  ) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO compactions(context_id,run_id,boundary,value) VALUES(?,?,?,?)",
      )
      .run(contextId, runId, boundary, JSON.stringify(value));
  }
  compactions(sessionId: string, contextId = this.activeId(sessionId)) {
    this.context(sessionId, contextId);
    return this.db
      .prepare(
        "SELECT id,value FROM compactions WHERE context_id=? ORDER BY id DESC LIMIT 20",
      )
      .all(contextId)
      .map((row) => ({ id: Number(row.id), ...JSON.parse(String(row.value)) }));
  }
  search(
    query: string,
    sessionIds: string[],
    before?: number,
    contextId?: string,
  ): HistoryHit[] {
    const clean = query.trim();
    if (clean.length < 2 || clean.length > 200)
      fail("查詢需為 2–200 字。", 400);
    if (!sessionIds.length) return [];
    const terms = [
      ...new Set(
        Array.from(
          clean.matchAll(/"([^"]+)"|(\S+)/gu),
          (match) => match[1] ?? match[2],
        ),
      ),
    ];
    const condition = terms
      .map((term) =>
        [...term].length >= 3
          ? "m.seq IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?)"
          : "instr(lower(m.content),lower(?))>0",
      )
      .join(" AND ");
    const args: SQLInputValue[] = [
      ...sessionIds,
      contextId ?? null,
      contextId ?? null,
      before ?? null,
      before ?? null,
      ...terms.map((term) =>
        [...term].length >= 3 ? '"' + term.replaceAll('"', '""') + '"' : term,
      ),
    ];
    return this.db
      .prepare(
        `SELECT m.* FROM messages m WHERE m.session_id IN (${sessionIds.map(() => "?").join(",")})
      AND (? IS NULL OR m.context_id=?) AND (m.channel='chat' OR m.role='tool') AND (? IS NULL OR m.seq<?) AND ${condition} ORDER BY m.seq DESC LIMIT 20`,
      )
      .all(...args)
      .map((row) => this.hit(row, terms[0]));
  }
  private hit(row: any, query = "", complete = false): HistoryHit {
    const text = String(row.content);
    const start = Math.max(
      0,
      text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 160,
    );
    const content = complete ? text : text.slice(start, start + 1500);
    return {
      id: String(row.id),
      createdAt: (JSON.parse(String(row.value)) as ChatMessage).createdAt,
      sessionId: String(row.session_id),
      workContextId: String(row.context_id),
      role: String(row.role),
      sequence: Number(row.seq),
      channel: String(row.channel),
      content,
      truncated: content !== text,
    };
  }
  fullMessage(
    sessionIds: string[],
    sequence: number,
    contextId?: string,
  ): HistoryHit {
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      return fail("找不到訊息。");
    const row = this.db
      .prepare("SELECT * FROM messages WHERE seq=?")
      .get(sequence);
    if (
      !row ||
      !sessionIds.includes(String(row.session_id)) ||
      (contextId && row.context_id !== contextId) ||
      (row.channel !== "chat" && row.role !== "tool")
    )
      return fail("找不到訊息。");
    return this.hit(row, "", true);
  }
  around(
    sessionIds: string[],
    sequence: number,
    contextId?: string,
  ): HistoryHit[] {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE seq=?")
      .get(sequence);
    if (
      !row ||
      !sessionIds.includes(String(row.session_id)) ||
      (contextId && row.context_id !== contextId)
    )
      return fail("找不到訊息。");
    const args = [
      row.session_id,
      row.context_id,
      row.channel,
    ] as SQLInputValue[];
    const before = this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id=? AND context_id=? AND channel=? AND seq<=? ORDER BY seq DESC LIMIT 6",
      )
      .all(...args, sequence)
      .reverse();
    const after = this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id=? AND context_id=? AND channel=? AND seq>? ORDER BY seq LIMIT 5",
      )
      .all(...args, sequence);
    return [...before, ...after].map((row) => this.hit(row));
  }
  scratchRoot(sessionId: string, contextId: string) {
    this.context(sessionId, contextId);
    return join(
      this.directory,
      "context-files",
      createHash("sha256").update(sessionId).digest("hex"),
      createHash("sha256").update(contextId).digest("hex"),
    );
  }
  async remove(sessionId: string) {
    const root = resolve(this.directory, "context-files");
    const target = resolve(
      root,
      createHash("sha256").update(sessionId).digest("hex"),
    );
    if (!target.startsWith(root + sep))
      throw new Error("Invalid context directory");
    await rm(target, { recursive: true, force: true });
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
  }
  async *exportChunks(): AsyncGenerator<string> {
    const snapshot = new DatabaseSync(
      join(this.directory, "conversations.sqlite"),
      { readOnly: true },
    );
    snapshot.exec("BEGIN");
    try {
      yield '{"schemaVersion":1';
      for (const table of ["sessions", "contexts", "messages", "compactions"]) {
        yield `,"${table}":[`;
        let first = true;
        for (const row of snapshot
          .prepare(`SELECT * FROM ${table}`)
          .iterate()) {
          yield (first ? "" : ",") + JSON.stringify(row);
          first = false;
        }
        yield "]";
      }
      yield ',"files":[';
      let first = true;
      const root = join(this.directory, "context-files");
      async function* walk(dir: string): AsyncGenerator<string> {
        for (const item of await readdir(dir, { withFileTypes: true }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        )) {
          if (item.isSymbolicLink()) continue;
          if (item.isDirectory()) yield* walk(join(dir, item.name));
          else if (item.isFile()) yield join(dir, item.name);
        }
      }
      for await (const file of walk(root)) {
        yield (first ? "" : ",") +
          JSON.stringify({
            path: file.slice(root.length + 1).replaceAll("\\", "/"),
            base64: (await readFile(file)).toString("base64"),
          });
        first = false;
      }
      yield "]}";
    } finally {
      snapshot.exec("ROLLBACK");
      snapshot.close();
    }
  }
}
