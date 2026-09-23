import { z } from "zod";
import {
  OPERATOR_FEATURE_NAMES,
  OPERATOR_LIMITS,
  hasOperatorEvidence,
  isOperatorEvaluation,
  attemptEvaluation,
  summarizeOperators,
} from "@janitor/core";
import type {
  AgentFamilyReference,
  OperatorEvidence,
  OperatorStorage,
  OperatorWindow,
  VisitorEvaluator,
} from "@janitor/core";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";

const id = z
  .string()
  .min(1)
  .max(512)
  .refine((s) => !!s.trim());
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const operatorEvidenceSchema = z.strictObject({
  source: z.enum(["browser", "server", "mixed"]),
  features: z
    .partialRecord(
      z.enum(OPERATOR_FEATURE_NAMES),
      z.number().finite().min(0).max(1_000_000),
    )
    .superRefine((features, context) => {
      for (const [name, value] of Object.entries(features)) {
        if (value === undefined) continue;
        const maximum =
          name.endsWith("_ratio") ||
          name.endsWith("_share") ||
          name.startsWith("transition_")
            ? 1
            : name.endsWith("_cv")
              ? 10
              : name === "mouse_speed"
                ? 10_000
                : name.endsWith("_mean_ms")
                  ? 60_000
                  : name === "observation_duration_ms"
                    ? 900_000
                    : 1_000_000;
        if (
          value > maximum ||
          (name.endsWith("_count") && !Number.isInteger(value))
        )
          context.addIssue({
            code: "custom",
            path: [name],
            message: "Invalid operator measurement range",
          });
      }
    }),
});
const familySchema = z.strictObject({
  family: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  source: z.literal("controlled-study"),
  expiresAt: time,
  examples: z
    .array(operatorEvidenceSchema.refine(hasOperatorEvidence))
    .min(3)
    .max(OPERATOR_LIMITS.familyExamples),
});
const configSchema = z.strictObject({
  retentionDays: z.number().int().min(1).max(90).default(30),
  families: z
    .array(familySchema)
    .max(OPERATOR_LIMITS.families)
    .default([])
    .refine((f) => new Set(f.map((v) => v.family)).size === f.length),
  timeoutMs: z.number().int().min(50).max(10_000).default(4000),
  maxInFlight: z.number().int().min(1).max(256).default(16),
});
export type OperatorOptions = z.input<typeof configSchema>;
export const operatorWindowInputSchema = z
  .strictObject({
    accountId: id,
    sessionId: id,
    windowId: id,
    browserId: id.optional(),
    startedAt: time,
    endedAt: time,
    evidence: operatorEvidenceSchema,
  })
  .refine((w) => w.endedAt > w.startedAt && w.endedAt - w.startedAt <= 900_000);
