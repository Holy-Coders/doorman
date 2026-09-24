import { simpleOptions, type SimpleOptions } from "../simple.js";
import type { VisitorEvaluator } from "@aarondovturkel/doorman-core";
import {
  managedPostgresDatabase,
  createPostgresContextStorage,
  createPostgresStorage,
  createPostgresIdentityStorage,
  createPostgresLearningStorage,
  createPostgresProtectionStorage,
  createPostgresEvidenceStorage,
  createPostgresActivityStorage,
  createPostgresOperatorStorage,
} from "@aarondovturkel/doorman-storage-postgres";
import type { PostgresDatabase } from "@aarondovturkel/doorman-storage-postgres";
import { createJevEvaluator } from "@aarondovturkel/doorman-evaluator-jev";
import type { JevOptions } from "@aarondovturkel/doorman-evaluator-jev";
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
    options.protection ||
      options.activity ||
      options.operators ||
      options.reputation
      ? createPostgresProtectionStorage(options.db)
      : undefined,
    options.evidence ? createPostgresEvidenceStorage(options.db) : undefined,
    options.activity ? createPostgresActivityStorage(options.db) : undefined,
    options.operators ? createPostgresOperatorStorage(options.db) : undefined,
    options.identityContext
      ? createPostgresContextStorage(options.db)
      : undefined,
  );
}
export type { ProtectionOptions, AdmissionContext } from "../protection.js";
export type {
  ApiActivityOptions,
  ApiActivityContext,
  ApiActivityResult,
  ApiActivityAssessment,
} from "../activity.js";

export type {
  EvidenceOptions,
  TrustedRequestEvidence,
  ApplicationEventInput,
  DeviceLinkInput,
} from "../evidence.js";

/** Recommended identity/context flow; advanced services remain optional. */
export function createDoorman(
  options: SimpleOptions & {
    db: PostgresDatabase;
    evaluator?: NodeVisitorOptions["evaluator"];
  },
) {
  if (
    options.autoMigrate !== undefined &&
    typeof options.autoMigrate !== "boolean"
  )
    throw new Error("autoMigrate must be a boolean");
  const managed =
    options.autoMigrate === false
      ? undefined
      : managedPostgresDatabase(options.db);
  return {
    ...createNodeVisitor({
      ...options,
      db: managed?.db ?? options.db,
      ...simpleOptions(options),
    }),
    ready: managed?.ready ?? (() => Promise.resolve()),
  };
}
