import { expect, it } from "vitest";
import { buildAgentFamilyReferences } from "../packages/network/src/operator-study.js";
import { evidence } from "./helpers/operators.js";
const rows = Array.from({ length: 6 }, (_, i) => ({
  runId: `private-run-${i}`,
  task: `task-${i % 2}`,
  split: "train",
  observedAt: 100 + i,
  labelSource: "controlled-run",
  trainingAllowed: true,
  kind: "assistant",
  family: "test-agent",
  evidence: {
    ...evidence,
    features: { ...evidence.features, api_gap_cv: i / 10 },
  },
}));
const options = { version: "study-v1", fittedAt: 200, expiresAt: 10000 };
it("builds bounded family references from independent eligible training runs only", () => {
  const result = buildAgentFamilyReferences(
    [
      ...rows,
      {
        ...rows[0],
        runId: "private-holdout",
        family: "held-out-agent",
        split: "holdout",
      },
      {
        ...rows[0],
        runId: "private-optout",
        family: "no-consent",
        trainingAllowed: false,
      },
    ],
    options,
  );
  expect(result.families).toHaveLength(1);
  expect(result.families[0]!.examples).toHaveLength(5);
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(JSON.stringify(result)).not.toContain("task-");
  expect(result.scoreKind).toBe("uncalibrated");
  expect(buildAgentFamilyReferences([...rows].reverse(), options)).toEqual(
    buildAgentFamilyReferences(rows, options),
  );
});
it("rejects leaked duplicate runs, predicted labels and sparse one-task studies", () => {
  expect(() =>
    buildAgentFamilyReferences(
      [...rows, { ...rows[0], split: "holdout" }],
      options,
    ),
  ).toThrow();
  expect(() =>
    buildAgentFamilyReferences([{ ...rows[0], labelSource: "model" }], options),
  ).toThrow();
  expect(
    buildAgentFamilyReferences(
      rows.map((r) => ({ ...r, task: "one-task" })),
      options,
    ).families,
  ).toEqual([]);
  expect(
    buildAgentFamilyReferences(rows, { ...options, fittedAt: 1 }).families,
  ).toEqual([]);
});
