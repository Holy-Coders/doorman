import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(1936471201)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS jn_migrations (name TEXT PRIMARY KEY)",
  );
  // Existing pilot installs applied 0001 directly before this runner tracked versions.
  const exists = await client.query("SELECT to_regclass('jn_meta') AS name");
  if (exists.rows[0]?.name)
    await client.query(
      "INSERT INTO jn_migrations(name) VALUES ('0001_network.sql') ON CONFLICT DO NOTHING",
    );
  const directory = new URL(
    "../../../packages/network/migrations/",
    import.meta.url,
  );
  for (const name of (await readdir(directory))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await client.query("SELECT name FROM jn_migrations WHERE name=$1", [
          name,
        ])
      ).rowCount
    )
      continue;
    await client.query(await readFile(new URL(name, directory), "utf8"));
    await client.query("INSERT INTO jn_migrations(name) VALUES ($1)", [name]);
    console.log("Applied", name);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}
