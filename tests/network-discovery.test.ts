import { describe, it, expect } from "vitest";
import {
  extractFeatures,
  createSequenceTracker,
} from "../packages/network/src/features.js";
import {
  discoverPatterns,
  matchPatterns,
} from "../packages/network/src/discovery.js";
import { parseFeatures } from "../packages/network/src/schema.js";
import { discoveryFixture } from "./helpers/network.js";

describe("network feature extraction", () => {
  it("keeps missing and sparse mouse APIs unknown and excludes raw fields", () => {
    expect(extractFeatures({})).toEqual({});
    expect(
      extractFeatures({
        behavior: {
          pageAgeMs: 1000,
          mouseMoveCount: 0,
          pointerDownCount: 0,
          keyDownCount: 0,
          scrollCount: 0,
          visibilityChangeCount: 0,
          mouseDistancePx: 0,
          mouseActiveMs: 0,
        },
      }),
    ).toEqual({});
    expect(() => parseFeatures({ email: "a@example.com" })).toThrow();
    expect(() => parseFeatures({ api_gap_cv: Infinity })).toThrow();
  });
  it("learnable motion summaries contain neither coordinates nor actual keys", () => {
    const features = extractFeatures({
      behavior: {
        pageAgeMs: 60_000,
        mouseMoveCount: 100,
        pointerDownCount: 10,
        keyDownCount: 50,
        scrollCount: 2,
        visibilityChangeCount: 0,
        mouseDistancePx: 2345,
        mouseActiveMs: 10000,
        mouseDirectionChanges: 17,
        mousePauseCount: 6,
        interactionIntervalCount: 20,
        interactionIntervalMeanMs: 512,
        interactionIntervalStdDevMs: 50,
      },
    });
    expect(features).toEqual({
      observation_duration_ms: 60_000,
      mouse_event_count: 100,
      interaction_sample_count: 20,
      mouse_speed: 200,
      mouse_turn_ratio: 0.15000000000000002,
      mouse_pause_ratio: 0.05,
      interaction_mean_ms: 500,
      interaction_cv: 0.1,
    });
    expect(Object.keys(features)).not.toContain("keyDownCount");
  });
  it("records bounded semantic route transitions and arrival variability without URLs", () => {
    const sequence = createSequenceTracker();
    for (let i = 0; i < 100; i++)
      sequence.observe(i % 2 ? "tool" : "telemetry", i * 500);
    const snapshot = sequence.snapshot();
    expect(snapshot.api_gap_mean_ms).toBe(500);
    expect(snapshot.api_gap_cv).toBe(0);
    expect(snapshot.transition_telemetry_tool).toBeCloseTo(0.5);
    expect(snapshot.transition_tool_telemetry).toBeCloseTo(0.5);
    sequence.observe("telemetry", -1);
    expect(sequence.snapshot()).toEqual(snapshot);
    for (let i = 100; i < 1000; i++) sequence.observe("auth", i * 500);
    const bounded = sequence.snapshot();
    sequence.observe("write", 600000);
    expect(sequence.snapshot()).toEqual(bounded);
  });
});
describe("automatic pattern discovery", () => {
  it("discovers corroborating route/timing patterns and validates on future unseen tenants", () => {
    const { rows, options } = discoveryFixture();
    const model = discoverPatterns(rows, options);
    expect(model.eligible).toBe(true);
    expect(model.metrics.holdout.falsePositiveRate).toBe(0);
    expect(model.metrics.holdout.recall).toBe(1);
    expect(model.metrics.holdout.tenants).toBe(3);
    expect(
      matchPatterns(model, { route_telemetry_share: 0.5, api_gap_cv: 0.1 }),
    ).not.toHaveLength(0);
    expect(
      matchPatterns(model, { route_telemetry_share: 0.5, api_gap_cv: 2 }),
    ).toEqual([]);
    expect(matchPatterns(model, {})).toEqual([]);
    expect(model.patterns.every((p) => p.predicates.length === 2)).toBe(true);
  });
  it("rejects a customer-specific pattern and never reranks using the test labels", () => {
    const { rows, options } = discoveryFixture();
    const baseline = discoverPatterns(rows, options);
    for (const row of rows)
      if (options.holdoutTenants.includes(row.tenantId))
        row.positive = !row.positive;
    const poisoned = discoverPatterns(rows, options);
    expect(poisoned.patterns.map((p) => p.predicates)).toEqual(
      baseline.patterns.map((p) => p.predicates),
    );
    expect(poisoned.eligible).toBe(false);
    expect(poisoned.gates.falsePositives).toBe(false);
  });
  it("late feedback never leaks into earlier training and duplicate sessions are rejected", () => {
    const { rows, options } = discoveryFixture();
    for (const row of rows) row.confirmedAt = options.now - 1;
    const model = discoverPatterns(rows, options);
    expect(model.metrics.training.positives).toBe(0);
    expect(model.eligible).toBe(false);
    expect(() => discoverPatterns([...rows, rows[0]!], options)).toThrow(
      /duplicate/,
    );
  });
  it("one prolific contributor cannot meet diversity requirements", () => {
    const { rows, options } = discoveryFixture();
    const model = discoverPatterns(
      rows.filter(
        (r) =>
          r.tenantId === "tenant-0" ||
          options.holdoutTenants.includes(r.tenantId),
      ),
      options,
    );
    expect(model.gates.trainingDiversity).toBe(false);
    expect(model.eligible).toBe(false);
  });
  it("unconsented, expired and unknown labels cannot train or become assistant proof", () => {
    const { rows, options } = discoveryFixture();
    for (const row of rows) row.trainingAllowed = false;
    const model = discoverPatterns(rows, options);
    expect(model.patterns).toEqual([]);
    expect(model.eligible).toBe(false);
    expect(() =>
      discoverPatterns([{ ...rows[0]!, target: "login" } as never], options),
    ).toThrow();
  });
});
