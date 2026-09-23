import { createNetworkStorage } from "./storage.js";
export interface NetworkPostgresClient {
  query(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface NetworkPostgresPool {
  query(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<NetworkPostgresClient>;
}
const bind = (sql: string) => {
  let i = 0;
  return sql.replaceAll("?", () => `$${++i}`);
};
/** Caller owns the pool, TLS and statement_timeout. */
export function createPostgresNetworkStorage(db: NetworkPostgresPool) {
  return createNetworkStorage({
    query: async (sql, args) => (await db.query(bind(sql), args)).rows,
    async atomic(statements) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const s of statements) await client.query(bind(s.sql), s.args);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  });
}
