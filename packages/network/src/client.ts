import { classifierAssessmentSchema } from "./classifier-schema.js";
import type { ClassifierAssessment } from "./classifier-schema.js";
import { isIdentityAttribution } from "@janitor/core";
import type { VisitorEvaluator, IdentityAttribution } from "@janitor/core";
import { z } from "zod";
import {
  contributionSchema,
  feedbackSchema,
  parseFeatures,
  preferencesSchema,
  opaqueId,
  FEATURE_NAMES,
} from "./schema.js";
import type {
  Contribution,
  FeatureVector,
  Feedback,
  NetworkAssessment,
  NetworkPreferences,
  RouteCategory,
} from "./schema.js";
import { extractFeatures } from "./features.js";
import { digest, readJSON, validateEndpoint } from "./http.js";

export const assessmentSchema = z.strictObject({
  version: z.literal(1),
  evaluatorVersion: z.string().min(1).max(128).nullable(),
  providerModel: z.string().min(1).max(128).optional(),
  risk: z.strictObject({
    automation: z.number().min(0).max(1),
    suspicious: z.number().min(0).max(1),
  }),
  riskStatus: z.enum(["evaluated", "unavailable", "disabled"]),
  modelVersion: opaqueId.nullable(),
  patternMode: z.enum(["none", "shadow", "canary"]),
  cached: z.boolean(),
  patterns: z
    .array(
      z.strictObject({
        patternId: z.string().regex(/^pattern_\d+$/),
        target: z.enum(["assistant", "abuse"]),
        predicates: z
          .array(
            z.strictObject({
              feature: z.enum(FEATURE_NAMES),
              operator: z.enum(["gte", "lte"]),
              value: z.number().finite(),
            }),
          )
          .min(2)
          .max(2),
        holdoutPrecision: z.number().min(0).max(1).nullable(),
        holdoutFalsePositiveRate: z.number().min(0).max(1).nullable(),
        support: z.number().int().min(0).max(10000),
      }),
    )
    .max(6),
});
export type NetworkClientOptions = {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
  /** Independent local opt-in. No background uploads or implicit outcome labeling. */
  contribution?: {
    enabled: true;
    training?: boolean;
    referenceSecret: string;
    sampleRate?: number;
  };
};
export function createNetworkClient(options: NetworkClientOptions) {
  if (typeof window !== "undefined")
    throw new Error("Network credentials belong on your server");
  const endpoint = validateEndpoint(options.endpoint),
    timeout = options.timeoutMs ?? 1500;
  if (
    !/^[A-Za-z0-9_-]{32,256}$/.test(options.apiKey) ||
    !Number.isInteger(timeout) ||
    timeout < 50 ||
    timeout > 10_000
  )
    throw new Error("Invalid network credentials or timeout");
  if (
    options.contribution &&
    (options.contribution.enabled !== true ||
      options.contribution.referenceSecret.length < 32)
  )
    throw new Error(
      "Contribution requires explicit enablement and a reference secret of at least 32 characters",
    );
  const sampleRate = options.contribution?.sampleRate ?? 0.01;
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    throw new Error("Sampling rate must be between 0 and 1");
  const sampled = (id: string) =>
    parseInt(opaqueId.parse(id).slice(-32, -24), 16) / 4294967296 < sampleRate;
  const hmac = options.contribution
    ? crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(options.contribution.referenceSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      )
    : undefined;
  async function reference(value: string, scope: string) {
    if (!hmac) throw new Error("Contribution is disabled");
    if (!value || value.length > 512)
      throw new Error("Invalid local reference");
    const signed = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await hmac,
        new TextEncoder().encode(
          JSON.stringify([await digest(options.apiKey), scope, value]),
        ),
      ),
    );
    return (
      "ref_" +
      Array.from(signed, (b) => b.toString(16).padStart(2, "0")).join("")
    );
  }
  async function send(
    path: string,
    body?: unknown,
    method = "POST",
    acceptedStatuses: number[] = [],
  ): Promise<unknown> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized && new TextEncoder().encode(serialized).length > 16_384)
      throw new Error("Network payload exceeds 16 KiB");
    const response = await fetch(endpoint + path, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: serialized,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      await response.body?.cancel();
      throw new Error(`Learning service unavailable (${response.status})`);
    }
    return readJSON(response.body, 16_384, timeout);
  }
  async function feedback(input: Feedback): Promise<{ status: string }> {
    if (!options.contribution) return { status: "disabled" };
    try {
      const value = feedbackSchema.parse(input);
      if (!sampled(value.sampleId)) return { status: "sampled-out" };
      return z
        .strictObject({
          status: z.enum(["recorded", "duplicate", "disputed", "missing"]),
        })
        .parse(await send("/v1/feedback", value, "POST", [404, 409]));
    } catch {
      return { status: "unavailable" };
    }
  }
  return {
    /** Separate learned targets. A score never authenticates or authorizes an actor. */
    async classify(features: FeatureVector): Promise<ClassifierAssessment> {
      try {
        return classifierAssessmentSchema.parse(
          await send("/v1/classify", {
            version: 1,
            features: parseFeatures(features),
          }),
        );
      } catch {
        return {
          version: 1,
          status: "unavailable",
          cached: false,
          predictions: [],
        };
      }
    },
    /** Explicit remote evaluation only; results stay private unless your application exposes them. */
    async evaluate(features: FeatureVector): Promise<NetworkAssessment> {
      try {
        const parsed = parseFeatures(features);
        if (!Object.keys(parsed).length)
          throw new Error("Insufficient signals");
        return assessmentSchema.parse(
          await send("/v1/evaluate", {
            version: 1,
            features: parsed,
          }),
        ) as NetworkAssessment;
      } catch {
        return {
          version: 1,
          evaluatorVersion: null,
          risk: { automation: 0, suspicious: 0 },
          riskStatus: "unavailable",
          modelVersion: null,
          patternMode: "none",
          patterns: [],
          cached: false,
        };
      }
    },
    /** Inspect this object before opting into transport. Retain it for idempotent retries. */
    async prepare(input: {
      sessionId: string;
      features: FeatureVector;
      cohort?: Contribution["cohort"];
      observedAt?: number;
    }): Promise<Contribution> {
      const time = input.observedAt ?? Date.now();
      const sessionReference = await reference(
        input.sessionId,
        "session:" + Math.floor(time / 86_400_000),
      );
      return contributionSchema.parse({
        version: 1,
        sampleId: "sample_" + sessionReference.slice(4, 36),
        sessionReference,
        observedAt: Math.floor(time / 60_000) * 60_000,
        features: parseFeatures(input.features),
        cohort: input.cohort ?? "unknown",
        trainingAllowed: options.contribution?.training === true,
      }) as Contribution;
    },
    async contribute(input: Contribution): Promise<{
      status: "accepted" | "disabled" | "sampled-out" | "unavailable";
      sampleId?: string;
    }> {
      if (!options.contribution) return { status: "disabled" };
      try {
        const sample = contributionSchema.parse(input);
        if (!sampled(sample.sampleId)) return { status: "sampled-out" };
        sample.trainingAllowed =
          sample.trainingAllowed && options.contribution.training === true;
        const result = z
          .strictObject({ sampleId: opaqueId, created: z.boolean() })
          .parse(await send("/v1/contributions", sample));
        return { status: "accepted", sampleId: result.sampleId };
      } catch {
        return { status: "unavailable" };
      }
    },
    evidenceReference: (localEvidenceId: string) =>
      reference(localEvidenceId, "evidence"),
    /** Use only attribution freshly resolved by Janitor on your server, never request JSON.
     * A verified delegated assistant is a positive automation label, not a benign/abuse label.
     */
    async confirmAssistant(
      sampleId: string,
      attribution: IdentityAttribution,
    ): Promise<{ status: string }> {
      if (
        !isIdentityAttribution(attribution) ||
        attribution.subject.status !== "verified" ||
        attribution.actor.kind !== "agent" ||
        attribution.actor.basis !== "verified-credential" ||
        attribution.delegation.status !== "valid" ||
        !attribution.delegation.id ||
        !attribution.delegation.expiresAt ||
        attribution.delegation.expiresAt <= Date.now()
      )
        return { status: "unverified" };
      if (!options.contribution) return { status: "disabled" };
      return feedback({
        sampleId,
        target: "assistant",
        positive: true,
        source: "verified-delegation",
        evidenceReference: await reference(
          attribution.delegation.id,
          "evidence",
        ),
      });
    },
    feedback,
    /** Independent server preferences; does not enable local contribution collection. */
    async preferences(value: NetworkPreferences): Promise<NetworkPreferences> {
      return preferencesSchema.parse(
        await send("/v1/preferences", preferencesSchema.parse(value)),
      );
    },
    async erase(sampleId?: string): Promise<void> {
      await send(
        "/v1/contributions" + (sampleId ? "/" + opaqueId.parse(sampleId) : ""),
        undefined,
        "DELETE",
      );
    },
  };
}
export type NetworkClient = ReturnType<typeof createNetworkClient>;

