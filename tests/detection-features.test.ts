import { describe, expect, it } from "vitest";
import { createExtendedBehavior } from "../packages/browser/src/behavior.js";
import { extractFeatures } from "../packages/network/src/features.js";
import { payloadSchema } from "../packages/adapters/src/validation.js";
import { operatorEvidenceSchema } from "../packages/adapters/src/operators.js";
import { createOperatorInput } from "../packages/evaluators/jev/src/operators.js";
import { hasOperatorEvidence } from "@aarondovturkel/doorman-core";

describe("optional aggregate detection evidence", () => {
  it("summarizes large steps and short/repeated gaps without reading event content", () => {
    let time = 0;
    const tracker = createExtendedBehavior(() => time);
    for (let i = 0; i < 30; i++) {
      time = i * 50;
      for (const event of [
        Object.assign(new Event("mousemove"), { movementX: 200, movementY: 0 }),
        new Event("keydown"),
      ]) {
        for (const key of ["key", "code", "target", "clientX", "clientY"])
          Object.defineProperty(event, key, {
            get() {
              throw new Error("Content accessed");
            },
          });
        tracker.observe(event);
      }
    }
    const behavior = {
      pageAgeMs: 10000,
      mouseMoveCount: 30,
      pointerDownCount: 0,
      keyDownCount: 30,
      scrollCount: 0,
      visibilityChangeCount: 0,
      ...tracker.snapshot(),
    };
    expect(payloadSchema.parse({ signals: {}, behavior }).behavior).toEqual(
      behavior,
    );
    const features = extractFeatures({ behavior });
    expect(features).toMatchObject({
      mouse_step_mean_px: 200,
      mouse_large_step_ratio: 1,
      mouse_interval_cv: 0,
      interaction_short_gap_ratio: 1,
      interaction_repeat_gap_ratio: 1,
    });
    const evidence = operatorEvidenceSchema.parse({
      source: "browser",
      features,
    });
    expect(hasOperatorEvidence(evidence)).toBe(true);
    expect(
      JSON.stringify(
        createOperatorInput({
          current: evidence,
          candidates: [],
          families: [],
        }),
      ),
    ).toContain("mouse_large_step_ratio");
  });
  it("ignores held-key repeats, invalid movement and visibility discontinuities", () => {
    let time = 0;
    const tracker = createExtendedBehavior(() => time);
    tracker.observe(new Event("keydown"));
    time = 50;
    tracker.observe(Object.assign(new Event("keydown"), { repeat: true }));
    tracker.observe(
      Object.assign(new Event("mousemove"), {
        movementX: Infinity,
        movementY: 0,
      }),
    );
    tracker.observe(new Event("blur"));
    time = 100;
    tracker.observe(new Event("keydown"));
    expect(tracker.snapshot()).toMatchObject({
      interactionIntervalCount: 0,
      mouseSampleCount: 0,
      interactionComparableGapCount: 0,
    });
    expect(
      extractFeatures({
        behavior: {
          pageAgeMs: 10000,
          mouseMoveCount: 0,
          pointerDownCount: 0,
          keyDownCount: 0,
          scrollCount: 0,
          visibilityChangeCount: 0,
          ...tracker.snapshot(),
        },
      }),
    ).toEqual({});
  });
  it("keeps webdriver as separate optional technical evidence, never enough for an operator label", () => {
    expect(extractFeatures({})).toEqual({});
    const features = extractFeatures({
      observation: { automation: { webdriver: true } },
    });
    expect(features).toEqual({ webdriver: 1 });
    expect(hasOperatorEvidence({ source: "browser", features })).toBe(false);
    expect(() =>
      operatorEvidenceSchema.parse({
        source: "browser",
        features: { webdriver: 2 },
      }),
    ).toThrow();
  });
});
