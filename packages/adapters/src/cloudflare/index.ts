import type { EdgeEvidence } from "@janitor/core";
import {
  createPostgresStorage,
  createPostgresIdentityStorage,
  createPostgresLearningStorage,
  createPostgresProtectionStorage,
  createPostgresEvidenceStorage,
  createPostgresActivityStorage,
} from "@janitor/storage-postgres";
import type { PostgresDatabase } from "@janitor/storage-postgres";
import {
  createD1Storage,
  createD1IdentityStorage,
  createD1LearningStorage,
  createD1ProtectionStorage,
  createD1EvidenceStorage,
  createD1ActivityStorage,
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
    options.protection || options.activity
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
  );
}

/** Use the inbound Worker Request, never cf reconstructed from forwarded headers. */
export function cloudflareRequestEvidence(
  request: Request,
): (EdgeEvidence & { provider: "cloudflare" }) | undefined {
  const cf = (
    request as Request & {
      cf?: {
        botManagement?: {
          score?: unknown;
          verifiedBot?: unknown;
          signedAgent?: unknown;
        };
      };
    }
  ).cf;
  const bot = cf?.botManagement;
  if (!bot) return undefined;
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
    signedAgent === undefined
  )
    return undefined;
  return {
    source: "edge",
    provider: "cloudflare",
    observedAt: Date.now(),
    ...(botScore !== undefined ? { botScore } : {}),
    ...(verifiedBot !== undefined ? { verifiedBot } : {}),
    ...(signedAgent !== undefined ? { signedAgent } : {}),
  };
}
