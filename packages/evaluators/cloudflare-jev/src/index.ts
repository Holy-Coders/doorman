import type { VisitorEvaluator } from "@janitor/core";
import { createJevMethods } from "@janitor/evaluator-jev";
import type { JevRequest } from "@janitor/evaluator-jev";

export interface WorkersAI {
  run(model: "typesafe/jev", input: JevRequest): Promise<unknown>;
}
export function createCloudflareJevEvaluator(
  ai: WorkersAI,
  options: { timeoutMs?: number } = {},
): VisitorEvaluator {
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid Workers AI timeout");
  return createJevMethods(async (input) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        ai.run("typesafe/jev", input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Workers AI timeout")),
            timeoutMs,
          );
        }),
      ]);
      return response;
    } finally {
      clearTimeout(timer);
    }
  });
}
