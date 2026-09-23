import { createClassifierService } from "./classifier-service.js";
import type { ClassifierFeatureEvaluator } from "./classifier-jev.js";
export {
  createClassifierJevEvaluator,
  createWorkersClassifierEvaluator,
  CLASSIFIER_JEV_MODEL,
} from "./classifier-jev.js";
import { z } from "zod";
import {
  contributionSchema,
  evaluationSchema,
  feedbackSchema,
  opaqueId,
  preferencesSchema,
} from "./schema.js";
import type {
  Contribution,
  NetworkAssessment,
  NetworkPreferences,
} from "./schema.js";
import type { NetworkStorage, StoredModel, Tenant } from "./storage.js";
import { discoverPatterns, matchPatterns } from "./discovery.js";
import type { DiscoveryOptions } from "./discovery.js";
import { digest, NetworkError, newId, readJSON } from "./http.js";
import { parseRisk } from "./jev.js";
import type { NetworkEvaluator } from "./jev.js";
export {
  createNetworkJevEvaluator,
  createWorkersNetworkEvaluator,
  createNetworkJevMethods,
  NETWORK_QUESTIONS,
} from "./jev.js";
export type { NetworkEvaluator } from "./jev.js";
export type { NetworkStorage } from "./storage.js";
export { createLearningOperator } from "./operator.js";

export type LearningServiceOptions = {
  classifierEvaluator?: ClassifierFeatureEvaluator;
  evaluator?: NetworkEvaluator;
  /** Change whenever provider, model pin or questions change; isolates cached results. */
  evaluatorVersion?: string;
  maxRequestsPerTenantPerDay?: number;
  maxEvaluationsPerTenantPerDay?: number;
  maxEvaluationsPerDay?: number;
  maxEvaluationsLifetime?: number;
  evaluatorTimeoutMs?: number;
  maxInFlight?: number;
};
const limitsSchema = z.strictObject({
  requests: z.number().int().min(1).max(100_000).default(2000),
  tenantEvaluations: z.number().int().min(0).max(10_000).default(100),
  evaluations: z.number().int().min(0).max(100_000).default(100),
  lifetime: z.number().int().min(0).max(10_000_000).default(1000),
  timeout: z.number().int().min(50).max(5000).default(1200),
  inFlight: z.number().int().min(1).max(1024).default(64),
});
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Authorization",
    },
  });
const empty = (): NetworkAssessment => ({
  version: 1,
  evaluatorVersion: null,
  risk: { automation: 0, suspicious: 0 },
  riskStatus: "unavailable",
  modelVersion: null,
  patternMode: "none",
  patterns: [],
  cached: false,
});