/** Keeps identity matching with the supplied evaluator. Network failure retains its risk result.
 * Contribution is always an independent, explicit operation.
 */
export function withNetworkRisk(
  base: VisitorEvaluator,
  client: NetworkClient,
  options: { routes?: Readonly<Record<string, RouteCategory>> } = {},
): VisitorEvaluator {
  return {
    ...base,
    ...(base.planLookup ? { planLookup: base.planLookup.bind(base) } : {}),
    ...(base.predictIdentity
      ? { predictIdentity: base.predictIdentity.bind(base) }
      : {}),
    async evaluate(input) {
      const result = await base.evaluate(input);
      const network = await client.evaluate(
        extractFeatures({ behavior: input.current.behavior }),
      );
      return network.riskStatus === "evaluated"
        ? { ...result, ...network.risk }
        : result;
    },
    ...(base.evaluateCandidates
      ? {
          async evaluateCandidates(
            input: Parameters<
              NonNullable<VisitorEvaluator["evaluateCandidates"]>
            >[0],
          ) {
            const results = await base.evaluateCandidates!(input);
            const network = await client.evaluate(
              extractFeatures({ behavior: input.current.behavior }),
            );
            return network.riskStatus === "evaluated"
              ? results.map((r) => ({ ...r, ...network.risk }))
              : results;
          },
        }
      : {}),
    async evaluateActivity(input) {
      const fallback = base.evaluateActivity
        ? await base.evaluateActivity(input)
        : { automation: 0, suspicious: 0 };
      const network = await client.evaluate(
        extractFeatures({ activity: input.activity, routes: options.routes }),
      );
      return network.riskStatus === "evaluated" ? network.risk : fallback;
    },
  };
}
