import { createD1Storage } from "@janitor/storage-d1";
import type { D1Database } from "@janitor/storage-d1";
import { createCloudflareJevEvaluator } from "@janitor/evaluator-cloudflare-jev";
import type { WorkersAI } from "@janitor/evaluator-cloudflare-jev";
import { createVisitorHandler } from "../handler.js";
import type { AdapterOptions } from "../handler.js";
export type CloudflareVisitorOptions = AdapterOptions & {
  db: D1Database;
  ai?: WorkersAI;
};
export function createCloudflareVisitor(options: CloudflareVisitorOptions) {
  const evaluator = options.ai
    ? createCloudflareJevEvaluator(options.ai, {
        timeoutMs: options.evaluatorTimeoutMs,
      })
    : undefined;
  return createVisitorHandler(
    createD1Storage(options.db, options),
    evaluator,
    options,
  );
}