/** Server-to-server only. Neither inference nor contribution is enabled by tenant registration. */
export function createLearningService(
  storage: NetworkStorage,
  options: LearningServiceOptions = {},
) {
  const config = limitsSchema.parse({
    requests: options.maxRequestsPerTenantPerDay,
    tenantEvaluations: options.maxEvaluationsPerTenantPerDay,
    evaluations: options.maxEvaluationsPerDay,
    lifetime: options.maxEvaluationsLifetime,
    timeout: options.evaluatorTimeoutMs,
    inFlight: options.maxInFlight,
  });
  if (options.evaluator && !options.evaluatorVersion?.trim())
    throw new Error("Set evaluatorVersion for cache isolation");
  let running = 0,
    providerCalls = 0;
  async function callProvider(
    tenant: Tenant,
    run: () => Promise<unknown>,
    check: () => void,
  ): Promise<unknown> {
    const now = Date.now();
    const day = Math.floor(now / 86_400_000),
      expiry = (day + 2) * 86_400_000;
    if (
      !(await storage.quota(
        "eval:" + tenant.id,
        day,
        config.tenantEvaluations,
        expiry,
      )) ||
      !(await storage.quota("eval:global", day, config.evaluations, expiry)) ||
      !(await storage.quota(
        "eval:lifetime",
        0,
        config.lifetime,
        8_000_000_000_000_000,
      ))
    )
      throw new Error("Provider budget exhausted");
    check();
    if (providerCalls >= 8) throw new Error("Provider busy");
    let timer: ReturnType<typeof setTimeout> | undefined;
    providerCalls++;
    const work = Promise.resolve()
      .then(run)
      .finally(() => {
        providerCalls--;
      });
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Evaluator timeout")),
            config.timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const classifiers = createClassifierService(
    storage,
    options.classifierEvaluator,
    callProvider,
  );
  async function evaluate(
    tenant: Tenant,
    input: z.infer<typeof evaluationSchema>,
    check: () => void,
  ): Promise<NetworkAssessment> {
    const now = Date.now(),
      revision = await storage.revision();
    const models = (
      await Promise.all([
        storage.latestModel(now, "assistant"),
        storage.latestModel(now, "abuse"),
      ])
    ).filter((m): m is StoredModel => m !== undefined);
    const features = input.features;
    const fingerprint = await digest(JSON.stringify(features));
    const bucket =
      parseInt((await digest(tenant.id + fingerprint)).slice(0, 8), 16) % 100;
    const activePatterns = [] as NetworkAssessment["patterns"];
    const result = empty();
    result.evaluatorVersion = options.evaluatorVersion ?? null;
    if (models.length) {
      result.modelVersion =
        "model_" +
        (
          await digest(
            models
              .map((m) => m.model.id + ":" + m.status + ":" + m.canaryPercent)
              .join(","),
          )
        ).slice(0, 32);
      result.patternMode = "shadow";
      for (const current of models) {
        const evidence = matchPatterns(current.model, features);
        result.patterns.push(...evidence);
        if (current.status === "canary" && bucket < current.canaryPercent) {
          result.patternMode = "canary";
          activePatterns.push(...evidence);
        }
      }
    }
    if (!options.evaluator) return { ...result, riskStatus: "disabled" };
    if (!Object.keys(features).length) return result;
    if (providerCalls >= 8) return result;
    const key = await digest(
      JSON.stringify([
        tenant.id,
        options.evaluatorVersion,
        revision,
        result.modelVersion,
        result.patternMode,
        fingerprint,
      ]),
    );
    const cached = await storage.cached(key, now);
    check();
    if (cached) return cached;
    const lease = newId("lease");
    if (!(await storage.claim(key, lease, now))) return result;
    try {
      const evaluated = parseRisk(
        await callProvider(
          tenant,
          () => options.evaluator!({ features, patterns: activePatterns }),
          check,
        ),
      );
      result.risk = {
        automation: evaluated.automation,
        suspicious: evaluated.suspicious,
      };
      if (evaluated.providerModel)
        result.providerModel = evaluated.providerModel;
      result.riskStatus = "evaluated";
    } catch {
      /* Fail open without logging features. */
    }
    if (revision !== (await storage.revision())) return empty();
    await storage.saveAssessment(
      key,
      lease,
      result,
      Math.min(
        now + (result.riskStatus === "evaluated" ? 60_000 : 5000),
        ...models.map((m) => m.model.expiresAt),
      ),
    );
    return result;
  }
  async function handle(
    request: Request,
    check: () => void,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return response({ status: "ok", protocol: 1 });
    if (request.headers.has("origin"))
      return response({ error: "Use the server SDK" }, 403);
    const key = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
    if (!key) return response({ error: "Unauthorized" }, 401);
    const tenant = await storage.authenticate(await digest(key));
    if (!tenant) return response({ error: "Unauthorized" }, 401);
    const now = Date.now(),
      day = Math.floor(now / 86_400_000);
    // Revocation and erasure remain reachable after exhausting an ingestion budget.
    const erasure =
      request.method === "DELETE" && path.startsWith("/v1/contributions");
    const setting = path === "/v1/preferences";
    if (
      (erasure || setting) &&
      !(await storage.quota(
        "management:" + tenant.id,
        Math.floor(now / 60_000),
        30,
        now + 120_000,
      ))
    )
      return response(
        { error: "Management request budget exhausted; retry next minute" },
        429,
      );
    if (
      !erasure &&
      !setting &&
      !(await storage.quota(
        "request:" + tenant.id,
        day,
        config.requests,
        (day + 2) * 86_400_000,
      ))
    )
      return response({ error: "Daily request budget exhausted" }, 429);
    if (path === "/v1/preferences" && request.method === "GET")
      return response(tenant.preferences);
    if (erasure) {
      const match = path.match(/^\/v1\/contributions(?:\/([a-z0-9_]+))?$/);
      if (!match) return response({ error: "Not found" }, 404);
      if (match[1]) opaqueId.parse(match[1]);
      await storage.erase(tenant.id, match[1]);
      return response({ status: "erased" });
    }
    if (request.method !== "POST")
      return response({ error: "Method not allowed" }, 405);
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return response({ error: "JSON required" }, 415);
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > 16_384))
      return response({ error: "Body too large" }, 413);
    const body = await readJSON(request.body);
    if (path === "/v1/preferences") {
      const value = preferencesSchema.parse(body);
      if (value.training && !tenant.trainingApproved)
        return response(
          { error: "Training participation requires operator approval" },
          403,
        );
      await storage.preferences(tenant.id, value);
      return response(value);
    }
    if (path === "/v1/contributions") {
      if (!tenant.preferences.contribution)
        return response({ error: "Contribution is disabled" }, 403);
      const sample = contributionSchema.parse(body) as Contribution;
      if (
        sample.observedAt < now - 86_400_000 ||
        sample.observedAt > now ||
        !Object.keys(sample.features).length
      )
        return response(
          { error: "Use a nonempty snapshot from the last day" },
          400,
        );
      try {
        return response(await storage.contribute(tenant, sample, now), 202);
      } catch {
        return response(
          { error: "Sample conflict or contribution revoked" },
          409,
        );
      }
    }
    if (path === "/v1/feedback") {
      if (!tenant.preferences.contribution)
        return response({ error: "Contribution is disabled" }, 403);
      const result = await storage.feedback(
        tenant.id,
        feedbackSchema.parse(body),
        now,
      );
      return response(
        { status: result },
        result === "missing" ? 404 : result === "disputed" ? 409 : 200,
      );
    }
    if (path === "/v1/classify") {
      if (!tenant.preferences.evaluation)
        return response({ error: "Remote evaluation is disabled" }, 403);
      return response(
        await classifiers.classify(
          tenant,
          evaluationSchema.parse(body).features,
          check,
        ),
      );
    }
    if (path === "/v1/evaluate") {
      if (!tenant.preferences.evaluation)
        return response({ error: "Remote evaluation is disabled" }, 403);
      return response(
        await evaluate(tenant, evaluationSchema.parse(body), check),
      );
    }
    return response({ error: "Not found" }, 404);
  }
  return {
    async handle(request: Request): Promise<Response> {
      if (running >= config.inFlight)
        return response({ error: "Service busy" }, 503);
      running++;
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = handle(request, () => {
        if (!active) throw new NetworkError(503, "Service timeout");
      })
        .catch((error) =>
          response(
            {
              error:
                error instanceof NetworkError
                  ? error.message
                  : error instanceof z.ZodError
                    ? "Invalid payload"
                    : "Service unavailable",
            },
            error instanceof NetworkError
              ? error.status
              : error instanceof z.ZodError
                ? 400
                : 503,
          ),
        )
        .finally(() => {
          running--;
        });
      try {
        return await Promise.race([
          work,
          new Promise<Response>((resolve) => {
            timer = setTimeout(() => {
              active = false;
              resolve(response({ error: "Service timeout" }, 503));
            }, 8000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    /** Operator-only provisioning. Deliver the returned key once through a secret manager. */
    async registerTenant(
      input: {
        preferences?: NetworkPreferences;
        retentionDays?: number;
        trainingApproved?: boolean;
      } = {},
    ) {
      const id = newId("tenant"),
        apiKey = newId("jn") + newId("key");
      const retentionDays = input.retentionDays ?? 30;
      if (
        !Number.isInteger(retentionDays) ||
        retentionDays < 1 ||
        retentionDays > 30
      )
        throw new Error("Retention must be 1–30 days");
      const preferences = preferencesSchema.parse(
        input.preferences ?? {
          evaluation: false,
          contribution: false,
          training: false,
        },
      );
      if (preferences.training && !input.trainingApproved)
        throw new Error("Training participation must be operator-approved");
      await storage.registerTenant({
        id,
        keyHash: await digest(apiKey),
        preferences,
        retentionDays,
        trainingApproved: input.trainingApproved === true,
      });
      return { tenantId: id, apiKey };
    },
    async discover(options: Omit<DiscoveryOptions, "datasetRevision" | "now">) {
      const now = Date.now(),
        dataset = await storage.dataset(options.target, now, options);
      const model = discoverPatterns(dataset.rows, {
        ...options,
        datasetRevision: dataset.revision,
        now,
      });
      // Explicitly expose retrieval truncation. Promotion requires an untruncated pilot export.
      model.gates.completeExport = !dataset.truncated;
      model.sampled = dataset.sampled;
      model.datasetDigest = await digest(JSON.stringify(dataset.rows));
      model.eligible = Object.values(model.gates).every(Boolean);
      await storage.saveModel(model);
      return model;
    },
    exportClassifier: classifiers.export,
    stageClassifier: classifiers.stage,
    promoteClassifier: (id: string, percent = 1) =>
      storage.promoteClassifier(opaqueId.parse(id), percent, Date.now()),
    rollbackClassifier: (id: string) =>
      storage.rollbackClassifier(opaqueId.parse(id)),
    promote: (modelId: string, canaryPercent = 1) =>
      storage.promote(opaqueId.parse(modelId), canaryPercent, Date.now()),
    rollback: (modelId: string) => storage.rollback(opaqueId.parse(modelId)),
    revokeTenant: (tenantId: string) =>
      storage.revokeTenant(opaqueId.parse(tenantId)),
    cleanup: () => storage.cleanup(Date.now()),
  };
}
