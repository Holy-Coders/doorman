import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJevEvaluator,
  createJevInput,
  createRiskInput,
  createJevMethods,
  JEV_ENDPOINT,
  JEV_QUESTIONS,
} from "@janitor/evaluator-jev";
import { createCloudflareJevEvaluator } from "@janitor/evaluator-cloudflare-jev";
import { createVisitorEngine, normalizeObservation } from "@janitor/core";
import { createMemoryStorage } from "./helpers/memory.js";
import { evaluation, signals } from "./helpers/fixtures.js";
export const jevResponse = {
  model: "jev-1.13.0",
  answers: Object.fromEntries(
    Object.entries(evaluation).map(([name, noul]) => [
      name,
      { type: "noul", noul },
    ]),
  ),
  usage: { input_tokens: 400, output_tokens: 30 },
};
const input = {
  history: [normalizeObservation(signals)],
  current: normalizeObservation(signals),
  deterministicSimilarity: 1,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("documented Jev contracts", () => {
  it("uses direct System One Noul questions and reads noul probabilities", async () => {
    const fetch = vi.fn(async () => Response.json(jevResponse));
    vi.stubGlobal("fetch", fetch);
    expect(
      await createJevEvaluator({ apiKey: "test-key" }).evaluate(input),
    ).toEqual(evaluation);
    expect(fetch).toHaveBeenCalledWith(
      JEV_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
      }),
    );
    const options = (
      fetch.mock.calls as unknown as [string, RequestInit][]
    )[0]?.[1];
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("jev-latest");
    expect(body.questions.sameVisitor.type).toBe("noul");
    expect(body.state.history[0].screen).toBe("900x1440");
    expect(body.state.current.userAgent).toBeUndefined();
    expect(body.state.evidence[0].samePlatform).toBe(true);
  });
  it("uses Workers AI binding directly without a TypeSafe key", async () => {
    const ai = { run: vi.fn(async () => jevResponse) };
    expect(await createCloudflareJevEvaluator(ai).evaluate(input)).toEqual(
      evaluation,
    );
    expect(ai.run).toHaveBeenCalledWith("typesafe/jev", createJevInput(input));
  });
  it("reads the completed envelope returned by the live Workers AI third-party transport", async () => {
    const ai = {
      run: async () => ({
        state: "Completed",
        result: jevResponse,
        gatewayMetadata: { keySource: "Unified" },
      }),
    };
    expect(await createCloudflareJevEvaluator(ai).evaluate(input)).toEqual(
      evaluation,
    );
  });
  it.each([
    { state: "Pending", result: jevResponse },
    { state: "Failed", result: jevResponse },
    {
      state: "Completed",
      result: { answers: { automation: { type: "noul", noul: 9 } } },
    },
  ])(
    "does not accept incomplete or malformed gateway envelopes",
    async (response) => {
      await expect(
        createCloudflareJevEvaluator({ run: async () => response }).evaluate(
          input,
        ),
      ).rejects.toThrow();
    },
  );
  it("sends compact identity history separately from current risk behavior", () => {
    const behavior = {
      pageAgeMs: 1,
      mouseMoveCount: 0,
      pointerDownCount: 0,
      keyDownCount: 0,
      scrollCount: 0,
      visibilityChangeCount: 0,
    };
    const payload = createJevInput({
      ...input,
      history: Array(20).fill(input.current),
      current: { ...input.current, behavior },
    });
    expect(payload.state.history).toHaveLength(5);
    expect(payload.state.current.behavior).toBeUndefined();
    const risk = createRiskInput({ ...input.current, behavior });
    expect(risk.state.current.behavior).toEqual(behavior);
    expect(risk.state).not.toHaveProperty("history");
    expect(risk.questions).not.toHaveProperty("sameVisitor");
    expect(JEV_QUESTIONS.automation.instructions).toContain(
      "lack of mouse movement alone must not imply automation",
    );
    expect(JEV_QUESTIONS.suspicious.instructions).toContain(
      "Privacy-focused browsers",
    );
  });
  it.each([500, 429, 529])(
    "fails open through core on HTTP %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("provider failure", { status })),
      );
      const storage = createMemoryStorage();
      const id = await storage.createVisitor();
      await storage.saveObservation(id, input.current);
      const engine = createVisitorEngine({
        storage,
        evaluator: createJevEvaluator({ apiKey: "test" }),
      });
      expect(await engine.identify({ signals })).toMatchObject({
        visitorId: id,
        risk: { automation: 0, suspicious: 0 },
      });
    },
  );
  it.each([
    {},
    { answers: { sameVisitor: { type: "noul", noul: 1 } } },
    {
      ...jevResponse,
      answers: {
        ...jevResponse.answers,
        automation: { type: "noul", noul: "0.5" },
      },
    },
    {
      ...jevResponse,
      answers: {
        ...jevResponse.answers,
        suspicious: { type: "noul", noul: 2 },
      },
    },
    {
      ...jevResponse,
      answers: {
        ...jevResponse.answers,
        sameVisitor: { type: "score", noul: 1 },
      },
    },
  ])("rejects malformed typed responses", async (response) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(response)),
    );
    await expect(
      createJevEvaluator({ apiKey: "test" }).evaluate(input),
    ).rejects.toThrow();
    await expect(
      createCloudflareJevEvaluator({ run: async () => response }).evaluate(
        input,
      ),
    ).rejects.toThrow();
  });
  it("keeps the direct timeout active while reading the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, options: RequestInit) =>
          new Response(
            new ReadableStream({
              start(controller) {
                options.signal?.addEventListener(
                  "abort",
                  () => controller.error(new Error("aborted")),
                  { once: true },
                );
              },
            }),
          ),
      ),
    );
    await expect(
      createJevEvaluator({ apiKey: "test", timeoutMs: 20 }).evaluate(input),
    ).rejects.toThrow("aborted");
  });
  it("bounds direct provider response size before JSON decoding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(65537))),
    );
    await expect(
      createJevEvaluator({ apiKey: "test" }).evaluate(input),
    ).rejects.toThrow("64 KiB");
  });
  it("times out a stalled Workers AI binding", async () => {
    vi.useFakeTimers();
    const result = createCloudflareJevEvaluator(
      { run: () => new Promise(() => {}) },
      { timeoutMs: 20 },
    ).evaluate(input);
    const assertion = expect(result).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
  it("late evaluator completion does not mutate persistence after fallback", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const save = vi.spyOn(storage, "saveObservation");
    const engine = createVisitorEngine({
      storage,
      evaluatorTimeoutMs: 20,
      evaluator: {
        evaluate: () =>
          new Promise((resolve) => setTimeout(() => resolve(evaluation), 100)),
      },
    });
    const result = engine.identify({ signals });
    await vi.advanceTimersByTimeAsync(25);
    expect((await result).risk).toEqual({ automation: 0, suspicious: 0 });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledOnce();
  });
});

