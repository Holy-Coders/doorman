import type { NormalizedObservation } from "./types.js";

// Identity weights only. Automation and behavior never affect identity similarity.
export const SIMILARITY_WEIGHTS = Object.freeze({
  samePlatform: 0.18,
  sameBrowser: 0.12,
  sameTimezone: 0.05,
  sameLanguages: 0.07,
  screenSimilarity: 0.14,
  viewportSimilarity: 0.02,
  sameHardwareConcurrency: 0.1,
  sameDeviceMemory: 0.07,
  sameTouchCapabilities: 0.05,
  sameWebglVendor: 0.07,
  sameWebglRenderer: 0.13,
} as const);
export const MIN_EVIDENCE_WEIGHT = 0.55;
export const CONTRADICTION_CAP = 0.5;

export type SimilarityWeights = Record<keyof typeof SIMILARITY_WEIGHTS, number>;
/** Relative nonnegative weights; unspecified features retain their default weight. */
export function resolveSimilarityWeights(
  input?: Partial<SimilarityWeights>,
): Readonly<SimilarityWeights> {
  if (input === undefined) return SIMILARITY_WEIGHTS;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(SIMILARITY_WEIGHTS, key))
  )
    throw new Error("Invalid similarity weights");
  const weights = { ...SIMILARITY_WEIGHTS, ...input };
  const values = Object.values(weights);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (
    values.some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || value < 0,
    ) ||
    !Number.isFinite(total) ||
    total <= 0
  )
    throw new Error("Invalid similarity weights");
  return Object.freeze(
    Object.fromEntries(
      Object.entries(weights).map(([key, value]) => [key, value / total]),
    ) as SimilarityWeights,
  );
}

export type SimilarityFeatures = {
  samePlatform?: boolean;
  sameBrowser?: boolean;
  sameTimezone?: boolean;
  sameLanguages?: boolean;
  screenSimilarity?: number;
  viewportSimilarity?: number;
  sameHardwareConcurrency?: boolean;
  sameDeviceMemory?: boolean;
  sameTouchCapabilities?: boolean;
  sameWebglVendor?: boolean;
  sameWebglRenderer?: boolean;
  webdriverDetected?: boolean;
};
const equal = <T>(a: T | undefined, b: T | undefined) =>
  a === undefined || b === undefined ? undefined : a === b;
const ratio = (a: number, b: number) =>
  a === b ? 1 : Math.min(a, b) / Math.max(a, b);
function dimensions(
  a?: { width?: number; height?: number },
  b?: { width?: number; height?: number },
) {
  if (
    a?.width === undefined ||
    a.height === undefined ||
    b?.width === undefined ||
    b.height === undefined
  )
    return undefined;
  return (
    (ratio(Math.min(a.width, a.height), Math.min(b.width, b.height)) +
      ratio(Math.max(a.width, a.height), Math.max(b.width, b.height))) /
    2
  );
}

export function hasContradiction(
  a: NormalizedObservation,
  b: NormalizedObservation,
): boolean {
  if (a.platform && b.platform && a.platform !== b.platform) return true;
  const touch = equal(a.hardware?.maxTouchPoints, b.hardware?.maxTouchPoints);
  const screen = dimensions(a.screen, b.screen);
  const vendor = equal(a.graphics?.webglVendor, b.graphics?.webglVendor);
  // A graphics change alone can be a driver update. Require another large class change.
  return (
    screen !== undefined &&
    screen < 0.55 &&
    (touch === false || vendor === false)
  );
}

export function calculateSimilarity(
  a: NormalizedObservation,
  b: NormalizedObservation,
  weights?: Partial<SimilarityWeights>,
): {
  score: number;
  features: SimilarityFeatures;
} {
  const features: SimilarityFeatures = {
    samePlatform: equal(a.platform, b.platform),
    sameBrowser: equal(a.browser, b.browser),
    sameTimezone: equal(a.timezone, b.timezone),
    sameLanguages: equal(a.languages?.join(","), b.languages?.join(",")),
    screenSimilarity: dimensions(a.screen, b.screen),
    viewportSimilarity: dimensions(a.viewport, b.viewport),
    sameHardwareConcurrency: equal(
      a.hardware?.hardwareConcurrency,
      b.hardware?.hardwareConcurrency,
    ),
    sameDeviceMemory: equal(a.hardware?.deviceMemory, b.hardware?.deviceMemory),
    sameTouchCapabilities: equal(
      a.hardware?.maxTouchPoints,
      b.hardware?.maxTouchPoints,
    ),
    sameWebglVendor: equal(a.graphics?.webglVendor, b.graphics?.webglVendor),
    sameWebglRenderer: equal(
      a.graphics?.webglRenderer,
      b.graphics?.webglRenderer,
    ),
    webdriverDetected:
      a.automation?.webdriver === true || b.automation?.webdriver === true
        ? true
        : undefined,
  };
  const resolved = resolveSimilarityWeights(weights);
  let baseAvailable = 0;
  let available = 0;
  let matched = 0;
  for (const name of Object.keys(
    SIMILARITY_WEIGHTS,
  ) as (keyof typeof SIMILARITY_WEIGHTS)[]) {
    const value = features[name];
    if (value === undefined) continue;
    baseAvailable += SIMILARITY_WEIGHTS[name];
    available += resolved[name];
    matched += Number(value) * resolved[name];
  }
  return {
    score: Math.min(
      1,
      baseAvailable / MIN_EVIDENCE_WEIGHT,
      matched / Math.max(available, MIN_EVIDENCE_WEIGHT),
    ),
    features,
  };
}

// This cap also applies after AI blending: sparse matching evidence cannot be amplified to 1.
export function evidenceCap(
  a: NormalizedObservation,
  b: NormalizedObservation,
): number {
  const { features } = calculateSimilarity(a, b);
  const available = (
    Object.keys(SIMILARITY_WEIGHTS) as (keyof typeof SIMILARITY_WEIGHTS)[]
  ).reduce(
    (sum, name) =>
      sum + (features[name] === undefined ? 0 : SIMILARITY_WEIGHTS[name]),
    0,
  );
  return Math.min(
    1,
    available / MIN_EVIDENCE_WEIGHT,
    hasContradiction(a, b) ? CONTRADICTION_CAP : 1,
  );
}
