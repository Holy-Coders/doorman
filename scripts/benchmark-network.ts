import { mkdir, writeFile } from "node:fs/promises";
import {
  discoverPatterns,
  matchPatterns,
} from "../packages/network/src/discovery.js";
import { discoveryFixture } from "../tests/helpers/network.js";
const { rows, options } = discoveryFixture();
const start = performance.now();
const model = discoverPatterns(rows, options);
const discoveryMs = performance.now() - start;
const holdout = rows.filter((r) => options.holdoutTenants.includes(r.tenantId));
const negatives = holdout.filter((r) => !r.positive);
const naiveFalsePositives = negatives.filter(
  (r) => (r.features.api_gap_cv ?? 10) < 0.5,
).length;
const spoofed = structuredClone(rows);
for (const row of spoofed)
  if (options.holdoutTenants.includes(row.tenantId) && !row.positive)
    row.features = {
      route_telemetry_share: 0.5,
      api_gap_cv: 0.1,
      api_request_count: 20,
    };
const adversarial = discoverPatterns(spoofed, options);
const report = {
  dataset:
    "synthetic controlled fixtures; not real users or measured production accuracy",
  rows: rows.length,
  discoveryMs,
  matchedRules: model.patterns.map((p) => p.predicates),
  heldout: model.metrics.holdout,
  eligible: model.eligible,
  timingOnlyBaselineFalsePositiveRate: naiveFalsePositives / negatives.length,
  spoofedHumanHoldout: {
    eligible: adversarial.eligible,
    falsePositiveRate: adversarial.metrics.holdout.falsePositiveRate,
  },
  missingSignalsMatchCount: matchPatterns(model, {}).length,
  limitation:
    "A mimic with the same observed features cannot be distinguished by these features. No live provider calls, no learned identity or authorization.",
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/network-discovery-benchmark.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
