import type { ProductDB } from "./product-db.ts";

export type RecordFilter<T> = {
  [K in keyof T &
    (
      | "id"
      | "botId"
      | "sessionId"
      | "runId"
      | "status"
      | "parentJobId"
      | "rootJobId"
      | "workContextId"
      | "delegatedBy"
      | "deletedAt"
    )]?: T[K];
};

/** A domain's record kind and value type are fixed once, at construction. */
export class RecordRepository<T extends { id: string }> {
  private readonly database: ProductDB;
  private readonly kind: string;
  constructor(database: ProductDB, kind: string) {
    this.database = database;
    this.kind = kind;
  }
  list(filter: RecordFilter<T> = {}): T[] {
    return this.database.query<T>(this.kind, filter);
  }
  get(id: string): T | undefined {
    return this.database.get<T>(this.kind, id);
  }
  put(value: T): T {
    return this.database.put(this.kind, value);
  }
  remove(id: string) {
    this.database.remove(this.kind, id);
  }
}
