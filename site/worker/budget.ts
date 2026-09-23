import type { D1Database } from "@janitor/storage-d1";
import type { WorkersAI } from "@janitor/evaluator-cloudflare-jev";
import { unwrapCloudflareJevResponse } from "@janitor/evaluator-cloudflare-jev";
import type { JevRequest } from "@janitor/evaluator-jev";
import { isProbability } from "@janitor/core";

function readNoul(value: unknown, key: string): number {
  const answer = (
    value as {
      answers?: Record<string, { type?: string; noul?: unknown }>;
    } | null
  )?.answers?.[key];
  if (answer?.type !== "noul" || !isProbability(answer.noul))
    throw new Error("Malformed demo evaluation");
  return answer.noul;
}

export const DEMO_LIMITS = {
  totalCalls: 100,
  dailyCalls: 20,
  cacheMs: 86_400_000,
  pendingMs: 60_000,
  inputBytes: 16_384,
  providerTimeoutMs: 2500,
  sessionMs: 86_400_000,
} as const;
export type DemoEvaluation = {
  source: "jev" | "cache" | "fallback";
  evaluatedAt?: number;
};

export async function rows<T>(
  db: D1Database,
  sql: string,
  values: unknown[] = [],
) {
  const result = await db
    .prepare(sql)
    .bind(...values)
    .all<T>();
  if (!result.success) throw new Error("Demo storage unavailable");
  return result.results;
}
export async function signingKey(secret: string) {
  if (secret.length < 32) throw new Error("Missing demo secret");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function digest(secret: string, text: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// Identical snapshots are one piece of evidence. Send exactly the compacted input we cache.
function compact(input: JevRequest): JevRequest {
  const unique = (history: unknown) =>
    Array.isArray(history)
      ? [
          ...new Map(
            history.map((item) => [JSON.stringify(item), item]),
          ).values(),
        ]
      : history;
  const history = input.state.history;
  const kept = Array.isArray(history)
    ? history.map(
        (item, index) =>
          history.findIndex(
            (previous) => JSON.stringify(previous) === JSON.stringify(item),
          ) === index,
      )
    : undefined;
  return {
    ...input,
    state: {
      ...input.state,
      ...(input.state.history ? { history: unique(input.state.history) } : {}),
      ...(Array.isArray(input.state.candidates)
        ? {
            candidates: input.state.candidates.map(
              (candidate: Record<string, unknown>) => ({
                ...candidate,
                history: unique(candidate.history),
              }),
            ),
          }
        : {}),
      // Keep each pairwise feature vector aligned with its retained snapshot.
      ...(kept &&
      Array.isArray(input.state.evidence) &&
      input.state.evidence.length === kept.length
        ? { evidence: input.state.evidence.filter((_, index) => kept[index]) }
        : {}),
    },
  };
}

/** Atomic, durable reservations across every isolate. Failed calls are never refunded. */
async function reserve(db: D1Database, now: number) {
  for (const [id, limit] of [
    [`day:${new Date(now).toISOString().slice(0, 10)}`, DEMO_LIMITS.dailyCalls],
    ["lifetime-v1", DEMO_LIMITS.totalCalls],
  ] as const) {
    const accepted = await rows(
      db,
      "INSERT INTO playground_budget(id,used) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET used=used+1 WHERE used < ? RETURNING id",
      [id, limit],
    );
    if (!accepted.length) throw new Error("Demo inference allowance exhausted");
  }
}

export function createBudgetedAI(options: {
  db: D1Database;
  ai: WorkersAI;
  secret: string;
  sessionId: string;
  onEvaluation: (result: DemoEvaluation) => void;
  onFailure?: (
    reason:
      | "budget"
      | "billing"
      | "timeout"
      | "model-unavailable"
      | "malformed"
      | "provider-or-storage",
  ) => void;
}): WorkersAI {
  return {
    async run(model, raw) {
      const input = compact(raw);
      const serialized = JSON.stringify({
        model,
        input,
        version: "janitor-demo-v1",
      });
      if (
        new TextEncoder().encode(serialized).byteLength > DEMO_LIMITS.inputBytes
      )
        throw new Error("Demo inference input too large");
      const id = await digest(
        options.secret,
        `${options.sessionId}:${serialized}`,
      );
      const now = Date.now();
      const existing = (
        await rows<{ result_json: string | null; created_at: number }>(
          options.db,
          "SELECT result_json,created_at FROM playground_cache WHERE id=? AND expires_at>?",
          [id, now],
        )
      )[0];
      if (existing) {
        if (!existing.result_json)
          throw new Error("Identical evaluation already pending");
        const result: unknown = JSON.parse(existing.result_json);
        Object.keys(input.questions).forEach((key) => readNoul(result, key));
        options.onEvaluation({
          source: "cache",
          evaluatedAt: existing.created_at,
        });
        return result;
      }
      const owner = crypto.randomUUID();
      const claim = await rows(
        options.db,
        `INSERT INTO playground_cache(id,session_id,owner,created_at,expires_at) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,created_at=excluded.created_at,expires_at=excluded.expires_at,result_json=NULL
         WHERE playground_cache.expires_at <= ? RETURNING id`,
        [id, options.sessionId, owner, now, now + DEMO_LIMITS.pendingMs, now],
      );
      if (!claim.length)
        throw new Error("Identical evaluation already pending");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await reserve(options.db, now);
        const response = unwrapCloudflareJevResponse(
          await Promise.race([
            options.ai.run(model, input),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Demo inference timeout")),
                DEMO_LIMITS.providerTimeoutMs,
              );
            }),
          ]),
        );
        // Persist only validated typed answers. Never provider prose, prompts or input signals.
        const result = {
          answers: Object.fromEntries(
            Object.keys(input.questions).map((key) => [
              key,
              { type: "noul", noul: readNoul(response, key) },
            ]),
          ),
        };
        await rows(
          options.db,
          "UPDATE playground_cache SET result_json=?,expires_at=? WHERE id=? AND owner=? RETURNING id",
          [JSON.stringify(result), now + DEMO_LIMITS.cacheMs, id, owner],
        );
        options.onEvaluation({ source: "jev", evaluatedAt: now });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const reason = /allowance/.test(message)
          ? "budget"
          : /insufficient balance|billing|add money|payment required/i.test(
                message,
              )
            ? "billing"
            : /timeout/i.test(message)
              ? "timeout"
              : /no such model|model.*not found|unknown model|unsupported model|model.*not supported/i.test(
                    message,
                  )
                ? "model-unavailable"
                : /Malformed/.test(message)
                  ? "malformed"
                  : "provider-or-storage";
        try {
          options.onFailure?.(reason);
        } catch {
          /* Diagnostics never change the result. */
        }
        throw error;
      } finally {
        clearTimeout(timer);
        // On error retain the pending tombstone for one minute: no immediate paid retry storm.
      }
    },
  };
}
