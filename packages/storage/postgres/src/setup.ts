import type { PostgresDatabase } from "./index.js";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema.generated.js";

/** One transaction and transaction-scoped lock work with pools and clients alike. */
export async function ensurePostgresSchema(
  db: PostgresDatabase,
): Promise<void> {
  const exists = await db.query(
    "SELECT to_regclass('_doorman_schema') AS name",
  );
  if (exists.rows[0]?.name) {
    const version = await db.query(
      "SELECT max(version) AS version FROM _doorman_schema",
    );
    if (Number(version.rows[0]?.version) >= SCHEMA_VERSION) return;
  }
  await db.query(`DO $doorman_schema$ BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    PERFORM pg_advisory_xact_lock(hashtextextended(current_database() || '.' || current_schema() || '.doorman-schema', 0));
    CREATE TABLE IF NOT EXISTS _doorman_schema (version INTEGER PRIMARY KEY);
    IF COALESCE((SELECT max(version) FROM _doorman_schema), 0) < ${SCHEMA_VERSION} THEN
      ${SCHEMA_STATEMENTS.join(";\n")};
      INSERT INTO _doorman_schema (version) VALUES (${SCHEMA_VERSION}) ON CONFLICT DO NOTHING;
    END IF;
  END $doorman_schema$`);
}

/** Initialize on first use; concurrent calls share setup, and failures can recover. */
export function managedPostgresDatabase(db: PostgresDatabase) {
  let pending: Promise<void> | undefined;
  let retryAt = 0;
  const ready = () => {
    if (!pending || (retryAt && Date.now() >= retryAt)) {
      retryAt = 0;
      pending = ensurePostgresSchema(db).catch((error: unknown) => {
        retryAt = Date.now() + 5_000;
        throw error;
      });
    }
    return pending;
  };
  const managed: PostgresDatabase = {
    async query(sql, values) {
      await ready();
      return db.query(sql, values);
    },
  };
  return { db: managed, ready };
}
