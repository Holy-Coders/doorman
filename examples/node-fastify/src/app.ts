import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";
import { createNodeRequestListener } from "@aarondovturkel/doorman-adapters/node/http";
import type { ApiActivityContext } from "@aarondovturkel/doorman-adapters/node";
import type { PostgresDatabase } from "@aarondovturkel/doorman-storage-postgres";
export function createApp(
  db: PostgresDatabase,
  options: {
    apiKey?: string;
    secret?: string;
    origin?: string;
    activity?: { secret: string; apiToken: string };
  } = {},
) {
  if (options.activity && options.activity.apiToken.length < 32)
    throw new Error("Example API token must have at least 32 characters");
  const origin = new URL(options.origin ?? "http://localhost:3001").origin;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(origin).hostname,
  );
  const secret =
    options.secret ??
    options.activity?.secret ??
    (local ? "local-example-only-secret-change-before-deploying" : "");
  const visitor = createDoorman({
    db,
    secret,
    namespace: "fastify-example",
    crossDevice: true,
    evaluator: options.apiKey ? { apiKey: options.apiKey } : false,
    ...(options.activity
      ? {
          activity: { routes: [{ route: "GET /api/orders/:id" }] },
        }
      : {}),
  });
  const app = Fastify({ bodyLimit: 16_384, logger: false });
  const actors = new WeakMap<FastifyRequest, ApiActivityContext>();
  app.addHook("onSend", async (request, reply, payload) => {
    const context = actors.get(request);
    actors.delete(request);
    if (context)
      await visitor.activity!.observe(context, {
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      });
    return payload;
  });
  // Demonstration service credential. A real app resolves its authenticated actor.
  app.get("/api/orders/:id", async (request, reply) => {
    const expected = options.activity?.apiToken;
    if (!expected)
      return reply
        .code(404)
        .send({ error: "Enable the API activity example first" });
    const provided = Buffer.from(request.headers.authorization ?? "");
    const credential = Buffer.from(`Bearer ${expected}`);
    if (
      provided.length !== credential.length ||
      !timingSafeEqual(provided, credential)
    )
      return reply.code(401).send({ error: "Unauthorized" });
    actors.set(request, {
      route: "GET /api/orders/:id",
      key: { kind: "actor", id: "example-agent" },
      actor: { kind: "agent", delegated: false },
    });
    return {
      orderId: (request.params as { id: string }).id,
      status: "example",
    };
  });
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
  const handleNode = createNodeRequestListener(visitor, { origin });
  app.post(
    "/api/visitor",
    {
      // Admit and bound the raw body before Fastify allocates/parses it.
      onRequest: async (request, reply) => {
        reply.hijack();
        handleNode(request.raw, reply.raw);
      },
    },
    async () => {},
  );
  return app;
}
