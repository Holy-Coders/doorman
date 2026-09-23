import { describe, expect, it } from "vitest";
import {
  calculateSimilarity,
  createVisitorEngine,
  normalizeObservation,
  resolveScoring,
  SIMILARITY_WEIGHTS,
  resolveSimilarityWeights,
  operatorLabel,
  summarizeOperators,
  resolveOperatorThresholds,
} from "@aarondovturkel/doorman-core";
import {
  operatorWindowProperties,
  operatorSummaryProperties,
} from "../packages/adapters/src/operator-analytics.js";
import { createMemoryStorage } from "./helpers/memory.js";
import { signals, phone } from "./helpers/fixtures.js";
import { window } from "./helpers/operators.js";

describe("server scoring configuration", () => {
  it("retains defaults and normalizes partial relative feature weights", () => {
    const a = normalizeObservation(signals);
    const b = { ...a, timezone: "Europe/London" };
    const base = calculateSimilarity(a, b).score;
    expect(calculateSimilarity(a, b, SIMILARITY_WEIGHTS).score).toBe(base);
    expect(calculateSimilarity(a, b, { sameTimezone: 0 }).score).toBeCloseTo(1);
    expect(calculateSimilarity(a, b, { sameTimezone: 1 }).score).toBeLessThan(
      base,
    );
    expect(
      Object.values(resolveSimilarityWeights({ sameTimezone: 3 })).reduce(
        (a, b) => a + b,
      ),
    ).toBeCloseTo(1);
  });
  it("rejects invalid weights, misspellings, all-zero weights and invalid thresholds", () => {
    for (const v of [-1, NaN, Infinity, undefined])
      expect(() =>
        resolveSimilarityWeights({ sameTimezone: v } as never),
      ).toThrow();
    expect(() => resolveSimilarityWeights({ typo: 1 } as never)).toThrow();
    expect(() =>
      resolveSimilarityWeights(
        Object.fromEntries(Object.keys(SIMILARITY_WEIGHTS).map((k) => [k, 0])),
      ),
    ).toThrow();
    for (const config of [
      { confidence: { deterministic: 0, evaluator: 0 } },
      { confidence: { deterministic: 1 } },
      { confidence: { deterministic: Infinity, evaluator: 1 } },
      { candidateFloor: 0.1 },
      { ambiguityMargin: 0 },
      { typo: 1 },
    ])
      expect(() => resolveScoring(config as never)).toThrow();
  });
  it("changes the identity blend, snapshots config, and preserves deterministic fallback", async () => {
    const storage = createMemoryStorage();
    const first = await createVisitorEngine({ storage }).identify({ signals });
    const scoring = { confidence: { deterministic: 4, evaluator: 1 } };
    const engine = createVisitorEngine({
      storage,
      scoring,
      evaluator: {
        evaluate: async () => ({
          sameVisitor: 0.6,
          automation: 1,
          suspicious: 1,
        }),
      },
    });
    scoring.confidence.deterministic = 0;
    const result = await engine.identify({ signals });
    expect(result.visitorId).toBe(first.visitorId);
    expect(result.confidence).toBeCloseTo(0.92);
    const fallback = createVisitorEngine({
      storage,
      scoring,
      evaluator: {
        evaluate: async () => {
          throw new Error("offline");
        },
      },
    });
    expect(await fallback.identify({ signals })).toMatchObject({
      visitorId: first.visitorId,
      confidence: 1,
      riskStatus: "unavailable",
      risk: { automation: 0, suspicious: 0 },
    });
  });
  it("cannot inflate sparse evidence, erase contradictions or bypass ambiguity", async () => {
    const weights = Object.fromEntries(
      Object.keys(SIMILARITY_WEIGHTS).map((k) => [
        k,
        k === "sameTimezone" ? 1 : 0,
      ]),
    );
    const sparse = { timezone: "UTC" };
    expect(calculateSimilarity(sparse, sparse, weights).score).toBeLessThan(
      0.1,
    );
    const storage = createMemoryStorage();
    const engine = createVisitorEngine({
      storage,
      scoring: {
        similarity: weights,
        confidence: { deterministic: 0, evaluator: 1 },
      },
      evaluator: {
        evaluate: async () => ({
          sameVisitor: 1,
          automation: 0,
          suspicious: 0,
        }),
      },
    });
    await engine.identify({ signals });
    expect((await engine.identify({ signals: phone })).isReturning).toBe(false);
    const a = await storage.createVisitor(),
      b = await storage.createVisitor();
    await storage.saveObservation(a, normalizeObservation(signals));
    await storage.saveObservation(b, normalizeObservation(signals));
    expect((await engine.identify({ signals })).isReturning).toBe(false);
  });
  it("configures labels and complete-link clustering with reproducible analytics policies", () => {
    const a = window("a"),
      b = window("b", "assistant", [{ windowId: "a", score: 0.92 }]);
    const range = { since: 0, until: 1000 };
    expect(summarizeOperators([a, b], range).profiles).toHaveLength(1);
    const config = { linkThreshold: 0.95, labelThreshold: 0.99 };
    expect(operatorLabel(a.evaluation, config)).toBe("unknown");
    a.thresholds = resolveOperatorThresholds(config);
    expect(
      operatorWindowProperties(a, { accountId: "account" })
        .doorman_operator_kind,
    ).toBe("unknown");
    const strict = summarizeOperators([a, b], range, { linkThreshold: 0.95 });
    expect(strict.profiles).toHaveLength(2);
    expect(
      operatorSummaryProperties(strict, {
        accountId: "account",
        revisionId: "v2",
      }).doorman_operator_scoring_policy,
    ).toBe(strict.scoringPolicy);
    expect(() => resolveOperatorThresholds({ linkThreshold: 0.99 })).toThrow();
    expect(() => resolveOperatorThresholds({ labelMargin: 0 })).toThrow();
  });
});
