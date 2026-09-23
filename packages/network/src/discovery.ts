import {
  FEATURE_NAMES,
  contributionSchema,
  featureGroup,
  parseFeatures,
} from "./schema.js";
import type {
  Cohort,
  FeatureVector,
  PatternEvidence,
  Predicate,
  Target,
  TrainingRow,
} from "./schema.js";

export type PatternMetrics = {
  positives: number;
  negatives: number;
  truePositives: number;
  falsePositives: number;
  precision: number | null;
  precisionLower: number;
  falsePositiveRate: number | null;
  falsePositiveUpper: number;
  recall: number | null;
  tenants: number;
};
export type LearnedPattern = {
  id: string;
  predicates: Predicate[];
  training: PatternMetrics;
  validation: PatternMetrics;
  holdout: PatternMetrics;
};
export type PatternModel = {
  version: 1;
  id: string;
  target: Target;
  createdAt: number;
  expiresAt: number;
  datasetRevision: number;
  sampleCount: number;
  trainingBefore: number;
  validationBefore: number;
  sampled: boolean;
  holdoutTenants: string[];
  datasetDigest?: string;
  patterns: LearnedPattern[];
  metrics: {
    training: PatternMetrics;
    validation: PatternMetrics;
    holdout: PatternMetrics;
  };
  cohorts: Partial<Record<Cohort, PatternMetrics>>;
  gates: Record<string, boolean>;
  eligible: boolean;
};
export type DiscoveryOptions = {
  target: Target;
  trainingBefore: number;
  validationBefore: number;
  /** Choose before inspecting results. These tenants never influence thresholds or ranking. */
  holdoutTenants: string[];
  datasetRevision: number;
  now?: number;
};
export const PATTERN_GATES = {
  maxRows: 10_000,
  maxPerTenantPerSplit: 500,
  maxPatterns: 3,
  minPositives: 100,
  minNegatives: 300,
  minTenants: 3,
  precisionLower: 0.9,
  falsePositiveUpper: 0.02,
} as const;

/** Missing values never satisfy a predicate. No predicates test for missing browser APIs. */
export function matches(
  features: FeatureVector,
  predicates: readonly Predicate[],
): boolean {
  return (
    predicates.length > 0 &&
    predicates.every((p) => {
      const value = features[p.feature];
      return (
        value !== undefined &&
        (p.operator === "gte" ? value >= p.value : value <= p.value)
      );
    })
  );
}
function wilson(successes: number, trials: number): [number, number] {
  if (!trials) return [0, 1];
  const z = 1.96,
    p = successes / trials,
    denominator = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials),
    spread =
      z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return [(center - spread) / denominator, (center + spread) / denominator];
}
function metrics(
  rows: TrainingRow[],
  rules: readonly (readonly Predicate[])[],
): PatternMetrics {
  let positives = 0,
    negatives = 0,
    truePositives = 0,
    falsePositives = 0;
  for (const row of rows) {
    const predicted = rules.some((rule) => matches(row.features, rule));
    if (row.positive) {
      positives++;
      truePositives += Number(predicted);
    } else {
      negatives++;
      falsePositives += Number(predicted);
    }
  }
  const hits = truePositives + falsePositives;
  return {
    positives,
    negatives,
    truePositives,
    falsePositives,
    precision: hits ? truePositives / hits : null,
    precisionLower: wilson(truePositives, hits)[0],
    falsePositiveRate: negatives ? falsePositives / negatives : null,
    falsePositiveUpper: wilson(falsePositives, negatives)[1],
    recall: positives ? truePositives / positives : null,
    tenants: new Set(rows.map((r) => r.tenantId)).size,
  };
}
function hash(value: string): number {
  let result = 2166136261;
  for (const char of value)
    result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
  return result;
}
function balanced(rows: TrainingRow[]): TrainingRow[] {
  const counts = new Map<string, number>();
  // Stable label-independent sampling; sorting does not favor the newest or positive rows.
  return [...rows]
    .sort(
      (a, b) =>
        hash(a.sampleId) - hash(b.sampleId) ||
        a.sampleId.localeCompare(b.sampleId),
    )
    .filter((r) => {
      const n = counts.get(r.tenantId) ?? 0;
      counts.set(r.tenantId, n + 1);
      return n < PATTERN_GATES.maxPerTenantPerSplit;
    });
}
const rank = (m: PatternMetrics) =>
  m.precisionLower + (m.recall ?? 0) * 0.2 - m.falsePositiveUpper;

