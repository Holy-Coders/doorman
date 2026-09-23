import { describe, expect, it, vi } from "vitest";
import { createVisitorEngine, normalizeObservation } from "@aarondovturkel/doorman-core";
import type { LearningExample } from "@aarondovturkel/doorman-core";
import { createJevMethods } from "@aarondovturkel/doorman-evaluator-jev";
import { createCloudflareJevEvaluator } from "@aarondovturkel/doorman-evaluator-cloudflare-jev";
import { createMemoryStorage } from "./helpers/memory.js";
import { signals, phone } from "./helpers/fixtures.js";

const current = normalizeObservation(signals);
const answer = (values: Record<string, number>) => ({
  answers: Object.fromEntries(
    Object.entries(values).map(([key, noul]) => [key, { type: "noul", noul }]),
  ),
});
const examples = (subjectId: string): LearningExample[] =>
  [0, 1].map((i) => ({
    subjectId,
    sessionId: `${subjectId}-${i}`,
    observation: current,
    observedAt: 100 + i,
    verifiedAt: 200 + i,
  }));

describe("bounded Jev intelligence", () => {
  it("uses only typed lookup decisions and rejects malformed probabilities", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(answer({ graphics: 0.1, locale: 0.9 }))
      .mockResolvedValueOnce(answer({ graphics: 2, locale: 0.9 }));
    const evaluator = createJevMethods(request);
    expect(await evaluator.planLookup!(current)).toEqual({
      graphics: false,
      locale: true,
    });
    await expect(evaluator.planLookup!(current)).rejects.toThrow("Malformed");
    expect(request.mock.calls[0]![0].state.current).not.toHaveProperty(
      "userAgent",
    );
  });
  it("batches identity histories separately from risk and binds each candidate index", async () => {
    const request = vi.fn(async () =>
      answer({
        automation: 0.2,
        suspicious: 0.1,
        ...Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`candidate${i}`, i / 10]),
        ),
      }),
    );
    const result = await createJevMethods(request).evaluateCandidates!({
      current,
      candidates: Array.from({ length: 10 }, () => ({
        history: [current],
        deterministicSimilarity: 0.9,
      })),
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(10);
    expect(result[9]!.sameVisitor).toBe(0.9);
    const input = request.mock.calls[0] as unknown as [
      { questions: Record<string, { instructions: string }> },
    ];
    expect(input[0].questions.candidate9!.instructions).toContain(
      "candidates[9]",
    );
  });
  it("evaluates the full shortlist in the real engine and keeps ambiguity protection", async () => {
    const storage = createMemoryStorage();
    for (let i = 0; i < 10; i++)
      await storage.saveObservation(await storage.createVisitor(), current);
    const planLookup = vi.fn(async () => ({ graphics: false, locale: true }));
    const evaluateCandidates = vi.fn(async (input: { candidates: unknown[] }) =>
      input.candidates.map(() => ({
        sameVisitor: 0.99,
        automation: 0.1,
        suspicious: 0.1,
      })),
    );
    const evaluate = vi.fn();
    const find = vi.spyOn(storage, "findCandidates");
    const result = await createVisitorEngine({
      storage,
      evaluator: { evaluate, planLookup, evaluateCandidates },
    }).identify({ signals });
    expect(find).toHaveBeenCalledWith(current, 10, {
      graphics: false,
      locale: true,
    });
    expect(evaluateCandidates.mock.calls[0]![0].candidates).toHaveLength(10);
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.isReturning).toBe(false);
  });
  it("keeps contradictory devices out of batch evaluation", async () => {
    const storage = createMemoryStorage();
    await storage.saveObservation(
      await storage.createVisitor(),
      normalizeObservation(phone),
    );
    const evaluateCandidates = vi.fn();
    await createVisitorEngine({
      storage,
      evaluator: {
        evaluate: async () => ({
          sameVisitor: 1,
          automation: 0,
          suspicious: 0,
        }),
        evaluateCandidates,
      },
    }).identify({ signals });
    expect(evaluateCandidates).not.toHaveBeenCalled();
  });
  it("falls back after planner and batch failures without per-candidate retries", async () => {
    const storage = createMemoryStorage();
    const id = await storage.createVisitor();
    await storage.saveObservation(id, current);
    const evaluate = vi.fn();
    const result = await createVisitorEngine({
      storage,
      evaluatorTimeoutMs: 5,
      evaluator: {
        evaluate,
        planLookup: () => new Promise(() => {}),
        evaluateCandidates: async () => {
          throw Error("offline");
        },
      },
    }).identify({ signals });
    expect(result.visitorId).toBe(id);
    expect(result.riskStatus).toBe("unavailable");
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("falls back to all probes when a restricted lookup returns no candidates", async () => {
    const storage = createMemoryStorage();
    const find = vi.spyOn(storage, "findCandidates");
    const evaluator = createJevMethods(async (input) =>
      answer(
        Object.fromEntries(Object.keys(input.questions).map((k) => [k, 0])),
      ),
    );
    await createVisitorEngine({ storage, evaluator }).identify({ signals });
    expect(find).toHaveBeenCalledTimes(2);
  });
  it("does not plan a known-cookie lookup", async () => {
    const storage = createMemoryStorage();
    const id = await storage.createVisitor();
    await storage.saveObservation(id, current);
    const planLookup = vi.fn();
    await createVisitorEngine({
      storage,
      evaluator: {
        planLookup,
        evaluate: async () => ({
          sameVisitor: 1,
          automation: 0,
          suspicious: 0,
        }),
      },
    }).identify({ signals, visitorId: id });
    expect(planLookup).not.toHaveBeenCalled();
  });
  it("uses login-confirmed examples with opaque per-request candidate indexes", async () => {
    const request = vi.fn(async () => answer({ person0: 0.96, person1: 0.1 }));
    const result = await createJevMethods(request).predictIdentity!({
      current: normalizeObservation(phone),
      examples: [...examples("private-alex"), ...examples("private-sam")],
    });
    expect(result).toEqual({ subjectId: "private-alex", score: 0.96 });
    expect(JSON.stringify(request.mock.calls)).not.toMatch(
      /private-alex|private-sam|sessionId|subjectId/,
    );
  });
  it("abstains during cold start and when people are equally plausible", async () => {
    const request = vi.fn(async () => answer({ person0: 0.99, person1: 0.96 }));
    const evaluator = createJevMethods(request);
    expect(
      await evaluator.predictIdentity!({
        current,
        examples: examples("one").slice(0, 1),
      }),
    ).toEqual({});
    expect(request).not.toHaveBeenCalled();
    expect(
      await evaluator.predictIdentity!({
        current,
        examples: [...examples("one"), ...examples("two")],
      }),
    ).toEqual({});
  });
  it("abstains rather than ignoring eligible people outside the model budget", async () => {
    const request = vi.fn();
    expect(
      await createJevMethods(request).predictIdentity!({
        current,
        examples: Array.from({ length: 11 }, (_, i) =>
          examples(String(i)),
        ).flat(),
      }),
    ).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });
  it("supports the same stages through Workers AI", async () => {
    const run = vi.fn(async (model: string) => {
      expect(model).toBe("typesafe/jev");
      return answer({ graphics: 0.9, locale: 0.9 });
    });
    expect(
      await createCloudflareJevEvaluator({ run }).planLookup!(current),
    ).toEqual({ graphics: true, locale: true });
    expect(run.mock.calls[0]![0]).toBe("typesafe/jev");
  });
});
