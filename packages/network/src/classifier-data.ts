import { digest, newId } from "./http.js";
import {
  classifierDatasetSchema,
  classifierManifestSchema,
  classifierRowSchema,
  classifierSplitSchema,
  PARTITIONS,
} from "./classifier-schema.js";
import type {
  ClassifierDataset,
  ClassifierManifest,
  ClassifierRow,
  ClassifierSplit,
  Partition,
} from "./classifier-schema.js";
import type { TrainingRow } from "./schema.js";

/** Stable JSON is used for integrity and cache identity, never as an executable format. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalJSON).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonicalJSON(v))
      .join(",") +
    "}"
  );
}
export function partitionOf(
  row: ClassifierRow,
  split: ClassifierSplit,
  now: number,
): Partition | undefined {
  if (
    row.target !== split.target ||
    !row.trainingAllowed ||
    row.expiresAt <= now ||
    row.confirmedAt > now ||
    row.observedAt > now
  )
    return;
  if (split.holdoutTenants.includes(row.tenantId))
    return row.observedAt >= split.validationBefore ? "holdout" : undefined;
  if (
    row.observedAt < split.trainingBefore &&
    row.confirmedAt < split.trainingBefore
  )
    return "training";
  if (
    row.observedAt >= split.trainingBefore &&
    row.observedAt < split.calibrationBefore &&
    row.confirmedAt < split.calibrationBefore
  )
    return "calibration";
  if (
    row.observedAt >= split.calibrationBefore &&
    row.observedAt < split.validationBefore &&
    row.confirmedAt < split.validationBefore
  )
    return "validation";
}
const summary = (rows: ClassifierRow[]) => ({
  positives: rows.filter((r) => r.positive).length,
  negatives: rows.filter((r) => !r.positive).length,
  tenants: new Set(rows.map((r) => r.tenantId)).size,
});
function content(manifest: ClassifierManifest, rows: ClassifierRow[]) {
  return canonicalJSON({
    origin: manifest.origin,
    createdAt: manifest.createdAt,
    revision: manifest.revision,
    split: manifest.split,
    rows,
  });
}
export async function createClassifierDataset(
  input: TrainingRow[],
  splitInput: ClassifierSplit,
  options: {
    revision: number;
    origin: "observed" | "synthetic";
    now?: number;
    sampled?: boolean;
    truncated?: boolean;
  },
): Promise<ClassifierDataset> {
  const split = classifierSplitSchema.parse(splitInput),
    now = options.now ?? Date.now();
  if (input.length > 10000 || now <= split.validationBefore)
    throw new Error("Invalid dataset size or time window");
  const parsed = input
    .map((r) => classifierRowSchema.parse(r))
    .sort(
      (a, b) =>
        a.observedAt - b.observedAt ||
        a.confirmedAt - b.confirmedAt ||
        a.sampleId.localeCompare(b.sampleId),
    );
  const sessions = new Set<string>(),
    ids = new Set<string>(),
    seenEvidence = new Set<string>();
  const conflicts = new Set<string>(),
    outcomes = new Map<string, boolean>();
  for (const r of parsed) {
    const key = r.tenantId + ":" + r.target + ":" + r.evidenceReference;
    if (outcomes.has(key) && outcomes.get(key) !== r.positive)
      conflicts.add(key);
    outcomes.set(key, r.positive);
  }
  const rows = parsed
    .filter((r) => {
      const id = r.tenantId + ":" + r.sampleId,
        session = r.tenantId + ":" + r.sessionReference;
      if (ids.has(id) || sessions.has(session))
        throw new Error("Duplicate sample or session in export");
      ids.add(id);
      sessions.add(session);
      const evidence = r.tenantId + ":" + r.target + ":" + r.evidenceReference;
      if (conflicts.has(evidence) || seenEvidence.has(evidence)) return false;
      seenEvidence.add(evidence);
      return !!partitionOf(r, split, now) && Object.keys(r.features).length > 0;
    })
    .sort(
      (a, b) =>
        a.tenantId.localeCompare(b.tenantId) ||
        a.sampleId.localeCompare(b.sampleId),
    );
  const partitions = Object.fromEntries(
    PARTITIONS.map((p) => [
      p,
      summary(rows.filter((r) => partitionOf(r, split, now) === p)),
    ]),
  ) as ClassifierManifest["partitions"];
  const manifest: ClassifierManifest = {
    version: 1,
    id: newId("dataset"),
    origin: options.origin,
    createdAt: now,
    expiresAt: Math.min(now + 7 * 86_400_000, ...rows.map((r) => r.expiresAt)),
    revision: options.revision,
    split,
    digest: "0".repeat(64),
    rows: rows.length,
    excluded: input.length - rows.length,
    sampled: options.sampled ?? false,
    truncated: options.truncated ?? false,
    partitions,
  };
  manifest.digest = await digest(content(manifest, rows));
  return classifierDatasetSchema.parse({ manifest, rows });
}
export async function validateClassifierDataset(
  value: unknown,
  now = Date.now(),
): Promise<ClassifierDataset> {
  const data = classifierDatasetSchema.parse(value),
    m = data.manifest;
  if (
    m.createdAt > now ||
    m.expiresAt <= now ||
    m.rows !== data.rows.length ||
    (await digest(content(m, data.rows))) !== m.digest
  )
    throw new Error("Expired or modified training dataset");
  const recreated = await createClassifierDataset(
    data.rows as TrainingRow[],
    m.split,
    {
      revision: m.revision,
      origin: m.origin,
      now: m.createdAt,
      sampled: m.sampled,
      truncated: m.truncated,
    },
  );
  if (
    recreated.manifest.digest !== m.digest ||
    canonicalJSON(recreated.manifest.partitions) !==
      canonicalJSON(m.partitions) ||
    m.expiresAt > recreated.manifest.expiresAt
  )
    throw new Error("Invalid dataset partitions or expiry");
  return data;
}
export async function sealClassifierManifest(
  manifest: ClassifierManifest,
  keyHash: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyHash),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      "janitor-classifier-export-v1:" +
        canonicalJSON(classifierManifestSchema.parse(manifest)),
    ),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
