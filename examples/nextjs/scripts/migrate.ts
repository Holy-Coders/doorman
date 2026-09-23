import { readFile } from "node:fs/promises";
import { Pool } from "pg";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const sql = await readFile(
    new URL(
      "../../../packages/storage/postgres/migrations/0001_visitors.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TABLE IF NOT EXISTS visitor_migrations (name TEXT PRIMARY KEY)",
    );
    await client.query("LOCK TABLE visitor_migrations IN EXCLUSIVE MODE");
    const applied = await client.query(
      "SELECT name FROM visitor_migrations WHERE name = $1",
      ["0001_visitors"],
    );
    if (!applied.rowCount) {
      await client.query(sql);
      await client.query("INSERT INTO visitor_migrations (name) VALUES ($1)", [
        "0001_visitors",
      ]);
    }
    await client.query("COMMIT");
    console.log("Visitor migration applied");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await db.end();
}
