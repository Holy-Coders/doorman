import { afterEach, expect, it, vi } from "vitest";
import {
  createJevEvaluator,
  createJevMethods,
  createOperatorInput,
  OPERATOR_PROMPT_VERSION,
} from "@aarondovturkel/doorman-evaluator-jev";
import { createCloudflareJevEvaluator } from "@aarondovturkel/doorman-evaluator-cloudflare-jev";
import type { OperatorEvaluationInput } from "@aarondovturkel/doorman-core";
import { evidence } from "./helpers/operators.js";
const input: OperatorEvaluationInput = {
  current: evidence,
  candidates: [{ id: "secret-account-window", evidence }],
  families: [
    {
      family: "known-test-agent",
      version: "ref-v1",
      source: "controlled-study",
      expiresAt: Date.now() + 60000,
      examples: [evidence, evidence, evidence],
    },
  ],
};
const response = {
  model: "jev-1.13.0",
  answers: Object.fromEntries(
    Object.entries({
      human: 0.1,
      assistant: 0.98,
      automation: 0.1,
      abuse: 0.02,
      operator0: 0.95,
      family0: 0.96,
    }).map(([k, noul]) => [k, { type: "noul", noul }]),
  ),
};
afterEach(() => vi.unstubAllGlobals());
it("projects numeric evidence without persistent IDs, product names, or injected extra fields", () => {
  const request = createOperatorInput({
    ...input,
    current: {
      ...evidence,
      email: "private-email",
      features: { ...evidence.features, raw: "private-raw" },
    },
  } as unknown as OperatorEvaluationInput);
  expect(JSON.stringify(request)).not.toMatch(
    /secret-account|known-test-agent|private-email|private-raw/,
  );
  expect(request.state).toHaveProperty("families");
  expect(Object.keys(request.questions)).toHaveLength(6);
  expect(request.questions.operator0!.instructions).toContain(
    "same operating person or agent instance",
  );
});
it("uses the documented direct Jev request and maps answers back only on the server", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(response),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await createJevEvaluator({
    apiKey: "test-key",
    model: "jev-1.13.0",
  }).evaluateOperator!(input);
  expect(result.modelVersion).toBe(`jev-1.13.0/${OPERATOR_PROMPT_VERSION}`);
  expect(result.links).toEqual([
    { windowId: "secret-account-window", score: 0.95 },
  ]);
  expect(result.families).toEqual([
    { family: "known-test-agent", score: 0.96 },
  ]);
  expect(fetch.mock.calls[0]![0]).toBe("https://api.typesafe.ai/v1/systemone");
  expect(
    JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body)),
  ).toEqual({ model: "jev-1.13.0", ...createOperatorInput(input) });
});
it("supports the same operator questions through Workers AI, including its Completed wrapper", async () => {
  const run = vi.fn(async () => ({ state: "Completed", result: response }));
  const result = await createCloudflareJevEvaluator({ run }).evaluateOperator!(
    input,
  );
  expect(run).toHaveBeenCalledWith("typesafe/jev", createOperatorInput(input));
  expect(result.abuse).toBe(0.02);
});
it("rejects missing questions, out-of-range answers, missing version and oversized reference lists", async () => {
  for (const malformed of [
    { ...response, model: undefined },
    { ...response, answers: {} },
    {
      ...response,
      answers: { ...response.answers, abuse: { type: "noul", noul: 1.1 } },
    },
  ])
    await expect(
      createJevMethods(async () => malformed).evaluateOperator!(input),
    ).rejects.toThrow();
  expect(() =>
    createOperatorInput({
      ...input,
      candidates: Array.from({ length: 11 }, () => input.candidates[0]!),
    }),
  ).toThrow();
});
