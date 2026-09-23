import { z } from "zod";
import {
  FEATURE_NAMES,
  cohortSchema,
  contributionSchema,
  feedbackSchema,
  opaqueId,
  timestamp,
} from "./schema.js";
import type { FeatureVector } from "./schema.js";

export const CLASSIFIER_FEATURE_VERSION = "doorman-jev-features-v1" as const;
export const JEV_FEATURE_NAMES = [
  "jev_regular_timing",
  "jev_repeated_workflow",
  "jev_mechanical_input",
  "jev_abuse_evidence",
] as const;
export const CLASSIFIER_FEATURE_NAMES = [
  ...FEATURE_NAMES,
  ...JEV_FEATURE_NAMES,
];
const probability = z.number().finite().min(0).max(1);
const finite = z.number().finite();
const count = z.number().int().min(0).max(10_000);
export const classifierSplitSchema = z
  .strictObject({
    target: z.enum(["assistant", "abuse"]),
    trainingBefore: timestamp,
    calibrationBefore: timestamp,
    validationBefore: timestamp,
    holdoutTenants: z.array(opaqueId).min(3).max(10),
  })
  .refine(
    (s) =>
      s.trainingBefore > 0 &&
      s.trainingBefore < s.calibrationBefore &&
      s.calibrationBefore < s.validationBefore &&
      new Set(s.holdoutTenants).size === s.holdoutTenants.length,
    "Use ordered cutoffs and distinct held-out applications",
  );
export type ClassifierSplit = z.infer<typeof classifierSplitSchema>;
export const classifierRowSchema = contributionSchema
  .extend({
    tenantId: opaqueId,
    target: z.enum(["assistant", "abuse"]),
    positive: z.boolean(),
    confirmedAt: timestamp,
    expiresAt: timestamp,
    source: z.enum([
      "verified-delegation",
      "reviewed-session",
      "confirmed-incident",
    ]),
    evidenceReference: z.string().regex(/^ref_[a-f0-9]{64}$/),
  })
  .superRefine((r, ctx) => {
    if (
      !feedbackSchema.safeParse({
        sampleId: r.sampleId,
        target: r.target,
        positive: r.positive,
        source: r.source,
        evidenceReference: r.evidenceReference,
      }).success ||
      r.confirmedAt < r.observedAt
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid independent outcome provenance",
      });
  });
export type ClassifierRow = Omit<
  z.infer<typeof classifierRowSchema>,
  "features"
