import { createClassifierDataset } from "../../packages/network/src/classifier-data.js";
import { CLASSIFIER_FEATURE_VERSION } from "../../packages/network/src/classifier-schema.js";
import type {
  ClassifierEnrichment,
  ClassifierRow,
} from "../../packages/network/src/classifier-schema.js";
import { CLASSIFIER_JEV_MODEL } from "../../packages/network/src/classifier-jev.js";
export async function classifierFixture(now = Date.now()) {
  const tenant = (i: number) => "tenant_" + i.toString(16).padStart(32, "0");
  const split = {
    target: "assistant" as const,
    trainingBefore: now - 3 * 86400000,
    calibrationBefore: now - 2 * 86400000,
    validationBefore: now - 86400000,
    holdoutTenants: [4, 5, 6].map(tenant),
  };
  let seed = 2184;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rows: ClassifierRow[] = [];
  for (let t = 1; t <= 6; t++)
    for (let i = 0; i < (t <= 3 ? 600 : 400); i++) {
      const positive = i % 4 === 0,
        stage = t > 3 ? 3 : Math.floor(i / 200);
      const index = t * 1000 + i,
        reference = index.toString(16).padStart(64, "0");
      const regular = positive || i % 4 === 1,
        repetitive = positive || i % 4 === 2;
      // Ground truth belongs to the generated scenario. Jev mocks below see features only.
      const observedAt = now - (4 - stage) * 86400000 + 3600000 + i * 1000;
      rows.push({
        version: 1,
        tenantId: tenant(t),
        sampleId: "sample_" + index.toString(16).padStart(32, "0"),
        sessionReference: "ref_" + reference,
        observedAt,
        confirmedAt: observedAt + 100,
        expiresAt: now + 7 * 86400000,
        trainingAllowed: true,
        target: "assistant",
        positive,
        source: positive ? "verified-delegation" : "reviewed-session",
        evidenceReference: "ref_" + reference,
        cohort: ["standard", "privacy", "accessibility", "api"][
          Math.floor(i / 4) % 4
        ] as ClassifierRow["cohort"],
        features: {
          api_request_count: Math.round(30 + random() * 20),
          api_gap_cv: regular ? 0.05 + random() * 0.1 : 1 + random(),
          api_sequence_repeat_ratio: repetitive
            ? 0.8 + random() * 0.2
            : random() * 0.2,
          route_telemetry_share: repetitive
            ? 0.3 + random() * 0.1
            : random() * 0.1,
          api_denied_ratio: random() * 0.01,
          api_error_ratio: random() * 0.05,
        },
      });
    }
  const dataset = await createClassifierDataset(rows, split, {
    origin: "synthetic",
    revision: 0,
    now,
  });
  const enrichment: ClassifierEnrichment = {
    version: 1,
    datasetDigest: dataset.manifest.digest,
    questionVersion: CLASSIFIER_FEATURE_VERSION,
    providerModel: CLASSIFIER_JEV_MODEL,
    synthetic: true,
    rows: dataset.rows.map((r) => ({
      tenantId: r.tenantId,
      sampleId: r.sampleId,
      values: {
        jev_regular_timing: 1 / (1 + (r.features.api_gap_cv ?? 1)),
        jev_repeated_workflow: r.features.api_sequence_repeat_ratio ?? 0,
        jev_mechanical_input: 0,
        jev_abuse_evidence: r.features.api_denied_ratio ?? 0,
      },
    })),
  };
  return { dataset, enrichment };
}
