import { describe, it, expect, vi, afterEach } from "vitest";
import { classifierFixture } from "../scripts/classifier/fixture.js";
import {
  createClassifierDataset,
  validateClassifierDataset,
  partitionOf,
  sealClassifierManifest,
} from "../packages/network/src/classifier-data.js";
import {
  finalizeClassifier,
  validateClassifierReport,
  enrichmentMap,
} from "../packages/network/src/classifier-evaluation.js";
import {
  createClassifierPredictor,
  scoreClassifier,
} from "../packages/network/src/classifier.js";
import {
  CLASSIFIER_FEATURE_VERSION,
  classifierTrainingSchema,
} from "../packages/network/src/classifier-schema.js";
import {
  createClassifierJevMethods,
  createClassifierJevEvaluator,
  createWorkersClassifierEvaluator,
  CLASSIFIER_JEV_MODEL,
  CLASSIFIER_QUESTIONS,
} from "../packages/network/src/classifier-jev.js";
import type { ClassifierCandidate } from "../packages/network/src/classifier-schema.js";
import { createNetworkClient } from "../packages/network/src/client.js";
import { candidate, simpleModel } from "./helpers/classifier.js";
afterEach(() => vi.unstubAllGlobals());
describe("independent classifier evidence", () => {
  it("uses chronological windows and later disjoint applications", async () => {
    const { dataset } = await classifierFixture();
    expect(dataset.manifest.partitions).toEqual({
      training: { positives: 150, negatives: 450, tenants: 3 },
      calibration: { positives: 150, negatives: 450, tenants: 3 },
      validation: { positives: 150, negatives: 450, tenants: 3 },
      holdout: { positives: 300, negatives: 900, tenants: 3 },
    });
    const row = dataset.rows.find(
      (r) =>
        partitionOf(r, dataset.manifest.split, dataset.manifest.createdAt) ===
        "training",
    )!;
    expect(
      partitionOf(
        { ...row, confirmedAt: dataset.manifest.split.trainingBefore },
        dataset.manifest.split,
        dataset.manifest.createdAt,
      ),
    ).toBeUndefined();
    expect(
      partitionOf(
        { ...row, tenantId: dataset.manifest.split.holdoutTenants[0]! },
        dataset.manifest.split,
        dataset.manifest.createdAt,
      ),
    ).toBeUndefined();
    await expect(validateClassifierDataset(dataset)).resolves.toEqual(dataset);
  });
  it("rejects changed digests, raw fields, duplicate sessions and unsupported outcome provenance", async () => {
    const { dataset } = await classifierFixture();
    const changed = structuredClone(dataset);
    changed.rows[0]!.positive = !changed.rows[0]!.positive;
    await expect(validateClassifierDataset(changed)).rejects.toThrow();
    const raw = structuredClone(dataset) as unknown as {
      rows: { features: Record<string, unknown> }[];
    };
    raw.rows[0]!.features.email = "person@example.test";
    await expect(validateClassifierDataset(raw)).rejects.toThrow();
    const row = dataset.rows[0]!;
    await expect(
      createClassifierDataset(
        [row, { ...row, sampleId: "sample_" + "a".repeat(32) }],
        dataset.manifest.split,
        { revision: 0, origin: "observed" },
      ),
    ).rejects.toThrow("Duplicate");
    await expect(
      createClassifierDataset(
        [{ ...row, positive: false, source: "verified-delegation" }],
        dataset.manifest.split,
        { revision: 0, origin: "observed" },
      ),
    ).rejects.toThrow("provenance");
  });
  it("deduplicates outcome evidence and removes conflicts rather than manufacturing labels", async () => {
    const { dataset } = await classifierFixture(),
      row = dataset.rows[0]!;
    const twin = {
      ...row,
      sampleId: "sample_" + "f".repeat(32),
      sessionReference: "ref_" + "f".repeat(64),
    };
    const options = { revision: 0, origin: "observed" as const };
    expect(
      (
        await createClassifierDataset(
          [row, twin],
          dataset.manifest.split,
          options,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await createClassifierDataset(
          [
            row,
            { ...twin, positive: !row.positive, source: "reviewed-session" },
          ],
          dataset.manifest.split,
          options,
        )
      ).rows,
    ).toHaveLength(0);
    const seal = await sealClassifierManifest(dataset.manifest, "a".repeat(64));
    expect(
      await sealClassifierManifest(
        { ...dataset.manifest, origin: "observed" },
        "a".repeat(64),
      ),
    ).not.toBe(seal);
  });
  it("does not use final test labels for model or threshold selection", async () => {
    const { dataset } = await classifierFixture();
    const first = await simpleModel(dataset);
    const rows = dataset.rows.map((r) =>
      partitionOf(r, dataset.manifest.split, dataset.manifest.createdAt) ===
      "holdout"
        ? { ...r, positive: !r.positive, source: "reviewed-session" as const }
        : r,
    );
    const other = await createClassifierDataset(rows, dataset.manifest.split, {
      origin: "synthetic",
      revision: 0,
      now: dataset.manifest.createdAt,
    });
    const second = await simpleModel(other);
    expect(second.selected).toEqual(first.selected);
    expect(second.threshold).toBe(first.threshold);
    expect(second.metrics.holdout.brier).toBeGreaterThan(
      first.metrics.holdout.brier!,
    );
    expect(first.eligible).toBe(false);
    expect(first.gates.observedData).toBe(false);
  });
  it("abstains on missing signals, expired models and model-version drift", async () => {
    const { dataset, enrichment } = await classifierFixture(),
      model = await simpleModel(dataset),
      predictor = createClassifierPredictor(model);
    expect(predictor.predict({}).reason).toBe("missing-evidence");
    expect(
      predictor.predict(
        dataset.rows[0]!.features,
        undefined,
        model.manifest.expiresAt,
      ).reason,
    ).toBe("expired");
    const enriched: ClassifierCandidate = {
      ...candidate,
      name: "jev-logistic",
      mode: "jev",
      parameters: {
        ...candidate.parameters,
        columns: [
          candidate.parameters.columns[0]!,
          { name: "jev_repeated_workflow", mean: 0, scale: 1 },
        ],
      },
    };
    const jevModel = await finalizeClassifier(
      dataset,
      {
        version: 1,
        datasetDigest: dataset.manifest.digest,
        trainerVersion: "test",
        candidates: [enriched],
      },
      enrichment,
    );
    const result = createClassifierPredictor(jevModel).predict(
      dataset.rows[0]!.features,
      {
        version: CLASSIFIER_FEATURE_VERSION,
        providerModel: "jev-0.0.0",
        values: enrichment.rows[0]!.values,
      },
    );
    expect(result).toEqual({ score: null, reason: "jev-unavailable" });
  });
  it("rejects partial enrichment, forged gates and executable/unbounded artifacts", async () => {
    const { dataset, enrichment } = await classifierFixture();
    expect(() =>
      enrichmentMap(dataset, { ...enrichment, rows: enrichment.rows.slice(1) }),
    ).toThrow("Complete");
    const model = await simpleModel(dataset);
    model.eligible = true;
    expect(() => validateClassifierReport(model)).toThrow("gates");
    expect(() =>
      classifierTrainingSchema.parse({
        version: 1,
        datasetDigest: dataset.manifest.digest,
        trainerVersion: "test",
        candidates: [{ ...candidate, code: "eval()" }],
      }),
    ).toThrow();
  });
  it("uses float32 tree boundaries and bit-ordered leaves", () => {
    const tree: ClassifierCandidate = {
      ...candidate,
      name: "telemetry-boosted-trees",
      parameters: {
        ...candidate.parameters,
        estimator: {
          kind: "boosted-trees",
          scale: 1,
          bias: 0,
          trees: [
            {
              splits: [
                { column: 0, border: 1 },
                { column: 1, border: 0.5 },
              ],
              leaves: [-3, -1, 1, 3],
            },
          ],
        },
      },
    };
    expect(
      scoreClassifier(tree, {
        api_gap_cv: 1 + 1e-9,
        api_sequence_repeat_ratio: 0.8,
      }),
    ).toBeCloseTo(1 / (1 + Math.exp(-1)));
    expect(
      scoreClassifier(tree, {
        api_gap_cv: 1.1,
        api_sequence_repeat_ratio: 0.8,
      }),
    ).toBeCloseTo(1 / (1 + Math.exp(-3)));
  });
});
const answer = () => ({
  model: CLASSIFIER_JEV_MODEL,
  answers: Object.fromEntries(
    Object.keys(CLASSIFIER_QUESTIONS).map((k) => [
      k,
      { type: "noul", noul: 0.25 },
    ]),
  ),
});
describe("Jev feature transport", () => {
  it("sends only allowlisted measurements and four versioned typed questions", async () => {
    const transport = vi.fn(async () => answer());
    expect(
      (await createClassifierJevMethods(transport)({ api_request_count: 10 }))
        .values.jev_regular_timing,
    ).toBe(0.25);
    expect(transport.mock.calls[0]).toEqual([
      {
        state: { features: { api_request_count: 10 } },
        questions: CLASSIFIER_QUESTIONS,
      },
    ]);
    const fetch = vi.fn(async () => Response.json(answer()));
    vi.stubGlobal("fetch", fetch);
    await createClassifierJevEvaluator({ apiKey: "test" })({ api_gap_cv: 0.1 });
    expect(
      JSON.parse(
        (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      ).model,
    ).toBe(CLASSIFIER_JEV_MODEL);
  });
  it("validates the Workers Completed envelope, exact model version and bounded outputs", async () => {
    await expect(
      createWorkersClassifierEvaluator({
        run: async () => ({ state: "Completed", result: answer() }),
      })({}),
    ).resolves.toHaveProperty("providerModel", CLASSIFIER_JEV_MODEL);
    await expect(
      createWorkersClassifierEvaluator({
        run: async () => ({ state: "Pending", result: answer() }),
      })({}),
    ).rejects.toThrow();
    await expect(
      createClassifierJevMethods(async () => ({
        ...answer(),
        model: "jev-latest",
      }))({}),
    ).rejects.toThrow();
    const bad = answer();
    bad.answers.jev_regular_timing!.noul = 2;
    await expect(
      createClassifierJevMethods(async () => bad)({}),
    ).rejects.toThrow();
  });
  it("client abstains on unavailable or malformed classification without exposing browser credentials", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));
    const client = createNetworkClient({
      endpoint: "https://network.test",
      apiKey: "a".repeat(32),
    });
    expect(await client.classify({})).toEqual({
      version: 1,
      status: "unavailable",
      cached: false,
      predictions: [],
    });
    vi.stubGlobal("fetch", async () =>
      Response.json({ status: "evaluated", predictions: [{ score: 2 }] }),
    );
    expect((await client.classify({})).status).toBe("unavailable");
  });
});
