/** Expanded, frozen evaluation. Requires explicit --live and --max-calls, never retries. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  normalizeObservation,
  calculateSimilarity,
  operatorLabel,
  hasOperatorEvidence,
} from "@janitor/core";
import type {
  ApiActivitySummary,
  ApiActivityInput,
  BrowserObservation,
  BrowserBehavior,
  OperatorEvidence,
  OperatorEvaluation,
} from "@janitor/core";
import { createCloudflareJevEvaluator } from "@janitor/evaluator-cloudflare-jev";
import { extractFeatures } from "../../../packages/network/src/features.js";
import type { FeatureVector } from "../../../packages/network/src/schema.js";
import { createPilotTransport, requestDigest } from "./jev-transport.js";
import { privateJson, digest } from "./io.js";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    "max-calls": { type: "string", default: "0" },
  },
});
const root = resolve("artifacts/external");
const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const selected = (await read(resolve(root, "jev-agent-cases.json"))) as {
  index: number;
  positive: boolean;
  fold: string;
}[];
const { rows } = (await read(resolve(root, "fpagent-features.json"))) as {
  rows: { positive: boolean; features: FeatureVector }[];
};
const browser = (await read("artifacts/browser-benchmark/jev-cases.json")) as {
  engine: string;
  scenario: string;
  sample: { signals: BrowserObservation; behavior: BrowserBehavior };
}[];
assert.equal(selected.length, 80);
assert.equal(browser.length, 18);
// Persist the selected-input manifest before the first answer. Labels stay local.
const manifest = {
  featuresSha256: await digest(resolve(root, "fpagent-features.json")),
  selectionSha256: await digest(resolve(root, "jev-agent-cases.json")),
  browserCasesSha256: await digest(
    resolve("artifacts/browser-benchmark/jev-cases.json"),
  ),
  codeSha256: await digest(
    resolve("scripts/benchmarks/external/jev-validation.ts"),
  ),
  operatorThreshold: 0.75,
  operatorMargin: 0.15,
  riskThreshold: 0.85,
};
await privateJson(resolve(root, "jev-validation-manifest.json"), manifest);
const transport = await createPilotTransport({
  path: resolve(root, "jev-validation-ledger.json"),
  maxCalls: Number(values["max-calls"]),
  live: values.live,
  token: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
});
const before = transport.summary().attempts;
// Real REST transport through the production Workers AI response adapter and parsers.
const evaluator = createCloudflareJevEvaluator(
  {
    run: async (model, input) => {
      assert.equal(model, "typesafe/jev");
      return { state: "Completed", result: await transport.evaluate(input) };
    },
  },
  { timeoutMs: 20000 },
);
const failures: { section: string; index: number; error: string }[] = [];
async function run<T>(section: string, index: number, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    // Do not print provider bodies or input payloads. Reserved attempts remain consumed.
    failures.push({
      section,
      index,
      error:
        error instanceof Error
          ? error.message.slice(0, 200)
          : "Evaluation failed",
    });
    return undefined;
  }
}
try {
  const agentResults: {
    positive: boolean;
    fold: string;
    enoughEvidence: boolean;
    label: string;
    result: OperatorEvaluation | undefined;
  }[] = [];
  for (const [i, selection] of selected.entries()) {
    const row = rows[selection.index];
    assert(row && row.positive === selection.positive);
    const current: OperatorEvidence = {
      source: "browser",
      features: row.features,
    };
    const result = await run("operators", i, () =>
      evaluator.evaluateOperator!({ current, candidates: [], families: [] }),
    );
    agentResults.push({
      positive: row.positive,
      fold: selection.fold,
      enoughEvidence: hasOperatorEvidence(current),
      label: hasOperatorEvidence(current) ? operatorLabel(result) : "unknown",
      result,
    });
    if ((i + 1) % 10 === 0)
      console.log(`Expanded Jev operator cases ${i + 1}/80`);
  }
  const browserResults = [];
  for (const [i, row] of browser.entries()) {
    const baseline = browser.find(
      (b) => b.engine === row.engine && b.scenario === "baseline",
    )!;
    const current = normalizeObservation(
      row.sample.signals,
      row.sample.behavior,
    );
    const previous = normalizeObservation(
      baseline.sample.signals,
      baseline.sample.behavior,
    );
    const similarity = calculateSimilarity(previous, current).score;
    browserResults.push({
      engine: row.engine,
      scenario: row.scenario,
      deterministicSimilarity: similarity,
      result: await run("browser", i, () =>
        evaluator.evaluate({
          history: [previous],
          current,
          deterministicSimilarity: similarity,
        }),
      ),
    });
  }
  const at = 1_800_000_000_000;
  function activity(
    requests: number,
    denied: number,
    serverErrors = 0,
  ): ApiActivitySummary {
    return {
      source: "application-api",
      observedAt: at,
      windowMs: 60000,
      truncated: false,
      buckets: [
        {
          windowStart: at - 60000,
          route: "auth.attempt",
          requests,
          denied,
          clientErrors: denied,
          serverErrors,
          durationTotalMs: requests * 50,
          durationMaxMs: 50,
          firstSeenAt: at - 59000,
          lastSeenAt: at - 1000,
          shortGaps: Math.max(0, requests - 10),
        },
      ],
    };
  }
  const base: ApiActivityInput = {
    activity: activity(1, 0),
    route: "auth.attempt",
    sensitive: true,
  };
  const linked = (
    confidence: number,
    requests: number,
    denied: number,
  ): ApiActivityInput => ({
    ...base,
    relatedActivity: [
      {
        basis: "request-pattern",
        confidence,
        minimumLinkConfidence: 0.8,
        summary: activity(requests, denied),
      },
    ],
  });
  const activityCases: [string, ApiActivityInput][] = [
    ["sparse", base],
    ["benign-volume", { ...base, activity: activity(1000, 0) }],
    ["server-errors", { ...base, activity: activity(100, 0, 90) }],
    [
      "authorized-agent",
      {
        ...base,
        activity: activity(1000, 0),
        actor: { kind: "agent", delegated: true },
      },
    ],
    ["local-denials", { ...base, activity: activity(100, 95) }],
    ["linked-denials-080", linked(0.8, 100, 95)],
    ["linked-denials-095", linked(0.95, 100, 95)],
    ["linked-benign-095", linked(0.95, 1000, 0)],
    ["linked-retries", linked(0.95, 5, 2)],
    [
      "linked-overlap-3",
      {
        ...linked(0.95, 100, 95),
        relatedActivity: Array.from(
          { length: 3 },
          () => linked(0.95, 100, 95).relatedActivity![0]!,
        ),
      },
    ],
    [
      "delegated-denials",
      { ...linked(0.95, 100, 95), actor: { kind: "agent", delegated: true } },
    ],
    [
      "linked-verified-denials",
      {
        ...linked(0.95, 100, 95),
        relatedActivity: [
          {
            ...linked(0.95, 100, 95).relatedActivity![0]!,
            basis: "verified-identifier",
          },
        ],
      },
    ],
    [
      "linked-browser-denials",
      {
        ...linked(0.95, 100, 95),
        relatedActivity: [
          {
            ...linked(0.95, 100, 95).relatedActivity![0]!,
            basis: "browser-match",
          },
        ],
      },
    ],
    ["non-sensitive-denials", { ...linked(0.95, 100, 95), sensitive: false }],
  ];
  // Second, predeclared synthetic panel: vary one feature at a time, without
  // borrowing a human/agent ground-truth label for invented browser observations.
  const fixture: BrowserObservation = {
    platform: "MacIntel",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    languages: ["en-US"],
    timezone: "UTC",
    screen: { width: 1440, height: 900, colorDepth: 24, pixelRatio: 2 },
    viewport: { width: 1280, height: 720 },
    hardware: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 },
    automation: { webdriver: false },
  };
  const counts: BrowserBehavior = {
    pageAgeMs: 60000,
    mouseMoveCount: 0,
    pointerDownCount: 12,
    keyDownCount: 0,
    scrollCount: 0,
    visibilityChangeCount: 0,
  };
  const ablations: [
    string,
    Partial<BrowserObservation>,
    Partial<BrowserBehavior>,
  ][] = [
    ["baseline", {}, {}],
    ["missing-signals", {}, {}],
    [
      "fonts-empty",
      { fonts: { version: "local-12-v1", available: "000000000000" } },
      {},
    ],
    [
      "fonts-present",
      { fonts: { version: "local-12-v1", available: "111000000000" } },
      {},
    ],
    ["own-webdriver", { environment: { webdriverOwnProperty: true } }, {}],
    ["runtime-marker", { environment: { runtimeMarkerCount: 1 } }, {}],
    [
      "permission-mismatch",
      {
        environment: {
          notificationPermission: "denied",
          notificationQuery: "prompt",
        },
      },
      {},
    ],
    ["font-download-failed", { environment: { pageFontsFailed: 1 } }, {}],
    ["font-download-loaded", { environment: { pageFontsLoaded: 3 } }, {}],
    ["center-targets", {}, { targetSampleCount: 12, targetCenterCount: 12 }],
    ["corner-targets", {}, { targetSampleCount: 12, targetCornerCount: 12 }],
    ["unfocused-input", {}, { focusSampleCount: 12, unfocusedInputCount: 12 }],
    ["focus-changes", {}, { focusChangeCount: 12 }],
    ["diagnostic-decoy", {}, { decoyActivationCount: 1 }],
    ["webdriver", { automation: { webdriver: true } }, {}],
    [
      "combined-experimental",
      {
        environment: {
          runtimeMarkerCount: 1,
          webdriverOwnProperty: true,
          notificationPermission: "denied",
          notificationQuery: "prompt",
          pageFontsFailed: 1,
        },
      },
      {
        targetSampleCount: 12,
        targetCenterCount: 12,
        focusSampleCount: 12,
        unfocusedInputCount: 12,
        focusChangeCount: 12,
        decoyActivationCount: 1,
      },
    ],
  ];
  await privateJson(resolve(root, "jev-validation-ablation-manifest.json"), {
    cases: ablations,
    fixture,
    counts,
    codeSha256: manifest.codeSha256,
  });
  const ablationResults = [];
  for (const [i, [scenario, signals, behavior]] of ablations.entries()) {
    const current =
      scenario === "missing-signals"
        ? {}
        : normalizeObservation(
            { ...fixture, ...signals },
            { ...counts, ...behavior },
          );
    const history = [normalizeObservation(fixture, counts)];
    ablationResults.push({
      scenario,
      result: await run("ablation", i, () =>
        evaluator.evaluate({
          current,
          history,
          deterministicSimilarity: calculateSimilarity(history[0]!, current)
            .score,
        }),
      ),
    });
  }
  const activityResults = [];
  for (const [i, [scenario, input]] of activityCases.entries())
    activityResults.push({
      scenario,
      result: await run("activity", i, () =>
        evaluator.evaluateActivity!(input),
      ),
    });
  const first = normalizeObservation(browser[0]!.sample.signals);
  const other = normalizeObservation({
    platform: "android",
    userAgent: "Mozilla/5.0 Chrome/130.0.0.0",
    hardware: { maxTouchPoints: 5 },
    screen: { width: 390, height: 844 },
  });
  const smokeResults: Record<string, unknown> = {};
  for (const [i, current] of [{}, first, other].entries())
    smokeResults[`lookup${i}`] = await run("lookup", i, () =>
      evaluator.planLookup!(current),
    );
  for (const [i, current] of [first, other].entries())
    smokeResults[`candidates${i}`] = await run("candidates", i, () =>
      evaluator.evaluateCandidates!({
        current,
        candidates: [first, other].map((o) => ({
          history: [o],
          deterministicSimilarity: calculateSimilarity(o, current).score,
        })),
      }),
    );
  smokeResults.crossDevice = await run("crossDevice", 0, () =>
    evaluator.predictIdentity!({
      current: other,
      examples: [0, 1].map((i) => ({
        sessionId: `fixture${i}`,
        subjectId: "fixture-person",
        observation: first,
        observedAt: at - i * 100000,
        verifiedAt: at - i * 100000,
      })),
    }),
  );
  for (const [i, features] of [
    {},
    extractFeatures({
      observation: browser[1]!.sample.signals,
      behavior: browser[1]!.sample.behavior,
    }),
  ].entries()) {
    const current: OperatorEvidence = { source: "browser", features };
    smokeResults[`operatorReferences${i}`] = await run("references", i, () =>
      evaluator.evaluateOperator!({
        current,
        candidates: [{ id: "fixture-reference", evidence: current }],
        families: [
          {
            family: "synthetic-reference",
            version: "1",
            source: "controlled-study",
            expiresAt: at + 100000,
            examples: [current],
          },
        ],
      }),
    );
  }
  const answered = agentResults.filter((r) => r.result);
  const positive = answered.filter((r) => r.positive),
    negative = answered.filter((r) => !r.positive);
  const score = (r: (typeof answered)[number]) =>
    Math.max(r.result!.scores.assistant, r.result!.scores.automation);
  let concordance = 0;
  for (const p of positive)
    for (const n of negative)
      concordance += score(p) > score(n) ? 1 : score(p) === score(n) ? 0.5 : 0;
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    manifest,
    manifestDigest: requestDigest(manifest),
    transport:
      "Real Cloudflare AI REST typesafe/jev via production Workers AI evaluator; 20s offline deadline",
    allowance: {
      maxCalls: 120,
      automaticRetries: 0,
      maxRequestBytes: 32768,
      gatewayPayloadLogging: false,
    },
    usage: transport.summary(),
    newCalls: transport.summary().attempts - before,
    failures,
    operators: {
      cases: 80,
      answered: answered.length,
      humanCases: negative.length,
      agentCases: positive.length,
      rocAuc:
        positive.length && negative.length
          ? concordance / (positive.length * negative.length)
          : null,
      aucDefinition: "max(assistant, automation); no tuning",
      scoreRange: answered.length
        ? [Math.min(...answered.map(score)), Math.max(...answered.map(score))]
        : [],
      truePositiveAt085: positive.filter((r) => score(r) >= 0.85).length,
      falsePositiveAt085: negative.filter((r) => score(r) >= 0.85).length,
      labelCounts: Object.fromEntries(
        [false, true].map((positive) => [
          positive ? "agent" : "human",
          Object.fromEntries(
            ["human", "assistant", "automation", "unknown"].map((label) => [
              label,
              agentResults.filter(
                (r) => r.positive === positive && r.label === label,
              ).length,
            ]),
          ),
        ]),
      ),
      evidenceSupported: agentResults.filter((r) => r.enoughEvidence).length,
    },
    browser: browserResults,
    activity: activityResults,
    ablations: ablationResults,
    smoke: smokeResults,
    limitations: [
      "80 existing frozen pilot cases, not a fresh independent test population; no fitting on responses.",
      "Operator prompt and feature set both changed; this does not isolate feature gain.",
      "No runtime/font/permission/target/focus/decoy measurements are present in the third-party projection. Missing stays missing.",
      "Browser fixtures are scripted on one host, not human or assistant-brand accuracy labels. Later fixture stages accumulate earlier actions.",
      "Linked-activity fixtures are synthetic. Application-supplied link confidence is not independently validated here.",
      "Reference-family and cross-device checks exercise APIs, not verified-person or brand attribution accuracy.",
      "No live direct-TypeSafe endpoint test; Workers AI uses the shared production Jev methods.",
      "No training, fine-tuning, automatic blocking or production model promotion.",
    ],
    productionPromoted: false,
  };
  await privateJson(
    resolve(root, "jev-validation-results-private.json"),
    agentResults,
  );
  await privateJson(resolve(root, "jev-validation-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await transport.close();
}
