import {
  createPostgresStorage,
  createPostgresIdentityStorage,
  createPostgresLearningStorage,
} from "@janitor/storage-postgres";
import type { PostgresDatabase } from "@janitor/storage-postgres";
import {
  createD1Storage,
  createD1IdentityStorage,
  createD1LearningStorage,
} from "@janitor/storage-d1";
import type { D1Database } from "@janitor/storage-d1";
import { createCloudflareJevEvaluator } from "@janitor/evaluator-cloudflare-jev";
import type { WorkersAI } from "@janitor/evaluator-cloudflare-jev";
import { createVisitorHandler } from "../handler.js";
import type { AdapterOptions } from "../handler.js";
export type CloudflareVisitorOptions = AdapterOptions & {
  db: D1Database | PostgresDatabase;
  ai?: WorkersAI;
};
export function createCloudflareVisitor(options: CloudflareVisitorOptions) {
  const evaluator = options.ai
    ? createCloudflareJevEvaluator(options.ai, {
        timeoutMs: options.evaluatorTimeoutMs,
      })
    : undefined;
  const postgres = "query" in options.db ? options.db : undefined;
  const d1 = postgres ? undefined : (options.db as D1Database);
  return createVisitorHandler(
    postgres
      ? createPostgresStorage(postgres, options)
      : createD1Storage(d1!, options),
    evaluator,
    options,
    options.identity
      ? postgres
        ? createPostgresIdentityStorage(postgres)
        : createD1IdentityStorage(d1!)
      : undefined,
    options.learning
      ? postgres
        ? createPostgresLearningStorage(postgres)
        : createD1LearningStorage(d1!)
      : undefined,
  );
}
