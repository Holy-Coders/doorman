import { describe, expect, it } from "vitest";
import {
  agentFamily,
  hasOperatorEvidence,
  isOperatorEvaluation,
  operatorLabel,
  summarizeOperators,
} from "@janitor/core";

import { evidence, evaluation, window } from "./helpers/operators.js";
const range = { since: 0, until: 1000 };
describe("operator labels and account resolution", () => {
  it("keeps unknown/sparse windows unknown and abuse separate from operator kind", () => {
    expect(
      hasOperatorEvidence({
        source: "browser",
        features: { observation_duration_ms: 10000 },
      }),
    ).toBe(false);
    expect(hasOperatorEvidence(evidence)).toBe(true);
    expect(operatorLabel()).toBe("unknown");
    expect(
      operatorLabel({
        ...evaluation(),
        scores: { human: 0.8, assistant: 0.8, automation: 0.1 },
      }),
    ).toBe("unknown");
    expect(operatorLabel({ ...evaluation("human"), abuse: 1 })).toBe("human");
    expect(isOperatorEvaluation({ ...evaluation(), abuse: NaN })).toBe(false);
    expect(
      isOperatorEvaluation({
        ...evaluation(),
        links: [
          { windowId: "a", score: 1 },
          { windowId: "a", score: 1 },
        ],
      }),
    ).toBe(false);
  });
  it("reports three agent profiles and two human profiles across four browser IDs in a controlled fixture", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      ...window(
        `w${i}`,
        i % 5 < 3 ? "assistant" : "human",
        Array.from({ length: i }, (_, j) => ({
          windowId: `w${j}`,
          score: i % 5 === j % 5 ? 0.99 : 0.01,
        })),
      ),
      browserKey: `browser-${i % 4}`,
    }));
    const summary = summarizeOperators(rows, range);
    expect(summary.observedBrowserIds).toBe(4);
    expect(summary.estimates.assistant.likely).toBe(3);
    expect(summary.estimates.human.likely).toBe(2);
    expect(summary.unresolvedWindows).toBe(0);
    expect(summary.scoreKind).toBe("uncalibrated");
    expect(summary).toEqual(summarizeOperators([...rows].reverse(), range));
  });
  it("does not merge through an unobserved or contradictory transitive edge", () => {
    const a = window("a"),
      b = window("b", "assistant", [{ windowId: "a", score: 0.99 }]);
    const c = window("c", "assistant", [{ windowId: "b", score: 0.99 }]);
    expect(summarizeOperators([a, b, c], range).profiles).toHaveLength(2);
    c.evaluation!.links.push({ windowId: "a", score: 0.01 });
    expect(summarizeOperators([a, b, c], range).profiles).toHaveLength(2);
    c.evaluation!.links[1]!.score = 0.99;
    expect(summarizeOperators([a, b, c], range).profiles).toHaveLength(1);
  });
  it("permits device changes with link evidence and handoffs on one browser", () => {
    const a = window("a"),
      b = {
        ...window("b", "assistant", [{ windowId: "a", score: 0.99 }]),
        browserKey: "other-browser",
      };
    const c = window("c", "human", [
      { windowId: "a", score: 1 },
      { windowId: "b", score: 1 },
    ]);
    const result = summarizeOperators([a, b, c], range);
    expect(result.profiles).toHaveLength(2);
    expect(
      result.profiles.find((p) => p.kind === "assistant")!.browserCount,
    ).toBe(2);
  });
  it("requires a separated family score and retains unknown families", () => {
    const e = {
      ...evaluation(),
      families: [{ family: "test-agent", score: 0.94 }],
    };
    expect(agentFamily(e)?.family).toBe("test-agent");
    expect(
      agentFamily({
        ...e,
        families: [...e.families, { family: "other", score: 0.9 }],
      }),
    ).toBeUndefined();
    expect(
      agentFamily({ ...evaluation("human"), families: e.families }),
    ).toBeUndefined();
    const a = { ...window("a"), evaluation: e },
      b = window("b", "assistant", [{ windowId: "a", score: 1 }]);
    expect(
      summarizeOperators([a, b], range).profiles[0]!.family,
    ).toBeUndefined();
  });
  it("separates sensitivity from confidence and returns no estimate for a truncated or unmeasured report", () => {
    const rows = [
      window("a"),
      window("b", "assistant", [{ windowId: "a", score: 0.91 }]),
    ];
    expect(summarizeOperators(rows, range).estimates.assistant).toEqual({
      profiles: 1,
      uncomparedPairs: 0,
      likely: 1,
      thresholdSensitivity: { min: 1, max: 2 },
    });
    expect(summarizeOperators([], range).estimates.human.likely).toBeNull();
    const unmeasured = {
      ...window("unknown"),
      status: "unavailable" as const,
      evaluation: undefined,
    };
    expect(summarizeOperators([unmeasured], range).unresolvedWindows).toBe(1);
    expect(
      summarizeOperators([unmeasured], range).estimates.human.likely,
    ).toBeNull();
    const full = summarizeOperators(
      Array.from({ length: 201 }, (_, i) => window(`w${i}`)),
      range,
    );
    expect(full.complete).toBe(false);
    expect(full.estimates.assistant.likely).toBeNull();
  });
  it("rejects mixed accounts, duplicate windows, oversized input and invalid ranges", () => {
    expect(() =>
      summarizeOperators(
        [window("a"), { ...window("b"), accountKey: "other" }],
        range,
      ),
    ).toThrow();
    expect(() =>
      summarizeOperators([window("a"), window("a")], range),
    ).toThrow();
    expect(() =>
      summarizeOperators(
        Array.from({ length: 202 }, (_, i) => window(`${i}`)),
        range,
      ),
    ).toThrow();
    expect(() => summarizeOperators([], { since: 2, until: 1 })).toThrow();
  });
});
