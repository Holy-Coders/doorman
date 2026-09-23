import type { VisitorEvaluator } from "@janitor/core";
import { createJevInput, parseJevResponse } from "./protocol.js";
export {
  createJevInput,
  parseJevResponse,
  compactObservation,
  JEV_QUESTIONS,
} from "./protocol.js";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export type JevOptions = { apiKey: string; model?: string; timeoutMs?: number };

export function createJevEvaluator(options: JevOptions): VisitorEvaluator {
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!options.apiKey?.trim()) throw new Error("A Jev API key is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid Jev timeout");
  return {
    async evaluate(input) {
      const response = await fetch(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? "jev-latest",
          ...createJevInput(input),
        }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Jev unavailable (${response.status})`);
      }
      // Timeout covers reading/parsing the body as well as receiving headers.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty Jev response");
      const decoder = new TextDecoder();
      let text = "",
        size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) throw new Error("Jev response exceeds 64 KiB");
          text += decoder.decode(value, { stream: true });
        }
        return parseJevResponse(JSON.parse(text + decoder.decode()));
      } finally {
        await reader.cancel().catch(() => {});
      }
    },
  };
}
