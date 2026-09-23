import { z } from "zod";

export const ROUTE_CATEGORIES = [
  "navigation",
  "read",
  "write",
  "auth",
  "tool",
  "telemetry",
  "other",
] as const;
export type RouteCategory = (typeof ROUTE_CATEGORIES)[number];
const range = (max: number) => z.number().finite().min(0).max(max).optional();
const baseFeatures = {
  observation_duration_ms: range(900_000),
  mouse_event_count: range(1_000_000),
  interaction_sample_count: range(1_000_000),
  api_request_count: range(1_000_000),
  api_denied_ratio: range(1),
  api_error_ratio: range(1),
  api_duration_mean_ms: range(60_000),
  api_short_gap_ratio: range(1),
  api_gap_mean_ms: range(60_000),
  api_gap_cv: range(10),
  api_sequence_repeat_ratio: range(1),
  webdriver: z.union([z.literal(0), z.literal(1)]).optional(),
  runtime_marker_count: range(8),
  webdriver_own_property: z.union([z.literal(0), z.literal(1)]).optional(),
  notification_mismatch: z.union([z.literal(0), z.literal(1)]).optional(),
  target_sample_count: range(1_000_000),
  target_center_ratio: range(1),
  target_corner_ratio: range(1),
  focus_change_count: range(1_000_000),
  unfocused_input_ratio: range(1),
  decoy_activation_count: range(1_000_000),
  mouse_step_mean_px: range(50_000),
  mouse_large_step_ratio: range(1),
  mouse_interval_cv: range(10),
  interaction_short_gap_ratio: range(1),
  interaction_repeat_gap_ratio: range(1),
  mouse_speed: range(10_000),
  mouse_turn_ratio: range(1),
  mouse_pause_ratio: range(1),
  interaction_mean_ms: range(60_000),
  interaction_cv: range(10),
} as const;
const routeFeatures = Object.fromEntries(
  ROUTE_CATEGORIES.map((r) => [`route_${r}_share`, range(1)]),
);
const transitions = Object.fromEntries(
  ROUTE_CATEGORIES.flatMap((a) =>
    ROUTE_CATEGORIES.map((b) => [`transition_${a}_${b}`, range(1)]),
  ),
);
export const featureSchema = z.strictObject({
  ...baseFeatures,
  ...routeFeatures,
  ...transitions,
});
export type FeatureVector = Partial<
  Record<
    | keyof typeof baseFeatures
    | `route_${RouteCategory}_share`
    | `transition_${RouteCategory}_${RouteCategory}`,
    number
  >
>;
export const FEATURE_NAMES = Object.keys(
  featureSchema.shape,
) as (keyof FeatureVector)[];
export function parseFeatures(input: unknown): FeatureVector {
  return featureSchema.parse(input) as FeatureVector;
}
export const opaqueId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,15}_[a-f0-9]{32,64}$/);
export const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
export const cohortSchema = z.enum([
  "standard",
  "accessibility",
  "privacy",
  "api",
  "unknown",
]);
export type Cohort = z.infer<typeof cohortSchema>;
export const contributionSchema = z.strictObject({
  version: z.literal(1),
  sampleId: opaqueId,
  sessionReference: z.string().regex(/^ref_[a-f0-9]{64}$/),
  observedAt: timestamp,
  features: featureSchema,
  cohort: cohortSchema.default("unknown"),
  trainingAllowed: z.boolean().default(false),
});
export type Contribution = Omit<
  z.infer<typeof contributionSchema>,
  "features"
> & { features: FeatureVector };
export const feedbackSchema = z
  .strictObject({
    sampleId: opaqueId,
    target: z.enum(["assistant", "abuse"]),
    positive: z.boolean(),
    source: z.enum([
      "verified-delegation",
      "reviewed-session",
      "confirmed-incident",
    ]),
    evidenceReference: z.string().regex(/^ref_[a-f0-9]{64}$/),
  })
  .refine(
    (v) =>
      v.source === "reviewed-session" ||
      (v.source === "verified-delegation"
        ? v.target === "assistant" && v.positive
        : v.target === "abuse" && v.positive),
    "Evidence does not support this label",
  );
export type Feedback = z.infer<typeof feedbackSchema>;
export type Target = Feedback["target"];
export type TrainingRow = Contribution & {
  tenantId: string;
  target: Target;
  positive: boolean;
  confirmedAt: number;
  expiresAt: number;
  /** Required by classifier exports; optional for legacy rule-discovery fixtures. */
  source?: Feedback["source"];
  evidenceReference?: string;
};
export const preferencesSchema = z
  .strictObject({
    evaluation: z.boolean(),
    contribution: z.boolean(),
    training: z.boolean(),
  })
  .refine(
    (p) => !p.training || p.contribution,
    "Training requires contribution",
  );
export type NetworkPreferences = z.infer<typeof preferencesSchema>;
export const evaluationSchema = z.strictObject({
  version: z.literal(1),
  features: featureSchema,
});
export type NetworkRisk = { automation: number; suspicious: number };
export type PatternEvidence = {
  patternId: string;
  target: Target;
  predicates: Predicate[];
  holdoutPrecision: number | null;
  holdoutFalsePositiveRate: number | null;
  support: number;
};
export type NetworkAssessment = {
  version: 1;
  evaluatorVersion: string | null;
  providerModel?: string;
  risk: NetworkRisk;
  riskStatus: "evaluated" | "unavailable" | "disabled";
  modelVersion: string | null;
  patternMode: "none" | "shadow" | "canary";
  patterns: PatternEvidence[];
  cached: boolean;
};
export type Predicate = {
  feature: keyof FeatureVector;
  operator: "gte" | "lte";
  value: number;
};
export function featureGroup(name: keyof FeatureVector): string {
  if (
    [
      "webdriver",
      "runtime_marker_count",
      "webdriver_own_property",
      "notification_mismatch",
    ].includes(name)
  )
    return "runtime";
  if (name.startsWith("route_")) return "routes";
  if (name.startsWith("transition_") || name === "api_sequence_repeat_ratio")
    return "sequence";
  if (name.startsWith("mouse_")) return "mouse";
  if (name.startsWith("interaction_")) return "interaction";
  if (name.includes("denied") || name.includes("error")) return "errors";
  if (name === "api_request_count") return "volume";
  return "timing";
}
