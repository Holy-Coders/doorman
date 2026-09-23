import { z } from "zod";
import { parseFeatures } from "./schema.js";
import type { FeatureVector } from "./schema.js";
import { readJSON } from "./http.js";
import {
  CLASSIFIER_FEATURE_VERSION,
  JEV_FEATURE_NAMES,
  jevFeatureResultSchema,
} from "./classifier-schema.js";
import type { JevFeatureResult } from "./classifier-schema.js";

export const CLASSIFIER_JEV_MODEL = "jev-1.13.0";
const context =
  "Use only these bounded, spoofable aggregate measurements. Missing means unknown, not suspicious. Do not infer identity, intent, authorization or provider. A telemetry route alone proves nothing. Accessibility tools, privacy tools, API clients, polling and retries are ordinary environments. Return a bounded strength of technical evidence, not an outcome label. ";
export const CLASSIFIER_QUESTIONS = {
  jev_regular_timing: {
    type: "noul",
    instructions:
      context +
      "How strong is evidence of regularly scheduled requests? Handler duration is server processing time; only request gaps describe timing between requests.",
  },
  jev_repeated_workflow: {
    type: "noul",
    instructions:
      context +
      "How strong is evidence of a repetitive programmatic workflow from aggregate route and transition shares, corroborated by request counts? Ordinary app flows also repeat.",
  },
  jev_mechanical_input: {
    type: "noul",
    instructions:
      context +
      "How strong is affirmative evidence of mechanical interaction from available aggregate input summaries? Missing mouse movement is not evidence. Regular accessibility input is not proof of an assistant.",
  },
  jev_abuse_evidence: {
    type: "noul",
    instructions:
      context +
      "How strong is affirmative evidence of potentially abusive request patterns from corroborated denial/error rates and request volume? Automation, speed or regularity alone is not abuse.",
  },
} as const;
export type ClassifierFeatureEvaluator = (
  features: FeatureVector,
) => Promise<JevFeatureResult>;
export function createClassifierJevMethods(
  transport: (input: {
    state: { features: FeatureVector };
    questions: typeof CLASSIFIER_QUESTIONS;
  }) => Promise<unknown>,
  model = CLASSIFIER_JEV_MODEL,
): ClassifierFeatureEvaluator {
  if (!/^jev-\d+\.\d+\.\d+$/.test(model))
    throw new Error("Pin an exact Jev model version");
  return async (features) => {
    const value = z
      .object({
        model: z.literal(model),
        answers: z.record(
          z.string(),
          z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
        ),
      })
      .parse(
        await transport({
          state: { features: parseFeatures(features) },
          questions: CLASSIFIER_QUESTIONS,
        }),
      );
    return jevFeatureResultSchema.parse({
      version: CLASSIFIER_FEATURE_VERSION,
      providerModel: value.model,
      values: Object.fromEntries(
        JEV_FEATURE_NAMES.map((name) => [name, value.answers[name]?.noul]),
      ),
    });
  };
}
export function createClassifierJevEvaluator(options: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): ClassifierFeatureEvaluator {
  if (!options.apiKey.trim()) throw new Error("Jev API key required");
  const model = options.model ?? CLASSIFIER_JEV_MODEL,
    timeout = options.timeoutMs ?? 1200;
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 5000)
    throw new Error("Invalid timeout");
  return createClassifierJevMethods(async (input) => {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, ...input }),
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Jev unavailable");
    }
    return readJSON(response.body, 32768, timeout);
  }, model);
}
export function createWorkersClassifierEvaluator(
  ai: { run(model: string, input: unknown): Promise<unknown> },
  model = CLASSIFIER_JEV_MODEL,
): ClassifierFeatureEvaluator {
  return createClassifierJevMethods(async (input) => {
    const response = await ai.run("typesafe/jev", input);
    if (response && typeof response === "object" && "state" in response)
      return z
        .object({ state: z.literal("Completed"), result: z.unknown() })
        .parse(response).result;
    return response;
  }, model);
}
