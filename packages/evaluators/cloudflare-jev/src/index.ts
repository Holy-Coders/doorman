import type { VisitorEvaluator } from "@janitor/core";
import { createJevInput, parseJevResponse } from "@janitor/evaluator-jev";

export interface WorkersAI {
  run(
    model: "typesafe/jev",
    input: ReturnType<typeof createJevInput>,
  ): Promise<unknown>;
}
export function createCloudflareJevEvaluator(
  ai: WorkersAI,
  options: { timeoutMs?: number } = {},
): VisitorEvaluator {
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid Workers AI timeout");
  return {
    async evaluate(input) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          ai.run("typesafe/jev", createJevInput(input)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Workers AI timeout")),
              timeoutMs,
            );
          }),
        ]);
        return parseJevResponse(response);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
