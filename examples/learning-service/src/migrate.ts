import { Pool } from "pg";
import { readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await db.query(
    await readFile(
      new URL(
        "../../../packages/network/migrations/0001_network.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
} finally {
  await db.end();
}
