import { isProbability } from "./intelligence.js";

export const OPERATOR_KINDS = ["human", "assistant", "automation"] as const;
export type OperatorKind = (typeof OPERATOR_KINDS)[number];
const categories = [
  "navigation",
  "read",
  "write",
  "auth",
  "tool",
  "telemetry",
  "other",
] as const;
export const OPERATOR_FEATURE_NAMES = [
  "observation_duration_ms",
  "mouse_event_count",
  "interaction_sample_count",
  "api_request_count",
  "api_denied_ratio",
  "api_error_ratio",
  "api_duration_mean_ms",
  "api_short_gap_ratio",
  "api_gap_mean_ms",
  "api_gap_cv",
  "api_sequence_repeat_ratio",
  "webdriver",
  "mouse_step_mean_px",
  "mouse_large_step_ratio",
  "mouse_interval_cv",
  "interaction_short_gap_ratio",
  "interaction_repeat_gap_ratio",
  "mouse_speed",
  "mouse_turn_ratio",
  "mouse_pause_ratio",
  "interaction_mean_ms",
  "interaction_cv",
  ...categories.map((c) => `route_${c}_share` as const),
  ...categories.flatMap((a) =>
    categories.map((b) => `transition_${a}_${b}` as const),
  ),
] as const;
export type OperatorFeatures = Partial<
  Record<(typeof OPERATOR_FEATURE_NAMES)[number], number>
