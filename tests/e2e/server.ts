import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../../examples/node-fastify/src/app.js";
const db = new PGlite();
await db.exec(
  await readFile(
    new URL(
      "../../packages/storage/postgres/migrations/0001_visitors.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const app = createApp(db, { origin: "http://127.0.0.1:4318" });
app.post("/test/reset", async () => {
  await db.exec("TRUNCATE visitors CASCADE");
  return { ok: true };
});
app.get("/analytics-test", async (_request, reply) =>
  reply
    .type("text/html")
    .send(
      '<!doctype html><title>Local SDK conformance</title><script type="module" src="/analytics-test.js"></script>',
    ),
);
app.get("/analytics-test.js", async (_request, reply) =>
  reply
    .type("application/javascript")
    .send(
      await readFile(
        new URL("../../artifacts/analytics/client.js", import.meta.url),
        "utf8",
      ),
    ),
);
await app.listen({ port: 4318, host: "127.0.0.1" });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => db.close());
  });
