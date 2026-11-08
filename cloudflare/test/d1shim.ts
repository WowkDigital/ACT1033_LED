// Minimal in-memory D1 stand-in on top of node:sqlite, enough for the Worker's queries (tests only).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

class Stmt {
  db: DatabaseSync;
  sql: string;
  args: unknown[] = [];
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...a: unknown[]) {
    this.args = a;
    return this;
  }
  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.args as never[]));
    return (row as T) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] };
  }
  async run() {
    this.db.prepare(this.sql).run(...(this.args as never[]));
    return { success: true };
  }
}

export function makeDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  return { prepare: (sql: string) => new Stmt(db, sql) } as unknown as D1Database;
}
