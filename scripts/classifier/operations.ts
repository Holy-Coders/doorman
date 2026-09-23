import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  mkdtemp,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  CLASSIFIER_FEATURE_NAMES,
  CLASSIFIER_FEATURE_VERSION,
  classifierEnrichmentSchema,
  classifierTrainingSchema,
} from "../../packages/network/src/classifier-schema.js";
import type {
  ClassifierDataset,
  ClassifierEnrichment,
} from "../../packages/network/src/classifier-schema.js";
import {
  canonicalJSON,
  validateClassifierDataset,
} from "../../packages/network/src/classifier-data.js";
import {
  enrichmentMap,
  finalizeClassifier,
} from "../../packages/network/src/classifier-evaluation.js";
import { scoreClassifier } from "../../packages/network/src/classifier.js";
import { digest } from "../../packages/network/src/http.js";
import type { ClassifierFeatureEvaluator } from "../../packages/network/src/classifier-jev.js";
export const read = async (path: string): Promise<unknown> => {
  if ((await stat(path)).size > 16 * 1024 * 1024)
    throw new Error("Artifact exceeds 16 MiB");
  return JSON.parse(await readFile(path, "utf8"));
};
export async function writePrivate(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + crypto.randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
export async function trainClassifier(
  datasetInput: unknown,
  enrichmentInput?: unknown,
  python = process.env.CLASSIFIER_PYTHON ?? "tools/classifier/.venv/bin/python",
) {
  const dataset = await validateClassifierDataset(datasetInput);
  const enrichment =
    enrichmentInput === undefined
      ? undefined
      : classifierEnrichmentSchema.parse(enrichmentInput);
  const jev = enrichmentMap(dataset, enrichment);
  const temporary = await mkdtemp(resolve(tmpdir(), "janitor-train-"));
  try {
    const input = resolve(temporary, "input.json"),
      output = resolve(temporary, "output.json");
    await writePrivate(input, {
      dataset,
      enrichment,
      featureNames: CLASSIFIER_FEATURE_NAMES,
    });
    await promisify(execFile)(
      python.includes("/") ? resolve(python) : python,
      [resolve("tools/classifier/train.py"), input, output],
      { timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    const native = z
      .strictObject({
        training: classifierTrainingSchema,
        parity: z.array(
          z.strictObject({
            name: z.string(),
            scores: z.array(z.number().min(0).max(1)),
          }),
        ),
      })
      .parse(await read(output));
    for (const candidate of native.training.candidates) {
      const expected = native.parity.find(
        (p) => p.name === candidate.name,
      )?.scores;
      if (!expected || expected.length !== dataset.rows.length)
        throw new Error("Missing native parity predictions");
      dataset.rows.forEach((row, i) => {
        const score = scoreClassifier(
          candidate,
          row.features,
          candidate.mode === "jev"
            ? jev.get(row.tenantId + ":" + row.sampleId)
            : undefined,
        );
        if (score !== null && Math.abs(score - expected[i]!) > 1e-7)
          throw new Error("Python/TypeScript prediction mismatch");
      });
    }
    return {
      model: await finalizeClassifier(dataset, native.training, enrichment),
      training: native.training,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
/** Explicit paid action only: caller supplies a cumulative call cap. Reservations survive failure. */
export async function enrichDataset(
  dataset: ClassifierDataset,
  path: string,
  model: string,
  maximum: number,
  evaluate: ClassifierFeatureEvaluator,
) {
  await validateClassifierDataset(dataset);
  if (dataset.manifest.origin !== "observed")
    throw new Error("Do not spend inference budget on generated fixtures");
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 10000)
    throw new Error("Set a call cap between 0 and 10000");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = path + ".lock";
  await mkdir(lock, { mode: 0o700 });
  try {
    let cache: ClassifierEnrichment = {
      version: 1,
      datasetDigest: dataset.manifest.digest,
      questionVersion: CLASSIFIER_FEATURE_VERSION,
      providerModel: model,
      synthetic: false,
      rows: [],
    };
    try {
      cache = classifierEnrichmentSchema.parse(await read(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (
      cache.datasetDigest !== dataset.manifest.digest ||
      cache.providerModel !== model ||
      cache.synthetic
    )
      throw new Error("Feature cache version mismatch");
    const ledgerPath = path + ".budget.json";
    let ledger = {
      digest: dataset.manifest.digest,
      providerModel: model,
      questionVersion: CLASSIFIER_FEATURE_VERSION as string,
      attempts: 0,
    };
    try {
      ledger = z
        .strictObject({
          digest: z.string(),
          providerModel: z.string(),
          questionVersion: z.string(),
          attempts: z.number().int().min(0),
        })
        .parse(await read(ledgerPath));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (
      ledger.digest !== cache.datasetDigest ||
      ledger.providerModel !== model ||
      ledger.questionVersion !== CLASSIFIER_FEATURE_VERSION
    )
      throw new Error("Budget ledger version mismatch");
    const pending = new Map(
      dataset.rows.map((r) => [r.tenantId + ":" + r.sampleId, r]),
    );
    const reused = new Map<
      string,
      ClassifierEnrichment["rows"][number]["values"]
    >();
    for (const row of cache.rows) {
      const source = pending.get(row.tenantId + ":" + row.sampleId);
      if (!source) throw new Error("Invalid cached row");
      pending.delete(row.tenantId + ":" + row.sampleId);
      reused.set(await digest(canonicalJSON(source.features)), row.values);
    }
    for (const row of pending.values()) {
      const fingerprint = await digest(canonicalJSON(row.features));
      let values = reused.get(fingerprint);
      if (!values) {
        if (ledger.attempts >= maximum) break;
        ledger.attempts++;
        await writePrivate(ledgerPath, ledger);
        const result = await evaluate(row.features);
        if (
          result.providerModel !== model ||
          result.version !== CLASSIFIER_FEATURE_VERSION
        )
          throw new Error("Provider version changed");
        values = result.values;
        reused.set(fingerprint, values);
      }
      cache.rows.push({
        tenantId: row.tenantId,
        sampleId: row.sampleId,
        values,
      });
      cache = classifierEnrichmentSchema.parse(cache);
      await writePrivate(path, cache);
    }
    await writePrivate(path, cache);
    return {
      completed: cache.rows.length,
      total: dataset.rows.length,
      attempts: ledger.attempts,
    };
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
