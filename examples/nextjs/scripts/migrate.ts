import { readFile } from "node:fs/promises";
import { Pool } from "pg";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TABLE IF NOT EXISTS visitor_migrations (name TEXT PRIMARY KEY)",
    );
    await client.query("LOCK TABLE visitor_migrations IN EXCLUSIVE MODE");
    for (const name of ["0001_visitors", "0002_identity", "0003_learning"]) {
      const applied = await client.query(
        "SELECT name FROM visitor_migrations WHERE name = $1",
        [name],
      );
      if (!applied.rowCount) {
        const sql = await readFile(
          new URL(
            `../../../packages/storage/postgres/migrations/${name}.sql`,
            import.meta.url,
          ),
          "utf8",
        );
        await client.query(sql);
        await client.query(
          "INSERT INTO visitor_migrations (name) VALUES ($1)",
          [name],
        );
      }
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
