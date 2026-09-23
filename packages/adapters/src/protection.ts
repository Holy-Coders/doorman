import { z } from "zod";
import {
  isEvaluation,
  isLookupScope,
  isCandidateEvaluations,
  isCrossDevicePrediction,
  isApiActivityRisk,
  isOperatorEvaluation,
} from "@aarondovturkel/doorman-core";
import type {
  EvaluationControl,
  EvaluationLease,
  ProtectionStorage,
  VisitorEvaluator,
} from "@aarondovturkel/doorman-core";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";

const limit = z.number().int().min(1).max(1_000_000);
const windowMs = z.number().int().min(1000).max(3_600_000);
const config = z
  .object({
    requests: z
      .object({
        global: limit.default(600),
        account: limit.default(60),
        session: limit.default(30),
        shards: z.number().int().min(1).max(128).default(1),
        windowMs: windowMs.default(60_000),
      })
      .strict()
      .default({
        global: 600,
        account: 60,
        session: 30,
        shards: 1,
        windowMs: 60_000,
      }),
    evaluator: z
      .object({
        maxCalls: limit.default(120),
        windowMs: windowMs.default(60_000),
        maxConcurrent: z.number().int().min(1).max(32).default(4),
        failureThreshold: z.number().int().min(1).max(100).default(3),
        cooldownMs: windowMs.default(30_000),
      })
      .strict()
      .default({
        maxCalls: 120,
        windowMs: 60_000,
        maxConcurrent: 4,
        failureThreshold: 3,
        cooldownMs: 30_000,
      }),
  })
  .strict();
export type ProtectionReason =
  | "request-limit"
  | "budget"
  | "concurrency"
  | "circuit-open"
  | "timeout"
  | "provider"
  | "malformed"
  | "storage"
  | "contention";
export type ProtectionOptions = SubjectLinkingOptions &
  z.input<typeof config> & {
    onEvent?: (event: {
      kind: "request" | "evaluator";
      reason: ProtectionReason;
    }) => void;
  };
export type AdmissionContext = { account?: string; session?: string };
const admission = z
  .object({
    account: z.string().min(1).max(512).optional(),
    session: z.string().min(1).max(512).optional(),
  })
  .strict();
const RETRIES = 8;

