import type { D1Database, D1Statement } from "./index.js";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema.generated.js";

export async function ensureD1Schema(db: D1Database): Promise<void> {
  const exists = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_doorman_schema'",
    )
    .all();
  if (!exists.success) throw new Error("D1 schema check failed");
  if (exists.results.length) {
    const version = await db
      .prepare("SELECT max(version) AS version FROM _doorman_schema")
      .all<{ version: number }>();
    if (!version.success) throw new Error("D1 schema check failed");
    if (Number(version.results[0]?.version) >= SCHEMA_VERSION) return;
  }
  // D1 batches commit atomically. Idempotent DDL also makes concurrent cold starts safe.
  const results = await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS _doorman_schema (version INTEGER PRIMARY KEY)",
    ),
    ...SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)),
    db
      .prepare("INSERT OR IGNORE INTO _doorman_schema (version) VALUES (?)")
      .bind(SCHEMA_VERSION),
  ]);
  if (results.some((result) => !result.success))
    throw new Error("D1 schema setup failed");
}

export function managedD1Database(db: D1Database) {
  let pending: Promise<void> | undefined;
  let retryAt = 0;
  const ready = () => {
    if (!pending || (retryAt && Date.now() >= retryAt)) {
      retryAt = 0;
      pending = ensureD1Schema(db).catch((error: unknown) => {
        retryAt = Date.now() + 5_000;
        throw error;
      });
    }
    return pending;
  };
  const originals = new WeakMap<D1Statement, D1Statement>();
  function wrap(statement: D1Statement): D1Statement {
    const wrapped: D1Statement = {
      bind: (...values) => wrap(statement.bind(...values)),
      async all<T>() {
        await ready();
        return statement.all<T>();
      },
      async run() {
        await ready();
        return statement.run();
      },
    };
    originals.set(wrapped, statement);
    return wrapped;
  }
  const managed: D1Database = {
    prepare: (sql) => wrap(db.prepare(sql)),
    async batch(statements) {
      await ready();
      return db.batch(statements.map((s) => originals.get(s) ?? s));
    },
  };
  return { db: managed, ready };
}
