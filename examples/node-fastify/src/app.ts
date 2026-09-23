import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { createNodeVisitor } from "@janitor/adapters/node";
import type { PostgresDatabase } from "@janitor/storage-postgres";
export function createApp(
  db: PostgresDatabase,
  options: { apiKey?: string; origin?: string } = {},
) {
  const origin = new URL(options.origin ?? "http://localhost:3001").origin;
  const visitor = createNodeVisitor({
    db,
    evaluator: options.apiKey ? { apiKey: options.apiKey } : false,
  });
  const app = Fastify({ bodyLimit: 16_384, logger: false });
  app.get("/", async (_request, reply) =>
    reply
      .type("text/html")
      .send(
        await readFile(
          new URL("../public/index.html", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/visitor.js", async (_request, reply) =>
    reply
      .type("text/javascript")
      .send(
        await readFile(
          new URL("../public/visitor.js", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.post("/api/visitor", async (request, reply) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    // Fastify has already parsed/size-limited the body. Forward only the canonical origin.
    headers.delete("content-length");
    const response = await visitor.handle(
      new Request(`${origin}/api/visitor`, {
        method: "POST",
        headers,
        body: JSON.stringify(request.body),
      }),
    );
    reply.code(response.status);
    response.headers.forEach((value, name) => reply.header(name, value));
    return reply.send(await response.text());
  });
  return app;
}