/** No raw account/session keys are persisted. Configure the same namespace on every replica. */
export function createProtection(
  storage: ProtectionStorage,
  options: ProtectionOptions,
  timeoutMs: number,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new Error("Protected evaluation timeout must be 1–5000ms");
  const limits = config.parse({
    requests: options.requests,
    evaluator: options.evaluator,
  });
  const label = createSubjectLinker(options);
  const key = (value: string) =>
    label(JSON.stringify(["protection-v1", value]));
  const emit = (kind: "request" | "evaluator", reason: ProtectionReason) => {
    try {
      options.onEvent?.({ kind, reason });
    } catch {
      /* Metrics cannot change policy. */
    }
  };
  const controlKey = key("evaluator");
  const shards = Math.min(limits.requests.shards, limits.requests.global);
  let nextShard = crypto.getRandomValues(new Uint32Array(1))[0]! % shards;
  const ttl =
    Math.max(
      limits.evaluator.windowMs,
      limits.evaluator.cooldownMs,
      timeoutMs + 5000,
    ) * 2;
  async function change<T>(
    fn: (
      state: EvaluationControl,
      now: number,
    ) => { state?: EvaluationControl; result: T },
  ): Promise<T> {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const now = Date.now();
      const previous = await storage.getControl(await controlKey);
      const state: EvaluationControl = previous ?? {
        version: 0,
        windowStart: now,
        used: 0,
        failures: 0,
        openUntil: 0,
        epoch: 0,
        leases: [],
      };
      const next = fn(structuredClone(state), now);
      if (!next.state) return next.result;
      next.state.version = state.version + 1;
      if (
        await storage.compareControl(
          await controlKey,
          state.version,
          next.state,
          now + ttl,
        )
      )
        return next.result;
    }
    throw new Error("Protection contention");
  }
  return {
    async admit(context: AdmissionContext = {}) {
      const parsed = admission.parse(context);
      const now = Date.now();
      const shard = nextShard;
      nextShard = (nextShard + 1) % shards;
      // Static slices sum to the configured global maximum. No borrowing or retry.
      // Epoch-aligned windows keep every slice on the same clock boundary.
      const checks: [string, number, number][] = [
        shards === 1
          ? ["global", limits.requests.global, now]
          : [
              JSON.stringify(["global-shard-v1", shards, shard]),
              Math.floor(limits.requests.global / shards) +
                Number(shard < limits.requests.global % shards),
              Math.floor(now / limits.requests.windowMs) *
                limits.requests.windowMs,
            ],
      ];
      if (parsed.account)
        checks.push([
          JSON.stringify(["account", parsed.account]),
          limits.requests.account,
          now,
        ]);
      if (parsed.session)
        checks.push([
          JSON.stringify(["session", parsed.session]),
          limits.requests.session,
          now,
        ]);
      // Earlier quotas count denied attempts too. Each UPSERT is atomic across replicas.
      for (const [value, maximum, windowTime] of checks) {
        if (
          !(await storage.consumeQuota(
            await key(value),
            maximum,
            limits.requests.windowMs,
            windowTime,
          ))
        ) {
          emit("request", "request-limit");
          return {
            allowed: false,
            retryAfterSeconds: Math.ceil(limits.requests.windowMs / 1000),
          };
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    wrap(evaluator: VisitorEvaluator): VisitorEvaluator {
      async function guarded<T>(
        run: () => Promise<T>,
        validate: (value: unknown) => value is T,
        method: keyof NonNullable<VisitorEvaluator["requestCosts"]>,
      ): Promise<T> {
        const cost = evaluator.requestCosts?.[method] ?? 1;
        if (!Number.isInteger(cost) || cost < 1 || cost > 16)
          throw new Error("Invalid evaluator request cost");
        let reservation: {
          lease?: EvaluationLease;
          reason?: ProtectionReason;
        };
        try {
          reservation = await change<{
            lease?: EvaluationLease;
            reason?: ProtectionReason;
          }>((s, now) => {
            s.leases = s.leases.filter((l) => l.expiresAt > now);
            if (s.openUntil > now)
              return { result: { reason: "circuit-open" as const } };
            if (now - s.windowStart >= limits.evaluator.windowMs) {
              s.windowStart = now;
              s.used = 0;
            }
            if (s.used + cost > limits.evaluator.maxCalls)
              return { result: { reason: "budget" as const } };
            const probe = s.openUntil !== 0;
            if (
              s.leases.reduce((sum, l) => sum + (l.cost ?? 1), 0) + cost >
                limits.evaluator.maxConcurrent ||
              (probe && s.leases.some((l) => l.probe))
            )
              return { result: { reason: "concurrency" as const } };
            const lease = {
              id: crypto.randomUUID(),
              expiresAt: now + timeoutMs + 5000,
              epoch: s.epoch,
              probe,
              cost,
            };
            s.leases.push(lease);
            s.used += cost;
            return { state: s, result: { lease } };
          });
        } catch {
          emit("evaluator", "storage");
          throw new Error("Evaluation protection unavailable");
        }
        const { lease, reason } = reservation;
        if (!lease) {
          emit("evaluator", reason!);
          throw new Error("Evaluation admission denied");
        }
        let failure: ProtectionReason | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value = await Promise.race([
            Promise.resolve().then(() => run()),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                failure = "timeout";
                reject(new Error("Evaluation timeout"));
              }, timeoutMs);
            }),
          ]);
          if (!validate(value)) {
            failure = "malformed";
            throw new Error("Malformed evaluation");
          }
          return value;
        } catch (error) {
          failure ??= "provider";
          emit("evaluator", failure);
          throw error;
        } finally {
          clearTimeout(timer);
          try {
            await change((s, now) => {
              if (!s.leases.some((l) => l.id === lease.id))
                return { result: undefined };
              // A timed-out provider may still be running. Keep its lease until expiry.
              if (failure !== "timeout")
                s.leases = s.leases.filter((l) => l.id !== lease.id);
              // Old completions cannot close a newer breaker or release another lease.
              if (lease.epoch === s.epoch) {
                if (!failure) {
                  s.failures = 0;
                  if (lease.probe) {
                    s.openUntil = 0;
                    s.epoch++;
                  }
                } else if (
                  lease.probe ||
                  ++s.failures >= limits.evaluator.failureThreshold
                ) {
                  s.openUntil = now + limits.evaluator.cooldownMs;
                  s.epoch++;
                }
              }
              return { state: s, result: undefined };
            });
          } catch {
            emit(
              "evaluator",
              "storage",
            ); /* Abandoned leases expire; never retry inference. */
          }
        }
      }
      return {
        requestCosts: evaluator.requestCosts,
        ...(evaluator.evaluateOperator
          ? {
              evaluateOperator: (
                input: Parameters<
                  NonNullable<VisitorEvaluator["evaluateOperator"]>
                >[0],
              ) =>
                guarded(
                  () => evaluator.evaluateOperator!(input),
                  isOperatorEvaluation,
                  "evaluateOperator",
                ),
            }
          : {}),
        ...(evaluator.evaluateActivity
          ? {
              evaluateActivity: (
                input: Parameters<
                  NonNullable<VisitorEvaluator["evaluateActivity"]>
                >[0],
              ) =>
                guarded(
                  () => evaluator.evaluateActivity!(input),
                  isApiActivityRisk,
                  "evaluateActivity",
                ),
            }
          : {}),
        evaluate: (input) =>
          guarded(() => evaluator.evaluate(input), isEvaluation, "evaluate"),
        ...(evaluator.planLookup
          ? {
              planLookup: (
                input: Parameters<
                  NonNullable<VisitorEvaluator["planLookup"]>
                >[0],
              ) =>
                guarded(
                  () => evaluator.planLookup!(input),
                  isLookupScope,
                  "planLookup",
                ),
            }
          : {}),
        ...(evaluator.evaluateCandidates
          ? {
              evaluateCandidates: (
                input: Parameters<
                  NonNullable<VisitorEvaluator["evaluateCandidates"]>
                >[0],
              ) =>
                guarded(
                  () => evaluator.evaluateCandidates!(input),
                  isCandidateEvaluations,
                  "evaluateCandidates",
                ),
            }
          : {}),
        ...(evaluator.predictIdentity
          ? {
              predictIdentity: (
                input: Parameters<
                  NonNullable<VisitorEvaluator["predictIdentity"]>
                >[0],
              ) =>
                guarded(
                  () => evaluator.predictIdentity!(input),
                  isCrossDevicePrediction,
                  "predictIdentity",
                ),
            }
          : {}),
      };
    },
    cleanup: () => storage.cleanupProtection(Date.now(), 100),
  };
}