>;
export type OperatorEvidence = {
  source: "browser" | "server" | "mixed";
  features: OperatorFeatures;
};
/** Operator-supplied references from independently labeled runs; never model predictions. */
export type AgentFamilyReference = {
  family: string;
  version: string;
  source: "controlled-study";
  expiresAt: number;
  examples: OperatorEvidence[];
};
export type OperatorEvaluationInput = {
  current: OperatorEvidence;
  candidates: { id: string; evidence: OperatorEvidence }[];
  families: AgentFamilyReference[];
};
/** These are independent scores, not a normalized or calibrated probability distribution. */
export type OperatorEvaluation = {
  modelVersion: string;
  scores: Record<OperatorKind, number>;
  abuse: number;
  families: { family: string; score: number }[];
  links: { windowId: string; score: number }[];
};
export const OPERATOR_LIMITS = {
  candidates: 10,
  summaryWindows: 200,
  families: 6,
  familyExamples: 5,
  labelThreshold: 0.75,
  labelMargin: 0.15,
  familyThreshold: 0.85,
  familyMargin: 0.15,
  linkThreshold: 0.9,
  looseLinkThreshold: 0.8,
  strictLinkThreshold: 0.98,
} as const;
export const OPERATOR_THRESHOLDS = Object.freeze({
  labelThreshold: OPERATOR_LIMITS.labelThreshold,
  labelMargin: OPERATOR_LIMITS.labelMargin,
  familyThreshold: OPERATOR_LIMITS.familyThreshold,
  familyMargin: OPERATOR_LIMITS.familyMargin,
  linkThreshold: OPERATOR_LIMITS.linkThreshold,
  looseLinkThreshold: OPERATOR_LIMITS.looseLinkThreshold,
  strictLinkThreshold: OPERATOR_LIMITS.strictLinkThreshold,
});
export type OperatorThresholds = {
  [K in keyof typeof OPERATOR_THRESHOLDS]: number;
};
export function resolveOperatorThresholds(
  input?: Partial<OperatorThresholds>,
): Readonly<OperatorThresholds> {
  if (input === undefined) return OPERATOR_THRESHOLDS;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(OPERATOR_THRESHOLDS, key))
  )
    throw new Error("Invalid operator thresholds");
  const thresholds = { ...OPERATOR_THRESHOLDS, ...input };
  if (
    Object.entries(thresholds).some(
      ([key, value]) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value > 1 ||
        value <= 0 ||
        (key.endsWith("Threshold") && value < 0.5),
    ) ||
    thresholds.looseLinkThreshold > thresholds.linkThreshold ||
    thresholds.linkThreshold > thresholds.strictLinkThreshold
  )
    throw new Error("Invalid operator thresholds");
  return Object.freeze(thresholds);
}
/** Canonical settings, independent of model version; suitable for analytics provenance. */
export function operatorPolicy(input?: Partial<OperatorThresholds>): string {
  return (
    "operators-v1:" + Object.values(resolveOperatorThresholds(input)).join(":")
  );
}
export type OperatorWindow = {
  id: string;
  accountKey: string;
  browserKey?: string;
  sessionKey: string;
  startedAt: number;
  endedAt: number;
  expiresAt: number;
  inputDigest: string;
  lease: string;
  evidence: OperatorEvidence;
  status:
    | "pending"
    | "evaluated"
    | "unavailable"
    | "insufficient-evidence"
    | "disabled";
  evaluation?: OperatorEvaluation;
  referenceVersions?: Record<string, string>;
  thresholds?: Readonly<OperatorThresholds>;
};
export interface OperatorStorage {
  get(accountKey: string, id: string): Promise<OperatorWindow | undefined>;
  /** Immutable insert; exactly one concurrent caller wins evaluation. */
  claim(window: OperatorWindow): Promise<boolean>;
  finish(window: OperatorWindow): Promise<boolean>;
  recent(
    accountKey: string,
    since: number,
    until: number,
    limit: number,
  ): Promise<OperatorWindow[]>;
  deleteAccount(accountKey: string): Promise<void>;
  deleteBrowser(accountKey: string, browserKey: string): Promise<void>;
  deleteSession(accountKey: string, sessionKey: string): Promise<void>;
  cleanup(now: number, limit: number): Promise<void>;
}
export function isOperatorEvaluation(
  value: unknown,
): value is OperatorEvaluation {
  if (!value || typeof value !== "object") return false;
  const v = value as OperatorEvaluation;
  return (
    typeof v.modelVersion === "string" &&
    v.modelVersion.length > 0 &&
    v.modelVersion.length <= 160 &&
    !!v.scores &&
    OPERATOR_KINDS.every((kind) => isProbability(v.scores[kind])) &&
    isProbability(v.abuse) &&
    Array.isArray(v.families) &&
    v.families.length <= OPERATOR_LIMITS.families &&
    v.families.every(
      (f) =>
        !!f &&
        typeof f.family === "string" &&
        f.family.length <= 64 &&
        isProbability(f.score),
    ) &&
    new Set(v.families.map((f) => f.family)).size === v.families.length &&
    Array.isArray(v.links) &&
    v.links.length <= OPERATOR_LIMITS.candidates &&
    v.links.every(
      (l) =>
        !!l &&
        typeof l.windowId === "string" &&
        l.windowId.length <= 100 &&
        isProbability(l.score),
    ) &&
    new Set(v.links.map((l) => l.windowId)).size === v.links.length
  );
}
export function operatorLabel(
  evaluation?: OperatorEvaluation,
  options?: Partial<OperatorThresholds>,
): OperatorKind | "unknown" {
  const thresholds = resolveOperatorThresholds(options);
  if (!evaluation) return "unknown";
  const ranked = OPERATOR_KINDS.map((kind) => ({
    kind,
    score: evaluation.scores[kind],
  })).sort((a, b) => b.score - a.score);
  return ranked[0]!.score >= thresholds.labelThreshold &&
    ranked[0]!.score - ranked[1]!.score >= thresholds.labelMargin
    ? ranked[0]!.kind
    : "unknown";
}
export function agentFamily(
  evaluation?: OperatorEvaluation,
  options?: Partial<OperatorThresholds>,
): { family: string; score: number } | undefined {
  const thresholds = resolveOperatorThresholds(options);
  if (!evaluation || operatorLabel(evaluation, thresholds) !== "assistant")
    return undefined;
  const ranked = [...evaluation.families].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best &&
    best.score >= thresholds.familyThreshold &&
    best.score - (ranked[1]?.score ?? 0) >= thresholds.familyMargin
    ? best
    : undefined;
}
/** Requiring sample support is an abstention rule, never evidence that a session is human. */
export function hasOperatorEvidence(evidence: OperatorEvidence): boolean {
  const f = evidence.features;
  return (
    (f.observation_duration_ms ?? 0) >= 5000 &&
    (((f.interaction_sample_count ?? 0) >= 10 &&
      f.interaction_mean_ms !== undefined &&
      f.interaction_cv !== undefined) ||
      ((f.api_request_count ?? 0) >= 10 &&
        (f.api_gap_cv !== undefined ||
          f.api_sequence_repeat_ratio !== undefined)) ||
      ((f.mouse_event_count ?? 0) >= 20 &&
        f.mouse_speed !== undefined &&
        f.mouse_turn_ratio !== undefined))
  );
}
