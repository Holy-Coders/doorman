import Fastify from "fastify";
import { Pool } from "pg";
import {
  createLearningService,
  createLearningOperator,
  createNetworkJevEvaluator,
} from "@janitor/network/server";
import { createPostgresNetworkStorage } from "@janitor/network/postgres";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 1000,
  statement_timeout: 2000,
});
const learning = createLearningService(createPostgresNetworkStorage(db), {
  evaluator: process.env.JEV_API_KEY
    ? createNetworkJevEvaluator({ apiKey: process.env.JEV_API_KEY })
    : undefined,
  evaluatorVersion: "jev-network-questions-v1",
  maxEvaluationsPerDay: Number(process.env.MAX_EVALUATIONS_PER_DAY ?? 0),
  maxEvaluationsLifetime: Number(process.env.MAX_EVALUATIONS_LIFETIME ?? 0),
});
const operator = process.env.OPERATOR_KEY_HASH
  ? createLearningOperator(learning, process.env.OPERATOR_KEY_HASH)
  : undefined;
const app = Fastify({
  logger: false,
  bodyLimit: 16_384,
  requestTimeout: 10_000,
});
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_request, body, done) => done(null, body),
);
app.all("/*", async (req, reply) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (typeof value === "string") headers.set(name, value);
  const request = new Request("http://localhost" + req.url, {
    method: req.method,
    headers,
    ...(typeof req.body === "string" ? { body: req.body } : {}),
  });
  const result = req.url.startsWith("/operator/")
    ? operator
      ? await operator(request)
      : Response.json({ error: "Operator API disabled" }, { status: 503 })
    : await learning.handle(request);
  reply.status(result.status);
  result.headers.forEach((value, name) => reply.header(name, value));
  return reply.send(await result.text());
});
await app.listen({
  port: Number(process.env.PORT ?? 3002),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(
  "Janitor learning service listening; raw request logging is disabled",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => db.end());
  });