it("identity payload is invariant to current and historical automation, runtime and behavior", async () => {
  const calls: unknown[] = [];
  const evaluator = createJevMethods(async (input) => {
    calls.push(JSON.parse(JSON.stringify(input)));
    return jevResponse;
  });
  await evaluator.evaluate(input);
  const altered = {
    ...input.current,
    automation: { webdriver: true },
    behavior: {
      pageAgeMs: 50000,
      mouseMoveCount: 1000,
      keyDownCount: 1,
      pointerDownCount: 2,
      scrollCount: 3,
      visibilityChangeCount: 99,
    },
    environment: { runtimeMarkerCount: 1 },
  };
  await evaluator.evaluate({ ...input, history: [altered], current: altered });
  expect(calls[0]).toEqual(calls[2]);
  expect(calls[1]).not.toEqual(calls[3]);
  expect(JSON.stringify(calls[0])).not.toContain("webdriverDetected");
  expect(evaluator.requestCosts?.evaluate).toBe(2);
});
it("does not release a compound evaluation while its other provider call is pending", async () => {
  let finish!: (v: unknown) => void;
  const evaluator = createJevMethods(async (input) => {
    if (input.questions.sameVisitor) throw Error("identity unavailable");
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  let settled = false;
  const result = evaluator.evaluate(input).finally(() => {
    settled = true;
  });
  const assertion = expect(result).rejects.toThrow("identity unavailable");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  finish(jevResponse);
  await assertion;
});
