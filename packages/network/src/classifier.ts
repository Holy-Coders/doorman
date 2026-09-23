import {
  classifierModelSchema,
  jevFeatureResultSchema,
} from "./classifier-schema.js";
import type {
  ClassifierCandidate,
  ClassifierModel,
  JevFeatureResult,
} from "./classifier-schema.js";
import { parseFeatures } from "./schema.js";
import type { FeatureVector } from "./schema.js";

export const CLASSIFIER_LIMITS = {
  minimumCoverage: 0.8,
  minimumGroups: 2,
  minimumPositives: 100,
  minimumNegatives: 300,
  minimumTenants: 3,
  precisionLower: 0.9,
  falsePositiveUpper: 0.02,
  minimumRecall: 0.25,
  maximumCalibrationError: 0.1,
  minimumRocAuc: 0.75,
  minimumBrierImprovement: 0.002,
} as const;
export const sigmoid = (x: number) =>
  x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
/** Parameters have already been validated when loading an artifact. Never executes model code. */
export function scoreClassifier(
  candidate: ClassifierCandidate,
  features: FeatureVector,
  jev?: JevFeatureResult,
): number | null {
  const values: Record<string, number | undefined> = {
    ...features,
    ...(jev?.values ?? {}),
  };
  const { columns, estimator, calibration } = candidate.parameters;
  if (
    columns.filter((c) => values[c.name] !== undefined).length /
      columns.length <
    CLASSIFIER_LIMITS.minimumCoverage
  )
    return null;
  const x = columns.map((c) => ((values[c.name] ?? c.mean) - c.mean) / c.scale);
  let raw: number;
  if (estimator.kind === "logistic")
    raw =
      estimator.bias +
      estimator.weights.reduce((sum, w, i) => sum + w * x[i]!, 0);
  else {
    // CatBoost quantizes numeric inputs as float32; preserve its boundary behavior.
    const numeric = x.map(Math.fround);
    let total = 0;
    for (const tree of estimator.trees) {
      let leaf = 0;
      tree.splits.forEach((s, bit) => {
        if (numeric[s.column]! > s.border) leaf |= 1 << bit;
      });
      total += tree.leaves[leaf]!;
    }
    raw = estimator.scale * total + estimator.bias;
  }
  const score = sigmoid(calibration.slope * raw + calibration.bias);
  return Number.isFinite(score) ? score : null;
}
export function createClassifierPredictor(input: unknown) {
  const model = classifierModelSchema.parse(input);
  return {
    model,
    predict(
      featuresInput: FeatureVector,
      jevInput?: JevFeatureResult,
      now = Date.now(),
    ): {
      score: number | null;
      reason: "scored" | "missing-evidence" | "jev-unavailable" | "expired";
    } {
      if (model.manifest.expiresAt <= now)
        return { score: null, reason: "expired" };
      const features = parseFeatures(featuresInput);
      const parsed = jevFeatureResultSchema.safeParse(jevInput);
      if (
        model.jev &&
        (!parsed.success ||
          parsed.data.version !== model.jev.version ||
          parsed.data.providerModel !== model.jev.providerModel)
      )
        return { score: null, reason: "jev-unavailable" };
      const score = scoreClassifier(
        model.selected,
        features,
        model.jev && parsed.success ? parsed.data : undefined,
      );
      return { score, reason: score === null ? "missing-evidence" : "scored" };
    },
  };
}
export type { ClassifierModel };