> & { features: FeatureVector };
export const PARTITIONS = [
  "training",
  "calibration",
  "validation",
  "holdout",
] as const;
export type Partition = (typeof PARTITIONS)[number];
export const partitionSummarySchema = z.strictObject({
  positives: count,
  negatives: count,
  tenants: count,
});
export const classifierManifestSchema = z.strictObject({
  version: z.literal(1),
  id: opaqueId,
  origin: z.enum(["observed", "synthetic"]),
  createdAt: timestamp,
  expiresAt: timestamp,
  revision: z.number().int().min(0),
  split: classifierSplitSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  rows: count,
  excluded: z.number().int().min(0).max(10000),
  sampled: z.boolean(),
  truncated: z.boolean(),
  partitions: z.record(z.enum(PARTITIONS), partitionSummarySchema),
});
export type ClassifierManifest = z.infer<typeof classifierManifestSchema>;
export const classifierDatasetSchema = z.strictObject({
  manifest: classifierManifestSchema,
  rows: z.array(classifierRowSchema).max(10000),
  seal: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type ClassifierDataset = Omit<
  z.infer<typeof classifierDatasetSchema>,
  "rows"
> & { rows: ClassifierRow[] };
export const jevFeatureValuesSchema = z.strictObject({
  jev_regular_timing: probability,
  jev_repeated_workflow: probability,
  jev_mechanical_input: probability,
  jev_abuse_evidence: probability,
});
export const jevFeatureResultSchema = z.strictObject({
  version: z.literal(CLASSIFIER_FEATURE_VERSION),
  providerModel: z.string().regex(/^jev-\d+\.\d+\.\d+$/),
  values: jevFeatureValuesSchema,
});
export type JevFeatureResult = z.infer<typeof jevFeatureResultSchema>;
export type JevFeatureValues = z.infer<typeof jevFeatureValuesSchema>;
export const classifierEnrichmentSchema = z.strictObject({
  version: z.literal(1),
  datasetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  questionVersion: z.literal(CLASSIFIER_FEATURE_VERSION),
  providerModel: z.string().regex(/^jev-\d+\.\d+\.\d+$/),
  synthetic: z.boolean(),
  rows: z
    .array(
      z.strictObject({
        tenantId: opaqueId,
        sampleId: opaqueId,
        values: jevFeatureValuesSchema,
      }),
    )
    .max(10000),
});
export type ClassifierEnrichment = z.infer<typeof classifierEnrichmentSchema>;
const columnSchema = z.strictObject({
  name: z.enum(CLASSIFIER_FEATURE_NAMES),
  mean: finite.min(-1e7).max(1e7),
  scale: finite.min(1e-8).max(1e7),
});
const treeSchema = z
  .strictObject({
    splits: z
      .array(
        z.strictObject({
          column: z.number().int().min(0).max(72),
          border: finite.min(-1e8).max(1e8),
        }),
      )
      .max(4),
    leaves: z.array(finite.min(-1000).max(1000)).min(1).max(16),
  })
  .refine(
    (t) => t.leaves.length === 2 ** t.splits.length,
    "Invalid tree leaf count",
  );
export const classifierParametersSchema = z
  .strictObject({
    columns: z.array(columnSchema).min(2).max(CLASSIFIER_FEATURE_NAMES.length),
    estimator: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("logistic"),
        weights: z
          .array(finite.min(-1000).max(1000))
          .min(2)
          .max(CLASSIFIER_FEATURE_NAMES.length),
        bias: finite.min(-1000).max(1000),
      }),
      z.strictObject({
        kind: z.literal("boosted-trees"),
        trees: z.array(treeSchema).min(1).max(128),
        scale: finite.min(0).max(100),
        bias: finite.min(-1000).max(1000),
      }),
    ]),
    calibration: z.strictObject({
      slope: finite.min(0.0001).max(100),
      bias: finite.min(-1000).max(1000),
    }),
  })
  .superRefine((p, ctx) => {
    if (
      new Set(p.columns.map((c) => c.name)).size !== p.columns.length ||
      (p.estimator.kind === "logistic"
        ? p.estimator.weights.length !== p.columns.length
        : p.estimator.trees.some((t) =>
            t.splits.some((s) => s.column >= p.columns.length),
          ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid or duplicate model columns",
      });
  });
export type ClassifierParameters = z.infer<typeof classifierParametersSchema>;
export const classifierMetricsSchema = z.strictObject({
  positives: count,
  negatives: count,
  tenants: count,
  scored: count,
  truePositives: count,
  falsePositives: count,
  coverage: probability,
  precision: probability.nullable(),
  precisionLower: probability,
  falsePositiveRate: probability.nullable(),
  falsePositiveUpper: probability,
  recall: probability.nullable(),
  brier: probability.nullable(),
  logLoss: finite.min(0).max(40).nullable(),
  baselineBrier: probability.nullable(),
  calibrationError: probability.nullable(),
  rocAuc: probability.nullable().default(null),
  bins: z
    .array(
      z.strictObject({ count, predicted: probability, observed: probability }),
    )
    .max(10),
});
export type ClassifierMetrics = z.infer<typeof classifierMetricsSchema>;
export const classifierCandidateSchema = z
  .strictObject({
    name: z.enum([
      "telemetry-logistic",
      "telemetry-boosted-trees",
      "jev-logistic",
      "jev-boosted-trees",
    ]),
    mode: z.enum(["telemetry", "jev"]),
    parameters: classifierParametersSchema,
  })
  .refine(
    (c) =>
      c.name === `${c.mode}-${c.parameters.estimator.kind}` &&
      (c.mode === "jev") ===
        c.parameters.columns.some((column) => column.name.startsWith("jev_")),
    "Candidate name, feature mode and estimator must agree",
  );
export type ClassifierCandidate = z.infer<typeof classifierCandidateSchema>;
export const classifierTrainingSchema = z
  .strictObject({
    version: z.literal(1),
    datasetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    trainerVersion: z.string().min(1).max(200),
    candidates: z.array(classifierCandidateSchema).min(1).max(4),
  })
  .refine(
    (t) =>
      new Set(t.candidates.map((c) => c.name)).size === t.candidates.length,
    "Duplicate model candidates",
  );
export const classifierModelSchema = z
  .strictObject({
    version: z.literal(1),
    id: opaqueId,
    manifest: classifierManifestSchema,
    trainerVersion: z.string().min(1).max(200),
    selected: classifierCandidateSchema,
    jev: z
      .strictObject({
        version: z.literal(CLASSIFIER_FEATURE_VERSION),
        providerModel: z.string().regex(/^jev-\d+\.\d+\.\d+$/),
      })
      .optional(),
    threshold: probability,
    trainingPrevalence: probability,
    metrics: z.record(z.enum(PARTITIONS), classifierMetricsSchema),
    cohorts: z.partialRecord(cohortSchema, classifierMetricsSchema),
    tenants: z.record(
      z.string().regex(/^tenant_[a-f0-9]{32,64}$/),
      classifierMetricsSchema,
    ),
    comparison: z
      .array(
        z.strictObject({
          name: classifierCandidateSchema.shape.name,
          threshold: probability,
          validation: classifierMetricsSchema,
        }),
      )
      .min(1)
      .max(4),
    gates: z.record(z.string().max(64), z.boolean()),
    eligible: z.boolean(),
  })
  .refine(
    (m) => (m.selected.mode === "jev") === !!m.jev,
    "Jev model requires a pinned feature version",
  );
export type ClassifierModel = z.infer<typeof classifierModelSchema>;
export const classifierAssessmentSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(["evaluated", "unavailable", "disabled"]),
  cached: z.boolean(),
  predictions: z
    .array(
      z.strictObject({
        target: z.enum(["assistant", "abuse"]),
        modelId: opaqueId,
        mode: z.enum(["shadow", "canary"]),
        score: probability.nullable(),
        aboveThreshold: z.boolean(),
        reason: z.enum([
          "scored",
          "missing-evidence",
          "jev-unavailable",
          "expired",
        ]),
      }),
    )
    .max(2),
});
export type ClassifierAssessment = z.infer<typeof classifierAssessmentSchema>;
