import { createNetworkStorage } from "./storage.js";
export interface NetworkD1Statement {
  bind(...args: unknown[]): NetworkD1Statement;
  all(): Promise<{ results: Record<string, unknown>[] }>;
}
export interface NetworkD1Database {
  prepare(sql: string): NetworkD1Statement;
  batch(statements: NetworkD1Statement[]): Promise<unknown>;
}
export function createD1NetworkStorage(db: NetworkD1Database) {
  return createNetworkStorage({
    query: async (sql, args = []) =>
      (
        await db
          .prepare(sql)
          .bind(...args)
          .all()
      ).results,
    atomic: async (statements) => {
      await db.batch(
        statements.map((s) => db.prepare(s.sql).bind(...(s.args ?? []))),
      );
    },
  });
}
