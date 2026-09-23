import { Pool } from "pg";
import { createApp } from "./app.js";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env");
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 1000,
  statement_timeout: 2000,
});
const app = createApp(db, {
  apiKey: process.env.JEV_API_KEY,
  origin: process.env.APP_ORIGIN,
  activity:
    process.env.JANITOR_API_ACTIVITY === "1"
      ? {
          secret: process.env.JANITOR_IDENTITY_SECRET ?? "",
          apiToken: process.env.EXAMPLE_API_TOKEN ?? "",
        }
      : undefined,
});
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
console.log(`Visitor example listening on http://localhost:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => db.end());
  });
