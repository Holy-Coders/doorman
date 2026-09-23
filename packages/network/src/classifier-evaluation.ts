import {
  classifierEnrichmentSchema,
  classifierModelSchema,
  classifierTrainingSchema,
  PARTITIONS,
  CLASSIFIER_FEATURE_VERSION,
} from "./classifier-schema.js";
import type {
  ClassifierCandidate,
  ClassifierDataset,
  ClassifierEnrichment,
  ClassifierMetrics,
  ClassifierModel,
  ClassifierRow,
  JevFeatureResult,
} from "./classifier-schema.js";
import {
  canonicalJSON,
  partitionOf,
  validateClassifierDataset,
} from "./classifier-data.js";
import { CLASSIFIER_LIMITS as LIMIT, scoreClassifier } from "./classifier.js";
import { featureGroup } from "./schema.js";
import type { FeatureVector } from "./schema.js";
import { newId } from "./http.js";

const bounds = (yes: number, n: number): [number, number] => {
  if (!n) return [0, 1];
  const z2 = 1.96 ** 2,
    p = yes / n,
    spread = 1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [
    Math.max(0, (p + z2 / (2 * n) - spread) / (1 + z2 / n)),
    Math.min(1, (p + z2 / (2 * n) + spread) / (1 + z2 / n)),
  ];
};
export function classifierMetrics(
  rows: ClassifierRow[],
  scores: (number | null)[],
  threshold: number,
  prevalence: number,
): ClassifierMetrics {
  let positives = 0,
    negatives = 0,
    scored = 0,
    tp = 0,
    fp = 0,
    brier = 0,
    loss = 0,
    baseline = 0;
  const bins = Array.from({ length: 10 }, () => ({
    count: 0,
    predicted: 0,
    observed: 0,
  }));
  rows.forEach((row, i) => {
    const y = Number(row.positive),
      score = scores[i];
    positives += y;
    negatives += 1 - y;
    if (score === null || score === undefined) return;
    scored++;
    tp += Number(score >= threshold && row.positive);
    fp += Number(score >= threshold && !row.positive);
    brier += (score - y) ** 2;
    baseline += (prevalence - y) ** 2;
    const p = Math.max(1e-15, Math.min(1 - 1e-15, score));
    loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    const bin = bins[Math.min(9, Math.floor(score * 10))]!;
    bin.count++;
    bin.predicted += score;
    bin.observed += y;
  });
  const reliability = bins
    .filter((b) => b.count)
    .map((b) => ({
      count: b.count,
      predicted: b.predicted / b.count,
      observed: b.observed / b.count,
    }));
  return {
    positives,
    negatives,
    tenants: new Set(rows.map((r) => r.tenantId)).size,
    scored,
    truePositives: tp,
    falsePositives: fp,
    coverage: rows.length ? scored / rows.length : 0,
    precision: tp + fp ? tp / (tp + fp) : null,
    precisionLower: bounds(tp, tp + fp)[0],
    falsePositiveRate: negatives ? fp / negatives : null,
    falsePositiveUpper: bounds(fp, negatives)[1],
    recall: positives ? tp / positives : null,
    brier: scored ? brier / scored : null,
    baselineBrier: scored ? baseline / scored : null,
    logLoss: scored ? loss / scored : null,
    calibrationError: scored
      ? reliability.reduce(
          (s, b) => s + b.count * Math.abs(b.predicted - b.observed),
          0,
        ) / scored
      : null,
    bins: reliability,
  };
}
export function classifierGates(
  model: ClassifierModel,
): Record<string, boolean> {
  const quality = (m: ClassifierMetrics) =>
    m.coverage >= LIMIT.minimumCoverage &&
    m.precisionLower >= LIMIT.precisionLower &&
    m.falsePositiveUpper <= LIMIT.falsePositiveUpper &&
    (m.recall ?? 0) >= LIMIT.minimumRecall;
  const groups = new Set(
    model.selected.parameters.columns.map((c) =>
      c.name.startsWith("jev_")
        ? "jev"
        : featureGroup(c.name as keyof FeatureVector),
    ),
  );
  const browser = groups.has("mouse") || groups.has("interaction");
  const holdout = model.metrics.holdout;
  return {
    observedData: model.manifest.origin === "observed",
    completeExport: !model.manifest.truncated && !model.manifest.sampled,
    independentEvidence: groups.size >= LIMIT.minimumGroups,
    sampleSupport: Object.values(model.metrics).every(
      (m) =>
        m.positives >= LIMIT.minimumPositives &&
        m.negatives >= LIMIT.minimumNegatives,
    ),
    applicationDiversity: Object.values(model.metrics).every(
      (m) => m.tenants >= LIMIT.minimumTenants,
    ),
    validationQuality: quality(model.metrics.validation),
    holdoutQuality: quality(holdout),
    calibration:
      (holdout.calibrationError ?? 1) <= LIMIT.maximumCalibrationError,
    beatsConstantBaseline:
      holdout.brier !== null &&
      holdout.baselineBrier !== null &&
      holdout.brier < holdout.baselineBrier,
    individualApplications: model.manifest.split.holdoutTenants.every((id) => {
      const m = model.tenants[id];
      return (
        !!m &&
        m.positives >= 30 &&
        m.negatives >= 30 &&
        m.coverage >= LIMIT.minimumCoverage &&
        (m.recall ?? 0) >= LIMIT.minimumRecall &&
        (m.falsePositiveRate ?? 1) <= LIMIT.falsePositiveUpper
      );
    }),
    cohortFalsePositives: Object.values(model.cohorts).every(
      (m) =>
        !m ||
        m.negatives === 0 ||
        (m.coverage >= LIMIT.minimumCoverage &&
          (m.falsePositiveRate ?? 1) <= LIMIT.falsePositiveUpper),
    ),
    browserCohorts:
      !browser ||
      ["privacy", "accessibility"].every((c) => {
        const m = model.cohorts[c as "privacy" | "accessibility"];
        return (
          !!m &&
          m.negatives >= 30 &&
          m.coverage >= LIMIT.minimumCoverage &&
          (m.falsePositiveRate ?? 1) <= LIMIT.falsePositiveUpper
        );
      }),
    matchingPartitionCounts: PARTITIONS.every((p) =>
      ["positives", "negatives", "tenants"].every(
        (k) =>
          model.metrics[p][k as "positives"] ===
          model.manifest.partitions[p][k as "positives"],
      ),
    ),
  };
}
export function validateClassifierReport(value: unknown): ClassifierModel {
  const model = classifierModelSchema.parse(value);
  for (const m of [
    ...model.comparison.map((c) => c.validation),
    ...Object.values(model.metrics),
    ...Object.values(model.tenants),
    ...Object.values(model.cohorts).filter((v): v is ClassifierMetrics => !!v),
  ]) {
    if (
      m.truePositives > m.positives ||
      m.falsePositives > m.negatives ||
      m.scored > m.positives + m.negatives ||
      m.truePositives + m.falsePositives > m.scored
    )
      throw new Error("Invalid confusion matrix");
    if (m.bins.reduce((sum, b) => sum + b.count, 0) !== m.scored)
      throw new Error("Inconsistent reliability bins");
    const error = m.scored
      ? m.bins.reduce(
          (sum, b) => sum + b.count * Math.abs(b.predicted - b.observed),
          0,
        ) / m.scored
      : null;
    if (
      error === null
        ? m.calibrationError !== null
        : m.calibrationError === null ||
          Math.abs(error - m.calibrationError) > 1e-8
    )
      throw new Error("Inconsistent calibration metrics");
    const expected = {
      precision:
        m.truePositives + m.falsePositives
          ? m.truePositives / (m.truePositives + m.falsePositives)
          : null,
      precisionLower: bounds(
        m.truePositives,
        m.truePositives + m.falsePositives,
      )[0],
      falsePositiveRate: m.negatives ? m.falsePositives / m.negatives : null,
      falsePositiveUpper: bounds(m.falsePositives, m.negatives)[1],
      recall: m.positives ? m.truePositives / m.positives : null,
      coverage:
        m.positives + m.negatives ? m.scored / (m.positives + m.negatives) : 0,
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      const a = expected[key],
        b = m[key];
      if (a === null ? b !== null : b === null || Math.abs(a - b) > 1e-8)
        throw new Error("Inconsistent model metrics");
    }
  }
  const counts = model.metrics.training;
  if (
    Math.abs(
      model.trainingPrevalence -
        counts.positives / (counts.positives + counts.negatives),
    ) > 1e-8
  )
    throw new Error("Invalid training prevalence");
  const selected = model.comparison.find((c) => c.name === model.selected.name);
  if (
    !selected ||
    selected.threshold !== model.threshold ||
    canonicalJSON(selected.validation) !==
      canonicalJSON(model.metrics.validation)
  )
    throw new Error("Invalid selection report");
  const gates = classifierGates(model);
  if (
    canonicalJSON(gates) !== canonicalJSON(model.gates) ||
    model.eligible !== Object.values(gates).every(Boolean)
  )
    throw new Error("Modified promotion gates");
  const hasJev = model.selected.parameters.columns.some((c) =>
    c.name.startsWith("jev_"),
  );
  if (hasJev !== (model.selected.mode === "jev"))
    throw new Error("Feature mode mismatch");
  return model;
}
export function enrichmentMap(
  dataset: ClassifierDataset,
  input?: ClassifierEnrichment,
) {
  const map = new Map<string, JevFeatureResult>();
  if (!input) return map;
  const data = classifierEnrichmentSchema.parse(input);
  if (
    data.datasetDigest !== dataset.manifest.digest ||
    (data.synthetic && dataset.manifest.origin !== "synthetic")
  )
    throw new Error("Wrong or synthetic feature cache");
  const keys = new Set(dataset.rows.map((r) => r.tenantId + ":" + r.sampleId));
  for (const r of data.rows) {
    const key = r.tenantId + ":" + r.sampleId;
    if (map.has(key) || !keys.has(key))
      throw new Error("Duplicate or unknown enrichment row");
    map.set(key, {
      version: CLASSIFIER_FEATURE_VERSION,
      providerModel: data.providerModel,
      values: r.values,
    });
  }
  if (map.size !== keys.size)
    throw new Error("Complete the feature cache before comparing candidates");
  return map;
}
export async function finalizeClassifier(
  datasetInput: ClassifierDataset,
  trainedInput: unknown,
  enrichment?: ClassifierEnrichment,
): Promise<ClassifierModel> {
  const dataset = await validateClassifierDataset(datasetInput),
    training = classifierTrainingSchema.parse(trainedInput);
  if (training.datasetDigest !== dataset.manifest.digest)
    throw new Error("Trainer used another dataset");
  const jev = enrichmentMap(dataset, enrichment),
    m = dataset.manifest;
  const partitions = Object.fromEntries(
    PARTITIONS.map((p) => [
      p,
      dataset.rows.filter((r) => partitionOf(r, m.split, m.createdAt) === p),
    ]),
  ) as Record<(typeof PARTITIONS)[number], ClassifierRow[]>;
  if (
    PARTITIONS.some(
      (p) =>
        !partitions[p].some((r) => r.positive) ||
        !partitions[p].some((r) => !r.positive),
    )
  )
    throw new Error(
      "Each partition needs independently labeled positive and negative sessions",
    );
  const prevalence =
    partitions.training.filter((r) => r.positive).length /
    partitions.training.length;
  const scores = (candidate: ClassifierCandidate, rows: ClassifierRow[]) =>
    rows.map((r) =>
      scoreClassifier(
        candidate,
        r.features,
        candidate.mode === "jev"
          ? jev.get(r.tenantId + ":" + r.sampleId)
          : undefined,
      ),
    );
  const trials = training.candidates.map((candidate) => {
    if (candidate.mode === "jev" && !enrichment)
      throw new Error("Missing Jev features");
    const predictions = scores(candidate, partitions.validation);
    const thresholds = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99, 1];
    let threshold = 1,
      stats = classifierMetrics(
        partitions.validation,
        predictions,
        1,
        prevalence,
      );
    for (const cut of thresholds) {
      const check = classifierMetrics(
        partitions.validation,
        predictions,
        cut,
        prevalence,
      );
      if (
        check.precisionLower >= LIMIT.precisionLower &&
        check.falsePositiveUpper <= LIMIT.falsePositiveUpper &&
        (check.recall ?? 0) > (stats.recall ?? 0)
      ) {
        threshold = cut;
        stats = check;
      }
    }
    return { candidate, threshold, stats };
  });
  // Only validation data chooses the family, Jev use and threshold. The test is untouched.
  const passes = (t: (typeof trials)[number]) =>
    t.stats.coverage >= LIMIT.minimumCoverage &&
    t.stats.precisionLower >= LIMIT.precisionLower &&
    t.stats.falsePositiveUpper <= LIMIT.falsePositiveUpper &&
    (t.stats.recall ?? 0) >= LIMIT.minimumRecall;
  trials.sort(
    (a, b) =>
      Number(passes(b)) - Number(passes(a)) ||
      (a.stats.brier ?? 1) - (b.stats.brier ?? 1) ||
      a.candidate.name.localeCompare(b.candidate.name),
  );
  const best = trials[0]!;
  // Prefer a cheaper/simpler family when the measured improvement is negligible.
  const complexity = (t: (typeof trials)[number]) =>
    Number(t.candidate.mode === "jev") * 2 +
    Number(t.candidate.parameters.estimator.kind === "boosted-trees");
  const winner = trials
    .filter(
      (t) =>
        passes(t) === passes(best) &&
        (t.stats.brier ?? 1) <=
          (best.stats.brier ?? 1) + LIMIT.minimumBrierImprovement,
    )
    .sort(
      (a, b) =>
        complexity(a) - complexity(b) ||
        (a.stats.brier ?? 1) - (b.stats.brier ?? 1),
    )[0]!;
  const report = (rows: ClassifierRow[]) =>
    classifierMetrics(
      rows,
      scores(winner.candidate, rows),
      winner.threshold,
      prevalence,
    );
  const cohorts = Object.fromEntries(
    ["standard", "accessibility", "privacy", "api", "unknown"]
      .map((c) => {
        const rows = partitions.holdout.filter((r) => r.cohort === c);
        return [c, rows.length ? report(rows) : undefined];
      })
      .filter(([, value]) => value !== undefined),
  ) as ClassifierModel["cohorts"];
  const model: ClassifierModel = {
    version: 1,
    id: newId("classifier"),
    manifest: m,
    trainerVersion: training.trainerVersion,
    selected: winner.candidate,
    ...(winner.candidate.mode === "jev"
      ? {
          jev: {
            version: CLASSIFIER_FEATURE_VERSION,
            providerModel: enrichment!.providerModel,
          },
        }
      : {}),
    threshold: winner.threshold,
    trainingPrevalence: prevalence,
    metrics: Object.fromEntries(
      PARTITIONS.map((p) => [p, report(partitions[p])]),
    ) as ClassifierModel["metrics"],
    cohorts,
    tenants: Object.fromEntries(
      m.split.holdoutTenants.map((id) => [
        id,
        report(partitions.holdout.filter((r) => r.tenantId === id)),
      ]),
    ),
    comparison: trials.map((t) => ({
      name: t.candidate.name,
      threshold: t.threshold,
      validation: t.stats,
    })),
    gates: {},
    eligible: false,
  };
  model.gates = classifierGates(model);
  model.eligible = Object.values(model.gates).every(Boolean);
  return validateClassifierReport(model);
}
