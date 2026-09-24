import type { Evaluation, NormalizedObservation } from "./types.js";
import type { LearningExample } from "./learning.js";

/** A planner may choose these indexed probe families, never SQL or arbitrary filters. */
export type LookupScope = { graphics: boolean; locale: boolean };
export type CandidateEvaluationInput = {
  classifyOperator?: boolean;
  riskEvidence?: import("./context.js").RiskEvidence;
  current: NormalizedObservation;
  candidates: {
    history: NormalizedObservation[];
    deterministicSimilarity: number;
  }[];
};
export type CrossDeviceInput = {
  current: NormalizedObservation;
  examples: LearningExample[];
};
export type CrossDevicePrediction = { subjectId?: string; score?: number };
export const INTELLIGENCE_LIMITS = {
  candidates: 10,
  subjects: 10,
  examplesPerSubject: 3,
  crossDeviceThreshold: 0.9,
  crossDeviceMargin: 0.1,
  lookupRows: 100,
} as const;
export function isLookupScope(value: unknown): value is LookupScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as LookupScope;
  return (
    typeof scope.graphics === "boolean" && typeof scope.locale === "boolean"
  );
}
export function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
export function isCandidateEvaluations(value: unknown): value is Evaluation[] {
  return (
    Array.isArray(value) &&
    value.length <= INTELLIGENCE_LIMITS.candidates &&
    value.every((v: unknown) => {
      if (!v || typeof v !== "object") return false;
      const r = v as Evaluation;
      return (
        [r.sameVisitor, r.automation, r.suspicious].every(isProbability) &&
        (r.operator === undefined ||
          [
            r.operator?.human,
            r.operator?.assistant,
            r.operator?.automation,
          ].every(isProbability))
      );
    })
  );
}
export function isCrossDevicePrediction(
  value: unknown,
): value is CrossDevicePrediction {
  if (!value || typeof value !== "object") return false;
  const result = value as CrossDevicePrediction;
  return (
    result.subjectId === undefined ||
    (typeof result.subjectId === "string" && isProbability(result.score))
  );
}

/** Optional evaluation never makes identity persistence depend on model availability. */
export async function attemptEvaluation<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  validate: (value: unknown) => value is T,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(run),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
    return validate(result) ? result : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
