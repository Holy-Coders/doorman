import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { createVisitorEngine, normalizeObservation } from "@janitor/core";
import { createPostgresStorage } from "@janitor/storage-postgres";
import { createJevMethods } from "../../../packages/evaluators/jev/src/index.js";
import { JEV_QUESTIONS } from "../../../packages/evaluators/jev/src/protocol.js";
import { CLASSIFIER_QUESTIONS } from "../../../packages/network/src/classifier-jev.js";
import { classifierCandidateSchema } from "../../../packages/network/src/classifier-schema.js";
import { scoreClassifier } from "../../../packages/network/src/classifier.js";
import type { FeatureVector } from "../../../packages/network/src/schema.js";
import type { IdentityRow } from "./identity.js";
import { createPilotTransport, requestDigest } from "./jev-transport.js";
import { ndjson, privateJson, digest } from "./io.js";
import { SOURCES } from "./sources.js";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    "max-calls": { type: "string", default: "0" },
  },
});
const directory = resolve("artifacts/external");
const python =
  process.env.CLASSIFIER_PYTHON ?? resolve("tools/classifier/.venv/bin/python");
for (const source of [SOURCES.fpagent, SOURCES.fpstalker])
  for (const file of source.files)
    if ((await digest(resolve(directory, file.name))) !== file.sha256)
      throw new Error("Research input checksum mismatch");
