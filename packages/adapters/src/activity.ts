import { z } from "zod";
import {
  API_ACTIVITY_LIMITS,
  attemptEvaluation,
  isApiActivityRisk,
} from "@janitor/core";
import type {
  ApiActivityAssessment,
  ApiActivityContext,
  ApiActivityKey,
  ApiActivityResult,
  ApiActivityStorage,
  VisitorEvaluator,
} from "@janitor/core";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";

const route = z
  .string()
  .max(160)
  .regex(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[A-Za-z0-9_/:.*{}-]*$/);
const keySchema = z
  .object({
    kind: z.enum(["session", "actor"]),
    id: z
      .string()
      .min(1)
      .max(512)
      .refine((v) => !!v.trim()),
  })
  .strict();
const contextSchema = z
  .object({
    key: keySchema,
    route,
    actor: z
      .object({ kind: z.enum(["person", "agent"]), delegated: z.boolean() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => !v.actor || v.key.kind === "actor");
const optionsSchema = z
  .object({
    routes: z
      .array(
        z.object({ route, sensitive: z.boolean().default(false) }).strict(),
      )
      .min(1)
      .max(API_ACTIVITY_LIMITS.routes)
      .refine((v) => new Set(v.map((r) => r.route)).size === v.length),
    windowMs: z.number().int().min(10_000).max(900_000).default(60_000),
    retentionDays: z.number().int().min(1).max(30).default(1),
    minRequests: z.number().int().min(1).max(10_000).default(20),
    evaluationIntervalMs: z
      .number()
      .int()
      .min(5000)
      .max(900_000)
      .default(60_000),
    timeoutMs: z.number().int().min(50).max(5000).default(1500),
    maxInFlight: z.number().int().min(1).max(1024).default(64),
  })
  .strict();
export type ApiActivityOptions = z.input<typeof optionsSchema>;
export type {
  ApiActivityContext,
  ApiActivityKey,
  ApiActivityResult,
  ApiActivityAssessment,
} from "@janitor/core";

/** Optional server telemetry. It never reads a body, URL, header or browser signal. */
export function createApiActivity(
  storage: ApiActivityStorage,
  identity: SubjectLinkingOptions,
  options: ApiActivityOptions,
  evaluator?: VisitorEvaluator,
  evaluatorTimeoutMs = 1200,
) {
  const config = optionsSchema.parse(options);
  const routes = new Map(config.routes.map((r) => [r.route, r]));
  const label = createSubjectLinker(identity);
  const owner = (key: ApiActivityKey) =>
    label(JSON.stringify(["api-activity-v1", key.kind, key.id]));
  let inFlight = 0;
  // A stalled driver continues occupying its slot until it settles. A timeout
  // prevents later evaluation; it must not make room for unbounded stuck work.
  async function limited(
    run: (check: () => void) => Promise<ApiActivityResult>,
  ): Promise<ApiActivityResult> {
    if (inFlight >= config.maxInFlight) return { status: "unavailable" };
    inFlight++;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve()
      .then(() =>
        run(() => {
          if (!active) throw new Error("Activity deadline");
        }),
      )
      .catch((): ApiActivityResult => ({ status: "unavailable" }))
      .finally(() => {
        inFlight--;
      });
    try {
      return await Promise.race([
        work,
        new Promise<ApiActivityResult>((resolve) => {
          timer = setTimeout(() => {
            active = false;
            resolve({ status: "unavailable" });
          }, config.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function assess(
    context: ApiActivityContext,
    key: string,
    check: () => void,
  ): Promise<ApiActivityResult> {
    const now = Date.now();
    const currentWindow = Math.floor(now / config.windowMs) * config.windowMs;
    // The requested route and verified actor context are part of the cache key.
    // An assessment for one permission context is never reused for another.
    const cacheKey = await label(
      JSON.stringify([
        "api-assessment-v1",
        key,
        context.route,
        context.actor?.kind ?? null,
        context.actor?.delegated ?? null,
        config.windowMs,
        routes.get(context.route)!.sensitive,
      ]),
    );
    check();
    const lease = crypto.randomUUID();
    const expiresAt = now + config.evaluationIntervalMs;
    const claimed = await storage.claim(cacheKey, key, lease, now, expiresAt);
    check();
    if (!claimed) {
      const cached = await storage.cached(cacheKey, now);
      check();
      return cached
        ? { status: "recorded", assessment: { ...cached, cached: true } }
        : { status: "recorded" };
    }
    const rows = await storage.recent(
      key,
      currentWindow - (API_ACTIVITY_LIMITS.windows - 1) * config.windowMs,
      currentWindow,
    );
    check();
    const summary = {
      source: "application-api" as const,
      observedAt: now,
      windowMs: config.windowMs,
      truncated: rows.length > API_ACTIVITY_LIMITS.rows,
      buckets: rows
        .slice(0, API_ACTIVITY_LIMITS.rows)
        .filter((row) => routes.has(row.route)),
    };
    const risk =
      evaluator?.evaluateActivity && summary.buckets.length
        ? await attemptEvaluation(
            () =>
              evaluator.evaluateActivity!({
                activity: summary,
                route: context.route,
                sensitive: routes.get(context.route)!.sensitive,
                ...(context.actor ? { actor: context.actor } : {}),
              }),
            evaluatorTimeoutMs,
            isApiActivityRisk,
          )
        : undefined;
    check();
    const assessment: ApiActivityAssessment = {
      source: "application-api",
      evaluatedAt: now,
      expiresAt,
      summary,
      cached: false,
      risk: risk
        ? { automation: risk.automation, suspicious: risk.suspicious }
        : { automation: 0, suspicious: 0 },
      riskStatus: risk
        ? "evaluated"
        : evaluator?.evaluateActivity
          ? "unavailable"
          : "disabled",
    };
    await storage.save(cacheKey, lease, assessment);
    check();
    return { status: "recorded", assessment };
  }
  const service = {
    /** Record one completed request. Repeated calls count as repeated observations. */
    observe(
      context: ApiActivityContext | undefined,
      outcome: { status: number; durationMs: number },
    ): Promise<ApiActivityResult> {
      if (!context) return Promise.resolve({ status: "skipped" });
      return limited(async (check) => {
        const parsed = contextSchema.parse(context);
        const configured = routes.get(parsed.route);
        if (!configured) return { status: "skipped" };
        const result = z
          .object({
            status: z.number().int().min(100).max(599),
            durationMs: z.number().finite().nonnegative(),
          })
          .strict()
          .parse(outcome);
        const key = await owner(parsed.key);
        check();
        const now = Date.now();
        const row = await storage.increment({
          key,
          route: parsed.route,
          windowStart: Math.floor(now / config.windowMs) * config.windowMs,
          now,
          expiresAt: now + config.retentionDays * 86_400_000,
          status: result.status,
          durationMs: Math.min(
            API_ACTIVITY_LIMITS.maxDurationMs,
            Math.round(result.durationMs),
          ),
        });
        check();
        // Count doubling, first denial and configured sensitive routes trigger
        // assessment attempts. A shared lease/cache and global budget bound AI.
        const ratio = row.requests / config.minRequests;
        const milestone = ratio >= 1 && Number.isInteger(Math.log2(ratio));
        if (
          configured.sensitive ||
          milestone ||
          (row.denied === 1 && (result.status === 401 || result.status === 403))
        )
          return assess(parsed, key, check);
        return { status: "recorded" };
      });
    },
    /** Read/evaluate recent activity explicitly before a sensitive action. */
    assess(context: ApiActivityContext): Promise<ApiActivityResult> {
      return limited(async (check) => {
        const parsed = contextSchema.parse(context);
        if (!routes.has(parsed.route)) return { status: "skipped" };
        const key = await owner(parsed.key);
        check();
        return assess(parsed, key, check);
      });
    },
    /** Web middleware: the caller returns only response; activity stays private. */
    async handle(
      request: Request,
      context: ApiActivityContext | undefined,
      next: (request: Request) => Promise<Response> | Response,
    ): Promise<{ response: Response; activity: ApiActivityResult }> {
      const start = performance.now();
      let response: Response;
      try {
        response = await next(request);
      } catch (error) {
        await service.observe(context, {
          status: 500,
          durationMs: performance.now() - start,
        });
        throw error;
      }
      const activity = await service.observe(context, {
        status: response.status,
        durationMs: performance.now() - start,
      });
      return { response, activity };
    },
    /** Authorize erasure in the application and stop collection before calling. */
    deleteKey: async (key: ApiActivityKey) =>
      storage.deleteKey(await owner(keySchema.parse(key))),
    cleanup: () => storage.cleanup(Date.now(), 100),
  };
  return service;
}
