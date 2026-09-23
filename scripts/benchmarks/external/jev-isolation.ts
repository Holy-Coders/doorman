/** Bounded live protocol regression; captured test browsers are not identity accuracy labels. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeObservation, calculateSimilarity } from "@janitor/core";
import type { BrowserObservation, BrowserBehavior } from "@janitor/core";
import {
  createJevInput,
  createRiskInput,
  type JevRequest,
} from "@janitor/evaluator-jev";
import { createCloudflareJevEvaluator } from "@janitor/evaluator-cloudflare-jev";
import { createPilotTransport, requestDigest } from "./jev-transport.js";
import { digest } from "./io.js";
const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    "max-calls": { type: "string", default: "0" },
  },
});
const maximum = Number(values["max-calls"]);
assert(
  Number.isInteger(maximum) && maximum >= 0 && maximum <= 16,
  "This experiment is capped at 16 calls",
);
const source = "artifacts/browser-benchmark/jev-cases.json";
const captures = JSON.parse(await readFile(source, "utf8")) as {
  engine: string;
  scenario: string;
  sample: { signals: BrowserObservation; behavior: BrowserBehavior };
}[];
const transport = await createPilotTransport({
  path: resolve("artifacts/external/jev-isolation-ledger.json"),
  maxCalls: maximum,
  live: values.live,
  token: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
});
// Research transport serializes actual calls to keep the persistent ledger single-writer.
// Production uses concurrent independent requests; this run does not measure production latency.
let tail: Promise<unknown> = Promise.resolve();
const calls: JevRequest[] = [];
const evaluator = createCloudflareJevEvaluator(
  {
    run: async (_, input) => {
      calls.push(input);
      const result = tail.then(() => transport.evaluate(input));
      tail = result.catch(() => {});
      return { state: "Completed", result: await result };
    },
  },
  { timeoutMs: 35000 },
);
const before = transport.summary().attempts;
const results = [];
try {
  for (const capture of captures.filter((c) => c.scenario === "baseline")) {
    const base = normalizeObservation(
      { ...capture.sample.signals, automation: { webdriver: false } },
      capture.sample.behavior,
    );
    const changed = {
      ...base,
      automation: { webdriver: true },
      environment: { ...base.environment, runtimeMarkerCount: 4 },
      behavior: {
        ...base.behavior!,
        visibilityChangeCount: 77,
        mouseMoveCount: 10000,
      },
    };
    const similarity = calculateSimilarity(base, base).score;
    const input = {
      history: [base],
      current: base,
      deterministicSimilarity: similarity,
    };
    const altered = { ...input, history: [changed], current: changed };
    assert.equal(
      requestDigest(createJevInput(input)),
      requestDigest(createJevInput(altered)),
    );
    assert.notEqual(
      requestDigest(createRiskInput(base)),
      requestDigest(createRiskInput(changed)),
    );
    const baseline = await evaluator.evaluate(input);
    const variation = await evaluator.evaluate(altered);
    assert.equal(baseline.sameVisitor, variation.sameVisitor); // identical identity request, cached response
    const batchA = await evaluator.evaluateCandidates!({
      current: base,
      candidates: [{ history: [base], deterministicSimilarity: similarity }],
    });
    const identityBatchA = calls.at(-2)!;
    const batchB = await evaluator.evaluateCandidates!({
      current: changed,
      candidates: [{ history: [changed], deterministicSimilarity: similarity }],
    });
    assert.equal(requestDigest(identityBatchA), requestDigest(calls.at(-2)!));
    assert.equal(batchA[0]!.sameVisitor, batchB[0]!.sameVisitor);
    results.push({
      engine: capture.engine,
      deterministicSimilarity: similarity,
      identityPayloadEqual: true,
      batchIdentityPayloadEqual: true,
      baseline,
      variation,
      batch: { baseline: batchA[0], variation: batchB[0] },
    });
  }
  const report = {
    createdAt: new Date().toISOString(),
    provider: "Cloudflare REST typesafe/jev, production evaluator/parsers",
    sourceSha256: await digest(resolve(source)),
    codeSha256: await digest(
      resolve("scripts/benchmarks/external/jev-isolation.ts"),
    ),
    usage: transport.summary(),
    newCalls: transport.summary().attempts - before,
    maxCalls: maximum,
    results,
    limitations: [
      "Three captured automated test-browser environments; this is protocol isolation, not human/device detection accuracy.",
      "Changed webdriver/runtime/behavior values are synthetic ablations. Identical identity inputs reuse a cached provider answer.",
      "Research transport serializes calls. Production runs the pair concurrently; these timings are not end-to-end request latency.",
      "Raw Jev confidence remains uncalibrated. No production classifier, thresholds, or provider weights were fitted here.",
    ],
  };
  await writeFile(
    "artifacts/external/jev-isolation-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { usage: report.usage, newCalls: report.newCalls, results },
      null,
      2,
    ),
  );
} finally {
  await transport.close();
}