execFileSync(python, ["tools/benchmarks/jev_cases.py"], { stdio: "inherit" });
const transport = await createPilotTransport({
  path: resolve(directory, "jev-pilot-ledger.json"),
  maxCalls: Number(values["max-calls"]),
  live: values.live,
  token: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
});
const callsBefore = transport.summary().attempts;
const realNow = Date.now;
try {
  const cases = JSON.parse(
    await readFile(resolve(directory, "jev-agent-cases.json"), "utf8"),
  ) as {
    index: number;
    fold: string;
    positive: boolean;
    features: FeatureVector;
  }[];
  const report = JSON.parse(
    await readFile(resolve(directory, "fpagent-report.json"), "utf8"),
  ) as {
    folds: { heldoutAgent: string; selected: string; threshold: number }[];
  };
  const models = JSON.parse(
    await readFile(resolve(directory, "fpagent-parity.json"), "utf8"),
  ) as { fold: string | number; candidate: { name: string } }[];
  const riskResults: {
    positive: boolean;
    baseline: number | null;
    baselineThreshold: number;
    jev: number;
  }[] = [];
  for (const row of cases) {
    const fold = report.folds.find((f) => f.heldoutAgent === row.fold)!;
    const candidate = classifierCandidateSchema.parse(
      models.find(
        (m) => m.fold === row.fold && m.candidate.name === fold.selected,
      )!.candidate,
    );
    const baseline = scoreClassifier(candidate, row.features);
    // Exact existing questions, all five existing telemetry features only. No labels,
    // family names, group identifiers, URLs, raw fingerprints or recordings are sent.
    const result = await transport.evaluate({
      state: { features: row.features },
      questions: {
        automation: JEV_QUESTIONS.automation,
        ...CLASSIFIER_QUESTIONS,
      },
    });
    const automation = result.answers.automation?.noul;
    if (automation === undefined) throw new Error("Missing automation answer");
    riskResults.push({
      positive: row.positive,
      baseline,
      baselineThreshold: fold.threshold,
      jev: automation,
    });
    if (riskResults.length % 10 === 0)
      console.log(`Agent cases completed: ${riskResults.length}/80`);
  }
  console.log("Finished 80 paired agent cases");

  const observations: IdentityRow[] = [];
  for await (const row of ndjson<IdentityRow>(
    resolve(directory, "fpstalker.ndjson"),
  ))
    observations.push(row);
  observations.sort((a, b) => a.at - b.at || a.order - b.order);
  const seen = new Set<string>();
  const pools: IdentityRow[][] = [[], []];
  observations.forEach((row, i) => {
    if (
      i >= Math.floor(observations.length * 0.7) &&
      row.signals.platform &&
      row.signals.screen &&
      row.signals.graphics?.webglRenderer
    )
      pools[seen.has(row.subject) ? 1 : 0]!.push(row);
    seen.add(row.subject);
  });
  const selected = pools.flatMap((pool) =>
    pool
      .sort((a, b) => requestDigest(a.id).localeCompare(requestDigest(b.id)))
      .slice(0, 20),
  );
  if (selected.length !== 40)
    throw new Error("Insufficient identity pilot cases");
  const selectedIds = new Set(selected.map((r) => r.id));
  const db = new PGlite();
  const identityResults: {
    returningLabel: boolean;
    baseline: string;
    jev: string;
    evaluated: boolean;
  }[] = [];
  let now = observations[0]!.at;
  try {
    await db.exec(
      await readFile(
        new URL(
          "../../../packages/storage/postgres/migrations/0001_visitors.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const storage = createPostgresStorage(db);
    const known = new Map<string, string>(),
      owners = new Map<string, string>();
    const baseline = createVisitorEngine({ storage });
    let failure: unknown,
      evaluated = false;
    let tail: Promise<unknown> = Promise.resolve();
    const evaluator = createJevMethods(async (input) => {
      try {
        const result = tail.then(() => transport.evaluate(input));
        tail = result.catch(() => {});
        return await result;
      } catch (error) {
        failure = error;
        throw error;
      }
    });
    const assisted = createVisitorEngine({
      storage,
      evaluator,
      lookupPlanning: false,
      evaluatorTimeoutMs: 20000,
      onMetrics: (m) => {
        evaluated = m.evaluatorUsed;
      },
    });
    Date.now = () => now;
    for (const row of observations) {
      now = row.at;
      if (selectedIds.has(row.id)) {
        const answers = [];
        for (const engine of [baseline, assisted]) {
          await db.exec("BEGIN");
          try {
            const answer = await engine.identify({ signals: row.signals });
            answers.push(
              !answer.isReturning
                ? "new-id"
                : owners.get(answer.visitorId) === row.subject
                  ? "correct-restore"
                  : "wrong-restore",
            );
          } finally {
            await db.exec("ROLLBACK");
          }
          if (failure) throw failure;
        }
        identityResults.push({
          returningLabel: known.has(row.subject),
          baseline: answers[0]!,
          jev: answers[1]!,
          evaluated,
        });
        if (identityResults.length % 10 === 0)
          console.log(`Identity cases completed: ${identityResults.length}/40`);
      }
      let id = known.get(row.subject);
      if (!id) {
        // Stable synthetic seed IDs make tie-breaking reproducible across cached
        // replays. The digest contains an ordinal, never fingerprint or label data.
        id = `vis_${requestDigest({ pilot: 1, ordinal: known.size }).slice(0, 32)}`;
        await db.query(
          "INSERT INTO visitors (id, created_at, last_seen_at) VALUES ($1, $2, $3)",
          [id, now, now],
        );
        known.set(row.subject, id);
        owners.set(id, row.subject);
      }
      await storage.saveObservation(id, normalizeObservation(row.signals));
      await storage.touchVisitor(id);
    }
  } finally {
    Date.now = realNow;
    await db.close();
  }
  const riskMetrics = (which: "baseline" | "jev") => {
    const rows = riskResults.filter((r) => r[which] !== null);
    const positives = rows.filter((r) => r.positive),
      negatives = rows.filter((r) => !r.positive);
    const flags = rows.filter(
      (r) => r[which]! >= (which === "jev" ? 0.85 : r.baselineThreshold),
    );
    let concordant = 0;
    for (const p of positives)
      for (const n of negatives)
        concordant +=
          p[which]! > n[which]! ? 1 : p[which] === n[which] ? 0.5 : 0;
    return {
      cases: riskResults.length,
      scored: rows.length,
      humanCases: 40,
      agentCases: 40,
      truePositives: flags.filter((r) => r.positive).length,
      falsePositives: flags.filter((r) => !r.positive).length,
      rocAucScored:
        positives.length && negatives.length
          ? concordant / (positives.length * negatives.length)
          : null,
    };
  };
  const identityMetrics = (which: "baseline" | "jev") =>
    Object.fromEntries(
      ["correct-restore", "wrong-restore", "new-id"].map((k) => [
        k,
        identityResults.filter((r) => r[which] === k).length,
      ]),
    );
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: "jev-1.13.0",
    transport: "Cloudflare AI REST /ai/run; typesafe/jev; default gateway",
    sampling:
      "Frozen hash-selected pilot; no prompt changes or threshold tuning on these cases",
    questions: "Existing JEV_QUESTIONS and CLASSIFIER_QUESTIONS unchanged",
    provenance: {
      agentCasesSha256: await digest(
        resolve(directory, "jev-agent-cases.json"),
      ),
      identityCasesSha256: requestDigest(selected.map((row) => row.id)),
      pilotCodeSha256: await digest(
        resolve("scripts/benchmarks/external/jev-pilot.ts"),
      ),
      questionsSha256: requestDigest({ JEV_QUESTIONS, CLASSIFIER_QUESTIONS }),
    },
    allowance: {
      maxCalls: 120,
      maxRequestBytes: 32768,
      automaticRetries: 0,
      gatewayLogs: false,
    },
    usage: transport.summary(),
    newCalls: transport.summary().attempts - callsBefore,
    agents: {
      cases: 80,
      selection:
        "40 human test cases and 40 agent cases stratified across the seven existing family-holdout folds",
      baselineThreshold: "Each fold's preselected validation threshold",
      jevThreshold: 0.85,
      baseline: riskMetrics("baseline"),
      jev: riskMetrics("jev"),
    },
    identity: {
      cases: 40,
      returningLabels: 20,
      firstObservations: 20,
      selection:
        "Last 30% of chronology, with platform/screen/renderer present; hash-selected without looking at matcher outputs",
      history:
        "Earlier observations seeded under publisher labels, modeling reliable previous cookies; both queries roll back to exactly the same SQL state",
      evaluatorTimeoutMs: 20000,
      lookupPlanning: false,
      baseline: identityMetrics("baseline"),
      jev: identityMetrics("jev"),
      evaluated: identityResults.filter((r) => r.evaluated).length,
    },
    limitations: [
      "Small pilot, not population accuracy or a calibrated security threshold",
      "Identity pilot uses known prior cookie history and is not the full all-cookies-lost replay",
      "Jev sees only the five aggregate behavior features in the agent comparison; no browser signals or server activity",
      "Agent detection is not malicious-intent detection",
      "No model fine-tuning, downstream Jev-feature training, account linking or production promotion",
      "Longer offline timeout measures model quality; latency above the default deadline is reported separately",
    ],
  };
  await privateJson(resolve(directory, "jev-pilot-results-private.json"), {
    riskResults,
    identityResults,
  });
  await privateJson(resolve(directory, "jev-pilot-report.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  Date.now = realNow;
  await transport.close();
}
