import { describe, it, expect } from "vitest";
import { replayBehavior } from "../scripts/benchmarks/external/behavior.js";
import type { ReplayEvent } from "../scripts/benchmarks/external/behavior.js";
import { sourceNames } from "../scripts/benchmarks/external/sources.js";

describe("external dataset projection", () => {
  it("uses production aggregates and gates sparse evidence", () => {
    expect(replayBehavior([["mousemove", 10, 1, 1]])).toEqual({});
    const events: ReplayEvent[] = Array.from({ length: 21 }, (_, i) => [
      "mousemove",
      i * 100,
      i ? 10 : 0,
      0,
    ]);
    expect(replayBehavior(events)).toEqual({
      observation_duration_ms: 2000,
      mouse_event_count: 20,
      mouse_speed: 100,
      mouse_turn_ratio: 0,
      mouse_pause_ratio: 0,
    });
  });
  it("never turns absent events into automation evidence", () => {
    expect(replayBehavior([])).toEqual({});
  });
  it("resets interval state across recorded page changes", () => {
    const events: ReplayEvent[] = [];
    for (let page = 0; page < 2; page++) {
      events.push(["reset", 0]);
      for (let i = 0; i < 6; i++) events.push(["keydown", i * 100]);
    }
    expect(replayBehavior(events)).toEqual({
      observation_duration_ms: 1000,
      interaction_sample_count: 10,
      interaction_mean_ms: 100,
      interaction_cv: 0,
    });
  });
  it("only accepts pinned datasets", () => {
    expect(sourceNames("all")).toHaveLength(3);
    expect(() => sourceNames("../../production")).toThrow();
  });
});
