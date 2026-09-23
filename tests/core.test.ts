import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateSimilarity,
  createVisitorEngine,
  normalizeObservation,
  VisitorStorageError,
  evidenceCap,
} from "@aarondovturkel/doorman-core";
import { createMemoryStorage } from "./helpers/memory.js";
import { evaluation, phone, signals } from "./helpers/fixtures.js";

afterEach(() => vi.useRealTimers());
function setup() {
  const storage = createMemoryStorage();
  const evaluator = { evaluate: vi.fn(async () => evaluation) };
  const engine = createVisitorEngine({ storage, evaluator, debug: true });
  return { storage, evaluator, engine };
}
describe("identity", () => {
  it("creates a cryptographically opaque visitor on first visit", async () => {
    const { engine, storage } = setup();
    const first = await engine.identify({ signals });
    expect(first).toMatchObject({
      isReturning: false,
      confidence: 0,
      risk: { automation: 0.12, suspicious: 0.08 },
    });
    expect(first.visitorId).toMatch(/^vis_[a-f0-9]{48}$/);
    expect(storage.rows.size).toBe(1);
    expect(first.debug).toBeUndefined();
  });
  it("uses a known cookie without global candidate search, even when signals change", async () => {
    const { engine, storage } = setup();
    const first = await engine.identify({ signals });
    const search = vi.spyOn(storage, "findCandidates");
    const returning = await engine.identify({
      signals: phone,
      visitorId: first.visitorId,
    });
    expect(returning).toMatchObject({
      visitorId: first.visitorId,
      confidence: 1,
      isReturning: true,
    });
    expect(search).not.toHaveBeenCalled();
  });
  it.each([
    [
      "minor browser update",
      { ...signals, userAgent: signals.userAgent?.replace("130.0", "131.1") },
    ],
    [
      "screen orientation",
      { ...signals, screen: { ...signals.screen, width: 900, height: 1440 } },
    ],
    ["viewport resize", { ...signals, viewport: { width: 450, height: 600 } }],
    ["timezone change", { ...signals, timezone: "Europe/London" }],
    ["missing WebGL", { ...signals, graphics: undefined }],
    ["identical historical signals without cookie", signals],
  ])("restores after %s", async (_name, current) => {
    const { engine } = setup();
    const first = await engine.identify({ signals });
    const second = await engine.identify({ signals: current });
    expect(second.visitorId).toBe(first.visitorId);
    expect(second.isReturning).toBe(true);
    expect(second.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("slightly reduces deterministic confidence for timezone changes", () => {
    const a = normalizeObservation(signals);
    expect(
      calculateSimilarity(
        a,
        normalizeObservation({ ...signals, timezone: "Europe/London" }),
      ).score,
    ).toBeCloseTo(0.95);
  });
  it("does not merge clearly different devices even with an enthusiastic evaluator", async () => {
    const { engine, evaluator } = setup();
    const first = await engine.identify({ signals });
    evaluator.evaluate.mockClear();
    const second = await engine.identify({ signals: phone });
    expect(second.visitorId).not.toBe(first.visitorId);
    expect(evaluator.evaluate).toHaveBeenCalledOnce();
    expect(evaluator.evaluate.mock.calls[0]).toMatchObject([{ history: [] }]);
  });
  it("caps contradictory evidence and excludes risk from similarity", () => {
    const a = normalizeObservation(signals);
    expect(evidenceCap(a, normalizeObservation(phone))).toBeLessThanOrEqual(
      0.5,
    );
    expect(
      calculateSimilarity(
        a,
        normalizeObservation({ ...signals, automation: { webdriver: true } }),
      ).score,
    ).toBeCloseTo(1);
  });
  it("does not merge sparse observations", async () => {
    const { engine } = setup();
    const a = await engine.identify({ signals: { platform: "MacIntel" } });
    const b = await engine.identify({ signals: { platform: "MacIntel" } });
    expect(b.visitorId).not.toBe(a.visitorId);
  });
  it("never treats empty observations as identical evidence", () => {
    expect(calculateSimilarity({}, {}).score).toBe(0);
  });
  it("requires server and request debug opt-in", async () => {
    const { engine, storage } = setup();
    expect(
      (await engine.identify({ signals, debug: true })).debug,
    ).toBeDefined();
    expect(
      (
        await createVisitorEngine({ storage }).identify({
          signals,
          debug: true,
        })
      ).debug,
    ).toBeUndefined();
  });
  it("does not adopt unknown cookie IDs", async () => {
    const { engine } = setup();
    expect(
      (await engine.identify({ signals, visitorId: "vis_unknown" })).visitorId,
    ).not.toBe("vis_unknown");
  });
});
describe("candidate ranking", () => {
  it("bounds lookup to ten, history to five, and evaluator calls to three", async () => {
    const { engine, storage, evaluator } = setup();
    for (let i = 0; i < 20; i++) {
      const id = await storage.createVisitor();
      await storage.saveObservation(id, normalizeObservation(signals));
    }
    const find = vi.spyOn(storage, "findCandidates");
    const history = vi.spyOn(storage, "getRecentObservations");
    const result = await engine.identify({ signals, debug: true });
    expect(find).toHaveBeenCalledWith(expect.anything(), 10, undefined);
    expect(history.mock.calls.every((call) => call[1] === 5)).toBe(true);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(3);
    expect(result.debug?.candidateCount).toBe(10);
    expect(result.isReturning).toBe(false); // Identical devices are ambiguous.
  });
  it("ranks recent candidates first when similarity ties", async () => {
    const { engine, storage, evaluator } = setup();
    for (let i = 0; i < 4; i++) {
      const id = await storage.createVisitor();
      await storage.saveObservation(
        id,
        normalizeObservation({
          ...signals,
          userAgent: signals.userAgent?.replace("130.0", `${130 + i}.0`),
        }),
      );
      storage.rows.get(id)!.lastSeenAt = i;
    }
    await engine.identify({ signals });
    const calls = evaluator.evaluate.mock.calls as unknown as [
      { history: { userAgent: string }[] },
    ][];
    expect(calls[0]?.[0].history[0]?.userAgent).toContain("133.0");
  });
  it("matches a pattern in history instead of only the latest observation", async () => {
    const { engine, storage } = setup();
    const first = await engine.identify({ signals });
    await storage.saveObservation(
      first.visitorId,
      normalizeObservation({
        ...signals,
        screen: phone.screen,
        hardware: phone.hardware,
      }),
    );
    expect((await engine.identify({ signals })).visitorId).toBe(
      first.visitorId,
    );
  });
});
describe("risk and resilience", () => {
  it("webdriver is useful evidence without becoming an identity feature", () => {
    const result = calculateSimilarity(
      normalizeObservation(signals),
      normalizeObservation({ ...signals, automation: { webdriver: true } }),
    );
    expect(result.features.webdriverDetected).toBe(true);
    expect(result.score).toBeCloseTo(1);
  });
  it("passes only aggregate behavior through and does not infer automation from inactivity or missing APIs", async () => {
    const storage = createMemoryStorage();
    const engine = createVisitorEngine({ storage });
    const result = await engine.identify({
      signals: {},
      behavior: {
        pageAgeMs: 1000,
        mouseMoveCount: 0,
        pointerDownCount: 0,
        keyDownCount: 0,
        scrollCount: 0,
        visibilityChangeCount: 0,
      },
    });
    expect(result.risk).toEqual({ automation: 0, suspicious: 0 });
  });
  it("falls back after evaluator timeout", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const id = await storage.createVisitor();
    await storage.saveObservation(id, normalizeObservation(signals));
    const engine = createVisitorEngine({
      storage,
      evaluatorTimeoutMs: 25,
      evaluator: { evaluate: () => new Promise(() => {}) },
    });
    const pending = engine.identify({ signals });
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toMatchObject({
      visitorId: id,
      isReturning: true,
      risk: { automation: 0, suspicious: 0 },
    });
  });
  it.each(["exception", "malformed"] as const)(
    "falls back for %s evaluator output",
    async (mode) => {
      const storage = createMemoryStorage();
      const id = await storage.createVisitor();
      await storage.saveObservation(id, normalizeObservation(signals));
      const evaluator = {
        evaluate: async () => {
          if (mode === "exception") throw new Error("500");
          return { sameVisitor: NaN, automation: 2, suspicious: -1 };
        },
      };
      expect(
        await createVisitorEngine({ storage, evaluator }).identify({ signals }),
      ).toMatchObject({
        visitorId: id,
        isReturning: true,
        risk: { automation: 0, suspicious: 0 },
      });
    },
  );
  it("wraps storage failure in a controlled error", async () => {
    const { engine, storage } = setup();
    vi.spyOn(storage, "findCandidates").mockRejectedValue(
      new Error("database secret"),
    );
    await expect(engine.identify({ signals })).rejects.toThrow(
      VisitorStorageError,
    );
  });
  it("normalizes language ordering, empty values and platform aliases deterministically", () => {
    const a = normalizeObservation({
      platform: " Win32 ",
      languages: ["he", "EN-us", "", "he"],
      timezone: "  ",
    });
    expect(a).toMatchObject({
      platform: "windows",
      languages: ["en-us", "he"],
      timezone: undefined,
    });
  });
});

it("never uses risk probabilities to alter an identity match", async () => {
  const storage = createMemoryStorage();
  const engine = createVisitorEngine({
    storage,
    evaluator: {
      evaluate: async () => ({
        sameVisitor: 0.99,
        automation: 1,
        suspicious: 1,
      }),
    },
  });
  const first = await engine.identify({ signals });
  const second = await engine.identify({ signals });
  expect(second).toMatchObject({
    visitorId: first.visitorId,
    isReturning: true,
    risk: { automation: 1, suspicious: 1 },
  });
});

it("does not turn zero-valued hidden measurements into matching evidence", () => {
  const current = normalizeObservation({
    platform: "MacIntel",
    screen: { width: 0, height: 0 },
    hardware: { hardwareConcurrency: 0, deviceMemory: 0, maxTouchPoints: 0 },
  });
  expect(current.screen?.width).toBeUndefined();
  expect(current.hardware?.maxTouchPoints).toBe(0);
  expect(calculateSimilarity(current, current).score).toBeLessThan(0.5);
});

it("distinguishes disabled risk, unavailable risk and an evaluated zero score", async () => {
  for (const [evaluator, riskStatus] of [
    [undefined, "disabled"],
    [
      {
        evaluate: async () => {
          throw new Error("500");
        },
      },
      "unavailable",
    ],
    [
      {
        evaluate: async () => ({
          sameVisitor: 0,
          automation: 0,
          suspicious: 0,
        }),
      },
      "evaluated",
    ],
  ] as const) {
    const result = await createVisitorEngine({
      storage: createMemoryStorage(),
      evaluator,
    }).identify({ signals });
    expect(result).toMatchObject({
      riskStatus,
      risk: { automation: 0, suspicious: 0 },
    });
  }
});

it("uses bulk histories when storage supports them and respects truncated lookup evidence", async () => {
  const storage = createMemoryStorage();
  const first = await createVisitorEngine({ storage }).identify({ signals });
  const normalized = normalizeObservation(signals);
  const bulk = vi.fn(async () => ({ [first.visitorId]: [normalized] }));
  const single = vi.fn(storage.getRecentObservations);
  const engine = createVisitorEngine({
    storage: {
      ...storage,
      getRecentObservationsBatch: bulk,
      getRecentObservations: single,
      findCandidates: async () => [
        {
          visitorId: first.visitorId,
          lastSeenAt: Date.now(),
          lookupSaturated: true,
        },
      ],
    },
    evaluator: {
      evaluate: async () => ({ sameVisitor: 1, automation: 0, suspicious: 0 }),
    },
  });
  expect((await engine.identify({ signals })).isReturning).toBe(false);
  expect(bulk).toHaveBeenCalledOnce();
  expect(single).not.toHaveBeenCalled();
  expect(
    (await engine.identify({ signals, visitorId: first.visitorId })).visitorId,
  ).toBe(first.visitorId);
  expect(single).toHaveBeenCalledOnce();
});

it("does not let varying evaluator confidence erase an identical deterministic competitor", async () => {
  const storage = createMemoryStorage();
  for (let i = 0; i < 2; i++) {
    const id = await storage.createVisitor();
    await storage.saveObservation(id, normalizeObservation(signals));
  }
  let calls = 0;
  const engine = createVisitorEngine({
    storage,
    evaluator: {
      evaluate: async () => ({
        sameVisitor: calls++ === 0 ? 1 : 0,
        automation: 0,
        suspicious: 0,
      }),
    },
  });
  expect((await engine.identify({ signals })).isReturning).toBe(false);
});