export type OperatorWindowInput = z.infer<typeof operatorWindowInputSchema>;
export type OperatorResult = {
  status:
    "recorded" | "cached" | "pending" | "unavailable" | "conflict" | "limited";
  window?: OperatorWindow;
};
/** Private server API. Authenticate account access before every call. No browser endpoint is installed. */
export function createOperatorService(
  storage: OperatorStorage,
  identity: SubjectLinkingOptions,
  options: OperatorOptions,
  evaluator?: VisitorEvaluator,
  admit?: (context: {
    account: string;
    session: string;
  }) => Promise<{ allowed: boolean }>,
  evaluatorTimeoutMs = 1200,
) {
  const config = configSchema.parse(options);
  const label = createSubjectLinker(identity);
  const key = (purpose: string, ...values: string[]) =>
    label(JSON.stringify(["operators-v1", purpose, ...values]));
  let inFlight = 0;
  const accountKey = (account: string) => key("account", id.parse(account));
  return {
    async observe(input: OperatorWindowInput): Promise<OperatorResult> {
      // Configuration/caller errors are explicit; infrastructure/model failures are controlled.
      const data = operatorWindowInputSchema.parse(input);
      const now = Date.now();
      if (
        data.endedAt > now ||
        data.startedAt < now - config.retentionDays * 86_400_000
      )
        throw new Error(
          "Operator window is outside retention or in the future",
        );
      if (inFlight >= config.maxInFlight) return { status: "limited" };
      inFlight++;
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        if (!active) throw new Error("Operator deadline");
      };
      const work = (async (): Promise<OperatorResult> => {
        const account = await accountKey(data.accountId);
        const windowId = await key(
          "window",
          account,
          data.sessionId,
          data.windowId,
        );
        // Explicit projection + sorted keys; equivalent payload key order has the same digest.
        const evidence: OperatorEvidence = {
          source: data.evidence.source,
          features: Object.fromEntries(
            OPERATOR_FEATURE_NAMES.flatMap((k) =>
              data.evidence.features[k] === undefined
                ? []
                : [[k, data.evidence.features[k]]],
            ),
          ),
        };
        evidence.features.observation_duration_ms =
          Math.floor((data.endedAt - data.startedAt) / 1000) * 1000;
        const digest = await key(
          "input",
          JSON.stringify([
            data.startedAt,
            data.endedAt,
            data.browserId ?? null,
            evidence,
          ]),
        );
        check();
        const previous = await storage.get(account, windowId);
        check();
        if (previous)
          return previous.inputDigest !== digest
            ? { status: "conflict" }
            : {
                status: previous.status === "pending" ? "pending" : "cached",
                window: previous,
              };
        if (
          admit &&
          !(await admit({ account: data.accountId, session: data.sessionId }))
            .allowed
        )
          return { status: "limited" };
        check();
        const window: OperatorWindow = {
          id: windowId,
          accountKey: account,
          sessionKey: await key("session", account, data.sessionId),
          ...(data.browserId
            ? { browserKey: await key("browser", account, data.browserId) }
            : {}),
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          expiresAt: data.endedAt + config.retentionDays * 86_400_000,
          inputDigest: digest,
          lease: crypto.randomUUID(),
          evidence,
          status: "pending",
        };
        check();
        if (!(await storage.claim(window))) {
          const concurrent = await storage.get(account, windowId);
          return concurrent?.inputDigest !== digest
            ? { status: "conflict" }
            : {
                status: concurrent?.status === "pending" ? "pending" : "cached",
                window: concurrent,
              };
        }
        check();
        const enough = hasOperatorEvidence(evidence);
        if (enough && evaluator?.evaluateOperator) {
          const history = await storage.recent(
            account,
            now - config.retentionDays * 86_400_000,
            data.startedAt,
            OPERATOR_LIMITS.summaryWindows,
          );
          check();
          // Retrieval only: shared features never become positive operator links by themselves.
          const similarity = (w: OperatorWindow) => {
            const keys = OPERATOR_FEATURE_NAMES.filter(
              (k) =>
                evidence.features[k] !== undefined &&
                w.evidence.features[k] !== undefined &&
                !k.endsWith("_count") &&
                k !== "observation_duration_ms",
            );
            return keys.length
              ? keys.reduce(
                  (sum, k) =>
                    sum +
                    1 -
                    Math.abs(evidence.features[k]! - w.evidence.features[k]!) /
                      Math.max(
                        1,
                        evidence.features[k]!,
                        w.evidence.features[k]!,
                      ),
                  0,
                ) / keys.length
              : 0;
          };
          const candidates = history
            .filter(
              (w) =>
                w.id !== window.id &&
                w.expiresAt > now &&
                hasOperatorEvidence(w.evidence),
            )
            .map((w) => ({ w, similarity: similarity(w) }))
            .sort(
              (a, b) =>
                b.similarity - a.similarity ||
                b.w.endedAt - a.w.endedAt ||
                a.w.id.localeCompare(b.w.id),
            )
            .slice(0, OPERATOR_LIMITS.candidates)
            .map(({ w }) => ({ id: w.id, evidence: w.evidence }));
          const families: AgentFamilyReference[] = config.families.filter(
            (f) => f.expiresAt > now,
          );
          window.referenceVersions = Object.fromEntries(
            families.map((f) => [f.family, f.version]),
          );
          const result = await attemptEvaluation(
            () =>
              evaluator.evaluateOperator!({
                current: evidence,
                candidates,
                families,
              }),
            evaluatorTimeoutMs,
            (v): v is NonNullable<OperatorWindow["evaluation"]> =>
              isOperatorEvaluation(v) &&
              v.links.every((l) =>
                candidates.some((c) => c.id === l.windowId),
              ) &&
              v.families.every((f) =>
                families.some((r) => r.family === f.family),
              ),
          );
          check();
          window.status = result ? "evaluated" : "unavailable";
          // Project rather than persist arbitrary properties returned by a custom evaluator.
          if (result)
            window.evaluation = {
              modelVersion: result.modelVersion,
              scores: {
                human: result.scores.human,
                assistant: result.scores.assistant,
                automation: result.scores.automation,
              },
              abuse: result.abuse,
              links: result.links.map((l) => ({
                windowId: l.windowId,
                score: l.score,
              })),
              families: result.families.map((f) => ({
                family: f.family,
                score: f.score,
              })),
            };
        } else window.status = enough ? "disabled" : "insufficient-evidence";
        check();
        if (!(await storage.finish(window))) return { status: "unavailable" };
        check();
        return { status: "recorded", window };
      })()
        .catch((): OperatorResult => ({ status: "unavailable" }))
        .finally(() => {
          inFlight--;
        });
      try {
        return await Promise.race([
          work,
          new Promise<OperatorResult>((resolve) => {
            timer = setTimeout(() => {
              active = false;
              resolve({ status: "unavailable" });
            }, config.timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async summarize(
      accountId: string,
      range: { since: number; until: number },
    ) {
      const now = Date.now();
      if (
        !Number.isSafeInteger(range.since) ||
        !Number.isSafeInteger(range.until) ||
        range.since >= range.until ||
        range.until > now ||
        range.since < now - config.retentionDays * 86_400_000
      )
        throw new Error("Invalid operator summary range");
      if (inFlight >= config.maxInFlight)
        throw new Error("Operator capacity reached");
      inFlight++;
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = (async () => {
        const account = await accountKey(accountId);
        if (!active) throw new Error("Operator report deadline");
        const rows = await storage.recent(
          account,
          range.since,
          range.until,
          OPERATOR_LIMITS.summaryWindows + 1,
        );
        if (!active) throw new Error("Operator report deadline");
        return summarizeOperators(
          rows.filter((w) => w.expiresAt > now),
          range,
        );
      })().finally(() => {
        inFlight--;
      });
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              active = false;
              reject(new Error("Operator report deadline"));
            }, config.timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    /** Stop collection before erasure; in-flight finishes cannot recreate a deleted window. */
    deleteAccount: async (accountId: string) =>
      storage.deleteAccount(await accountKey(accountId)),
    async deleteBrowser(accountId: string, browserId: string) {
      const account = await accountKey(accountId);
      await storage.deleteBrowser(
        account,
        await key("browser", account, id.parse(browserId)),
      );
    },
    async deleteSession(accountId: string, sessionId: string) {
      const account = await accountKey(accountId);
      await storage.deleteSession(
        account,
        await key("session", account, id.parse(sessionId)),
      );
    },
    cleanup: () => storage.cleanup(Date.now(), 100),
  };
}
