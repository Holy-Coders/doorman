import { it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifierFixture } from "../scripts/classifier/fixture.js";
import {
  trainClassifier,
  enrichDataset,
  read,
} from "../scripts/classifier/operations.js";
import {
  createClassifierDataset,
  partitionOf,
} from "../packages/network/src/classifier-data.js";
import { CLASSIFIER_FEATURE_VERSION } from "../packages/network/src/classifier-schema.js";
const available =
  !!process.env.CLASSIFIER_PYTHON ||
  existsSync("tools/classifier/.venv/bin/python");
it.skipIf(!available)(
  "trains four native candidates with exact serving parity and no test-label leakage",
  async () => {
    const { dataset, enrichment } = await classifierFixture();
    const result = await trainClassifier(dataset, enrichment);
    expect(result.training.candidates).toHaveLength(4);
    expect(result.model.eligible).toBe(false);
    const rows = dataset.rows.map((r) =>
      partitionOf(r, dataset.manifest.split, dataset.manifest.createdAt) ===
      "holdout"
        ? { ...r, positive: !r.positive, source: "reviewed-session" as const }
        : r,
    );
    const changed = await createClassifierDataset(
      rows,
      dataset.manifest.split,
      { origin: "synthetic", revision: 0, now: dataset.manifest.createdAt },
    );
    const retrained = await trainClassifier(changed, {
      ...enrichment,
      datasetDigest: changed.manifest.digest,
    });
    expect(retrained.training.candidates).toEqual(result.training.candidates);
    expect(retrained.model.selected).toEqual(result.model.selected);
    expect(retrained.model.threshold).toBe(result.model.threshold);
    expect(retrained.model.metrics.holdout.brier).toBeGreaterThan(0.9);
  },
  120000,
);
it("reserves paid attempts before calls, resumes caches and honors a cumulative zero budget", async () => {
  const { dataset: fixture, enrichment } = await classifierFixture();
  const dataset = await createClassifierDataset(
    fixture.rows.slice(0, 3),
    fixture.manifest.split,
    { origin: "observed", revision: 0, now: fixture.manifest.createdAt },
  );
  const directory = await mkdtemp(join(tmpdir(), "doorman-budget-test-")),
    path = join(directory, "cache.json");
  const provider = vi.fn(async () => ({
    version: CLASSIFIER_FEATURE_VERSION,
    providerModel: "jev-1.13.0",
    values: enrichment.rows[0]!.values,
  }));
  try {
    expect(
      (await enrichDataset(dataset, path, "jev-1.13.0", 0, provider)).attempts,
    ).toBe(0);
    expect(provider).not.toHaveBeenCalled();
    await enrichDataset(dataset, path, "jev-1.13.0", 1, provider);
    expect(provider).toHaveBeenCalledTimes(1);
    await enrichDataset(dataset, path, "jev-1.13.0", 1, provider);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const failed = vi.fn(async () => {
      throw new Error("rate limit");
    });
    await expect(
      enrichDataset(dataset, path, "jev-1.13.0", 2, failed),
    ).rejects.toThrow("rate limit");
    expect(await read(path + ".budget.json")).toMatchObject({ attempts: 2 });
    await enrichDataset(dataset, path, "jev-1.13.0", 2, provider);
    expect(provider).toHaveBeenCalledTimes(1);
    await expect(
      enrichDataset(fixture, path, "jev-1.13.0", 2, provider),
    ).rejects.toThrow("generated");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
