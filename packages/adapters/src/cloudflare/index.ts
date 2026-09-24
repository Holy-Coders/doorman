import { simpleOptions, type SimpleOptions } from "../simple.js";
import type { EdgeEvidence } from "@aarondovturkel/doorman-core";
import {
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
import {
  createD1ContextStorage,
  createD1Storage,
  createD1IdentityStorage,
  createD1LearningStorage,
  createD1ProtectionStorage,
  createD1EvidenceStorage,
  createD1ActivityStorage,
  createD1OperatorStorage,
} from "@aarondovturkel/doorman-storage-d1";
import type { D1Database } from "@aarondovturkel/doorman-storage-d1";
import { createCloudflareJevEvaluator } from "@aarondovturkel/doorman-evaluator-cloudflare-jev";
import type { WorkersAI } from "@aarondovturkel/doorman-evaluator-cloudflare-jev";
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
    options.protection ||
      options.activity ||
      options.operators ||
      options.reputation
      ? postgres
        ? createPostgresProtectionStorage(postgres)
        : createD1ProtectionStorage(d1!)
      : undefined,
    options.evidence
      ? postgres
        ? createPostgresEvidenceStorage(postgres)
        : createD1EvidenceStorage(d1!)
      : undefined,
    options.activity
      ? postgres
        ? createPostgresActivityStorage(postgres)
        : createD1ActivityStorage(d1!)
      : undefined,
    options.operators
      ? postgres
        ? createPostgresOperatorStorage(postgres)
        : createD1OperatorStorage(d1!)
      : undefined,
    options.identityContext
      ? postgres
        ? createPostgresContextStorage(postgres)
        : createD1ContextStorage(d1!)
      : undefined,
  );
}

/** Use the inbound Worker Request, never cf reconstructed from forwarded headers. */
export function cloudflareRequestEvidence(
  request: Request,
  options: { transport?: boolean } = {},
): (EdgeEvidence & { provider: "cloudflare" }) | undefined {
  const cf = (
    request as Request & {
      cf?: {
        botManagement?: {
          score?: unknown;
          verifiedBot?: unknown;
          signedAgent?: unknown;
          ja4?: unknown;
        };
      };
    }
  ).cf;
  const bot = cf?.botManagement;
  if (!bot) return undefined;
  const ja4 =
    options.transport &&
    typeof bot.ja4 === "string" &&
    /^[tqd][a-z0-9]{9}_[a-f0-9]{12}_[a-f0-9]{12}$/.test(bot.ja4)
      ? bot.ja4
      : undefined;
  const botScore =
    typeof bot.score === "number" &&
    Number.isInteger(bot.score) &&
    bot.score >= 1 &&
    bot.score <= 99
      ? bot.score
      : undefined;
  const verifiedBot =
    typeof bot.verifiedBot === "boolean" ? bot.verifiedBot : undefined;
  const signedAgent =
    typeof bot.signedAgent === "boolean" ? bot.signedAgent : undefined;
  if (
    botScore === undefined &&
    verifiedBot === undefined &&
    signedAgent === undefined &&
    ja4 === undefined
  )
    return undefined;
  return {
    source: "edge",
    provider: "cloudflare",
    observedAt: Date.now(),
    ...(ja4 ? { ja4 } : {}),
    ...(botScore !== undefined ? { botScore } : {}),
    ...(verifiedBot !== undefined ? { verifiedBot } : {}),
    ...(signedAgent !== undefined ? { signedAgent } : {}),
  };
}

/** Recommended identity/context flow; advanced services remain optional. */
export function createDoorman(
  options: SimpleOptions & {
    db: D1Database | PostgresDatabase;
    ai?: WorkersAI;
  },
) {
  return createCloudflareVisitor({ ...options, ...simpleOptions(options) });
}