/** Bounded, interpretable discovery. Learns thresholds and pairs; no provider/model calls. */
export function discoverPatterns(
  input: TrainingRow[],
  options: DiscoveryOptions,
): PatternModel {
  const now = options.now ?? Date.now();
  if (
    input.length > PATTERN_GATES.maxRows ||
    !Number.isSafeInteger(options.datasetRevision) ||
    options.datasetRevision < 0 ||
    !(
      options.trainingBefore > 0 &&
      options.validationBefore > options.trainingBefore &&
      now > options.validationBefore
    ) ||
    ![now, options.trainingBefore, options.validationBefore].every(
      Number.isSafeInteger,
    ) ||
    !["assistant", "abuse"].includes(options.target) ||
    !options.holdoutTenants.length
  )
    throw new Error("Invalid discovery limits or split");
  const sessions = new Set<string>(),
    ids = new Set<string>();
  // Validate before selecting: duplicate sessions cannot cross evaluation partitions.
  const valid = input
    .map((row) => {
      const sample = contributionSchema.parse({
        version: row.version,
        sampleId: row.sampleId,
        sessionReference: row.sessionReference,
        observedAt: row.observedAt,
        features: row.features,
        cohort: row.cohort,
        trainingAllowed: row.trainingAllowed,
      });
      const session = row.tenantId + ":" + row.sessionReference,
        id = row.tenantId + ":" + row.sampleId;
      if (
        !row.tenantId ||
        sessions.has(session) ||
        ids.has(id) ||
        !Number.isSafeInteger(row.confirmedAt) ||
        !Number.isSafeInteger(row.expiresAt) ||
        row.confirmedAt < sample.observedAt ||
        row.confirmedAt > now ||
        !["assistant", "abuse"].includes(row.target) ||
        typeof row.positive !== "boolean"
      )
        throw new Error("Invalid or duplicate training evidence");
      sessions.add(session);
      ids.add(id);
      return { ...row, ...sample } as TrainingRow;
    })
    .filter(
      (row) =>
        row.trainingAllowed &&
        row.expiresAt > now &&
        row.target === options.target,
    );
  const heldout = new Set(options.holdoutTenants);
  const training = balanced(
    valid.filter(
      (r) =>
        !heldout.has(r.tenantId) &&
        r.observedAt < options.trainingBefore &&
        r.confirmedAt < options.trainingBefore,
    ),
  );
  const validation = balanced(
    valid.filter(
      (r) =>
        !heldout.has(r.tenantId) &&
        r.observedAt >= options.trainingBefore &&
        r.observedAt < options.validationBefore &&
        r.confirmedAt < options.validationBefore,
    ),
  );
  const holdout = balanced(
    valid.filter(
      (r) =>
        heldout.has(r.tenantId) && r.observedAt >= options.validationBefore,
    ),
  );
  const stumps: { predicate: Predicate; stats: PatternMetrics }[] = [];
  for (const feature of FEATURE_NAMES) {
    const values = [
      ...new Set(
        training.flatMap((r) =>
          r.features[feature] === undefined ? [] : [r.features[feature]!],
        ),
      ),
    ].sort((a, b) => a - b);
    if (values.length < 2) continue;
    const cuts = new Set<number>();
    for (let q = 1; q <= 8; q++) {
      const index = Math.min(
        values.length - 2,
        Math.floor((q * values.length) / 9),
      );
      cuts.add((values[index]! + values[index + 1]!) / 2);
    }
    for (const value of cuts)
      for (const operator of ["gte", "lte"] as const) {
        const predicate = { feature, operator, value };
        const stats = metrics(training, [[predicate]]);
        if (stats.truePositives >= 10) stumps.push({ predicate, stats });
      }
  }
  const groupCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();
  const top = stumps
    .sort(
      (a, b) =>
        rank(b.stats) - rank(a.stats) ||
        JSON.stringify(a.predicate).localeCompare(JSON.stringify(b.predicate)),
    )
    .filter((s) => {
      const group = featureGroup(s.predicate.feature),
        g = groupCounts.get(group) ?? 0,
        f = featureCounts.get(s.predicate.feature) ?? 0;
      if (g >= 8 || f >= 4) return false;
      groupCounts.set(group, g + 1);
      featureCounts.set(s.predicate.feature, f + 1);
      return true;
    })
    .slice(0, 32);
  const candidates: {
    predicates: Predicate[];
    training: PatternMetrics;
    validation: PatternMetrics;
  }[] = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i]!.predicate,
        b = top[j]!.predicate;
      // A single endpoint, speed or mouse statistic cannot become a detector on its own.
      if (featureGroup(a.feature) === featureGroup(b.feature)) continue;
      const predicates = [a, b],
        stats = metrics(training, [predicates]);
      if (stats.truePositives < 20 || stats.precisionLower < 0.75) continue;
      const check = metrics(validation, [predicates]);
      if (check.truePositives >= 20 && check.precisionLower >= 0.8)
        candidates.push({ predicates, training: stats, validation: check });
    }
  candidates.sort(
    (a, b) =>
      rank(b.validation) - rank(a.validation) ||
      JSON.stringify(a.predicates).localeCompare(JSON.stringify(b.predicates)),
  );
  // Freeze selection before inspecting the held-out tenants. Test the entire union too.
  const coverage = new Set<string>();
  const selected = candidates
    .filter((candidate) => {
      const key = validation
        .flatMap((row, index) =>
          row.positive && matches(row.features, candidate.predicates)
            ? [index]
            : [],
        )
        .join(",");
      if (coverage.has(key)) return false;
      coverage.add(key);
      return true;
    })
    .slice(0, PATTERN_GATES.maxPatterns);
  const patterns = selected.map((p, i) => ({
    ...p,
    id: `pattern_${i + 1}`,
    holdout: metrics(holdout, [p.predicates]),
  }));
  const rules = patterns.map((p) => p.predicates);
  const combined = {
    training: metrics(training, rules),
    validation: metrics(validation, rules),
    holdout: metrics(holdout, rules),
  };
  const cohorts: PatternModel["cohorts"] = {};
  for (const cohort of [
    "standard",
    "accessibility",
    "privacy",
    "api",
    "unknown",
  ] as const) {
    const group = holdout.filter((r) => r.cohort === cohort);
    if (group.length) cohorts[cohort] = metrics(group, rules);
  }
  const usesBrowser = rules
    .flat()
    .some((p) => ["mouse", "interaction"].includes(featureGroup(p.feature)));
  const gates = {
    patternsFound: patterns.length > 0,
    trainingDiversity: combined.training.tenants >= PATTERN_GATES.minTenants,
    validationDiversity:
      combined.validation.tenants >= PATTERN_GATES.minTenants,
    unseenApplications: combined.holdout.tenants >= PATTERN_GATES.minTenants,
    support: Object.values(combined).every(
      (m) =>
        m.positives >= PATTERN_GATES.minPositives &&
        m.negatives >= PATTERN_GATES.minNegatives,
    ),
    precision: combined.holdout.precisionLower >= PATTERN_GATES.precisionLower,
    falsePositives:
      combined.holdout.falsePositiveUpper <= PATTERN_GATES.falsePositiveUpper,
    individualTenants: [...heldout].every((tenant) => {
      const m = metrics(
        holdout.filter((r) => r.tenantId === tenant),
        rules,
      );
      return (
        m.negatives >= 30 &&
        (m.falsePositiveRate ?? 1) <= PATTERN_GATES.falsePositiveUpper
      );
    }),
    browserCohorts:
      !usesBrowser ||
      ["privacy", "accessibility"].every((c) => {
        const m = cohorts[c as Cohort];
        return !!m && m.negatives >= 30 && (m.falsePositiveRate ?? 1) <= 0.02;
      }),
    cohortFalsePositives: Object.values(cohorts).every(
      (m) => m.negatives === 0 || (m.falsePositiveRate ?? 1) <= 0.02,
    ),
  };
  return {
    version: 1,
    id: `model_${crypto.randomUUID().replaceAll("-", "")}`,
    target: options.target,
    createdAt: now,
    expiresAt: Math.min(now + 7 * 86_400_000, ...valid.map((r) => r.expiresAt)),
    datasetRevision: options.datasetRevision,
    sampleCount: training.length + validation.length + holdout.length,
    sampled:
      valid.length > training.length + validation.length + holdout.length,
    holdoutTenants: [...options.holdoutTenants].sort(),
    trainingBefore: options.trainingBefore,
    validationBefore: options.validationBefore,
    patterns,
    metrics: combined,
    cohorts,
    gates,
    eligible: Object.values(gates).every(Boolean),
  };
}

export function matchPatterns(
  model: PatternModel,
  input: FeatureVector,
  now = Date.now(),
): PatternEvidence[] {
  const features = parseFeatures(input);
  if (model.expiresAt <= now) return [];
  return model.patterns
    .filter((p) => matches(features, p.predicates))
    .map((p) => ({
      patternId: p.id,
      target: model.target,
      predicates: p.predicates,
      holdoutPrecision: p.holdout.precision,
      holdoutFalsePositiveRate: p.holdout.falsePositiveRate,
      support: p.holdout.truePositives + p.holdout.falsePositives,
    }));
}
