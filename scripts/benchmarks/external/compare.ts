import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { digest } from "./io.js";

// Only aggregate reports are public. No sessions, raw traces, model weights or provider answers.
const root = resolve("artifacts/external");
const read = async (name: string) =>
  JSON.parse(await readFile(resolve(root, name), "utf8"));
const reports = await Promise.all(
  [
    "fpstalker-aggregate.json",
    "fpagent-aggregate.json",
    "fpagent-extended-aggregate.json",
    "balabit-aggregate.json",
    "balabit-extended-aggregate.json",
    "jev-pilot-report.json",
  ].map(read),
);
const [identity, baseline, extended, ownerBaseline, ownerExtended, jev] =
  reports;
if (
  baseline.result.sessions !== extended.result.sessions ||
  baseline.result.folds.length !== extended.result.folds.length
)
  throw new Error("Comparison cohorts differ");
for (let i = 0; i < baseline.result.folds.length; i++) {
  const a = baseline.result.folds[i],
    b = extended.result.folds[i];
  if (
    a.heldoutAgent !== b.heldoutAgent ||
    JSON.stringify(a.partitions) !== JSON.stringify(b.partitions)
  )
    throw new Error("Comparison folds differ");
}
const files = [
  "packages/browser/src/behavior.ts",
  "packages/network/src/features.ts",
  "scripts/benchmarks/external/behavior.ts",
  "tools/benchmarks/evaluate.py",
  "tools/benchmarks/prepare.py",
  "tools/classifier/train.py",
];
const sourceDigests = Object.fromEntries(
  await Promise.all(
    files.map(async (path) => [path, await digest(resolve(path))]),
  ),
);
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  comparison:
    "behavior-v1 versus behavior-v2 on the same published groups and splits",
  sourceDigests,
  productionPromoted: false,
  freshJevCalls: jev.newCalls,
  limitations: [
    "Previously inspected research splits, not a fresh independent validation cohort",
    "Validation chooses model and cutoff, never test outcomes; abstentions remain in recall denominators",
    "The same held-out human sessions recur across family folds; do not pool as independent samples",
    "No unique-operator counting, malicious intent, brand classification or current production accuracy validation",
    "Jev replay uses old five-feature questions and cached provider responses, not the new operator prompt or new features",
    "No raw research data or research-trained models are redistributed",
  ],
  identity,
  agents: { baseline, extended },
  ownerBehavior: { baseline: ownerBaseline, extended: ownerExtended },
  jevReplay: jev,
};
await mkdir("docs/benchmarks", { recursive: true });
const path = "docs/benchmarks/detection-v2-2026-09-23.json";
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(path);
