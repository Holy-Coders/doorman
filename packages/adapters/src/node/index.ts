import type { VisitorEvaluator } from "@janitor/core";
import {
  createPostgresStorage,
  createPostgresIdentityStorage,
  createPostgresLearningStorage,
} from "@janitor/storage-postgres";
import type { PostgresDatabase } from "@janitor/storage-postgres";
import { createJevEvaluator } from "@janitor/evaluator-jev";
import type { JevOptions } from "@janitor/evaluator-jev";
import { createVisitorHandler } from "../handler.js";
import type { AdapterOptions } from "../handler.js";
export { createVisitorHandler } from "../handler.js";
export type {
  AdapterOptions,
  VisitorRequestContext,
  VisitorAssessment,
} from "../handler.js";
export type NodeVisitorOptions = AdapterOptions & {
  db: PostgresDatabase;
  evaluator?: JevOptions | VisitorEvaluator | false;
};
export function createNodeVisitor(options: NodeVisitorOptions) {
  const evaluator = options.evaluator
    ? "evaluate" in options.evaluator
      ? options.evaluator
      : createJevEvaluator({
          ...options.evaluator,
          timeoutMs: options.evaluator.timeoutMs ?? options.evaluatorTimeoutMs,
        })
    : undefined;
  return createVisitorHandler(
    createPostgresStorage(options.db, options),
    evaluator,
    options,
    options.identity ? createPostgresIdentityStorage(options.db) : undefined,
    options.learning ? createPostgresLearningStorage(options.db) : undefined,
  );
}
