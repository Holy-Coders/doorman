import { z } from "zod";
import {
  OPERATOR_FEATURE_NAMES,
  OPERATOR_LIMITS,
  hasOperatorEvidence,
} from "@aarondovturkel/doorman-core";
import type { AgentFamilyReference, OperatorEvidence } from "@aarondovturkel/doorman-core";
import { featureSchema, parseFeatures } from "./schema.js";

/** Independent test-harness labels. Login, model predictions and self-declared user agents are not labels. */
export const operatorStudySchema = z
  .array(
    z.strictObject({
      runId: z.string().min(1).max(128),
      task: z.string().min(1).max(128),
      split: z.enum(["train", "holdout"]),
      observedAt: z.number().int().nonnegative(),
      labelSource: z.literal("controlled-run"),
      trainingAllowed: z.boolean(),
      kind: z.enum(["human", "assistant", "automation"]),
      family: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
        .optional(),
      evidence: z.strictObject({
        source: z.enum(["browser", "server", "mixed"]),
        features: featureSchema,
      }),
    }),
  )
  .max(10_000);
export type OperatorStudyRow = z.infer<typeof operatorStudySchema>[number];
/** Select diverse measured examples for Jev's state. This is reference fitting, not model fine-tuning.
 * Held-out rows and duplicate runs are excluded. Labels and run IDs never enter reference features.
 */
export function buildAgentFamilyReferences(
  input: unknown,
  options: { version: string; fittedAt: number; expiresAt: number },
) {
  const rows = operatorStudySchema.parse(input);
  if (
    !/^[a-zA-Z0-9._-]{1,64}$/.test(options.version) ||
    !Number.isSafeInteger(options.fittedAt) ||
    !Number.isSafeInteger(options.expiresAt) ||
    options.expiresAt <= options.fittedAt ||
    options.expiresAt - options.fittedAt > 90 * 86_400_000
  )
    throw new Error("Invalid reference version or expiry");
  const runs = new Map<string, OperatorStudyRow>();
  for (const row of rows) {
    const previous = runs.get(row.runId);
    if (previous)
      throw new Error(
        "Each controlled run must occur once, including across data splits",
      );
    runs.set(row.runId, row);
  }
  const groups = new Map<string, OperatorEvidence[]>();
  const tasks = new Map<string, Set<string>>();
  for (const row of [...rows].sort(
    (a, b) => a.observedAt - b.observedAt || a.runId.localeCompare(b.runId),
  )) {
    if (
      row.split !== "train" ||
      !row.trainingAllowed ||
      row.observedAt > options.fittedAt ||
      row.kind !== "assistant" ||
      !row.family
    )
      continue;
    const evidence = {
      source: row.evidence.source,
      features: parseFeatures(row.evidence.features),
    };
    if (!hasOperatorEvidence(evidence)) continue;
    const examples = groups.get(row.family) ?? [];
    examples.push(evidence);
    groups.set(row.family, examples);
    const set = tasks.get(row.family) ?? new Set<string>();
    set.add(row.task);
    tasks.set(row.family, set);
  }
  const distance = (a: OperatorEvidence, b: OperatorEvidence) => {
    const keys = OPERATOR_FEATURE_NAMES.filter(
      (k) => a.features[k] !== undefined && b.features[k] !== undefined,
    );
    return keys.length
      ? keys.reduce(
          (sum, k) =>
            sum +
            Math.abs(a.features[k]! - b.features[k]!) /
              Math.max(1, a.features[k]!, b.features[k]!),
          0,
        ) / keys.length
      : 1;
  };
  const families: AgentFamilyReference[] = [];
  const excluded: string[] = [];
  for (const [family, examples] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (examples.length < 3 || tasks.get(family)!.size < 2) {
      excluded.push(family);
      continue;
    }
    // Deterministic farthest-first selection, bounded to five independently labeled runs.
    const remaining = [...examples],
      selected = [remaining.shift()!];
    while (
      remaining.length &&
      selected.length < OPERATOR_LIMITS.familyExamples
    ) {
      let index = 0,
        best = -1;
      remaining.forEach((e, i) => {
        const d = Math.min(...selected.map((s) => distance(e, s)));
        if (d > best) {
          index = i;
          best = d;
        }
      });
      selected.push(remaining.splice(index, 1)[0]!);
    }
    families.push({
      family,
      version: options.version,
      source: "controlled-study",
      expiresAt: options.expiresAt,
      examples: selected,
    });
  }
  if (families.length > OPERATOR_LIMITS.families)
    throw new Error(
      "Choose at most six known agent families per reference set",
    );
  return {
    families,
    excluded,
    scoreKind: "uncalibrated" as const,
    fittedAt: options.fittedAt,
  };
}
