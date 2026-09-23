import type { VisitorEvaluator } from "@aarondovturkel/doorman-core";
import { createJevMethods } from "@aarondovturkel/doorman-evaluator-jev";
import type { JevRequest } from "@aarondovturkel/doorman-evaluator-jev";

export interface WorkersAI {
  run(model: "typesafe/jev", input: JevRequest): Promise<unknown>;
}

/** Workers AI's third-party transport can wrap the typed Jev response. */
export function unwrapCloudflareJevResponse(value: unknown): unknown {
  if (value && typeof value === "object" && "state" in value) {
    const response = value as { state?: unknown; result?: unknown };
    if (
      response.state !== "Completed" ||
      !response.result ||
      typeof response.result !== "object"
    )
      throw new Error("Incomplete Workers AI Jev response");
    return response.result;
  }
  // Also accept the unwrapped format shown in Cloudflare's model documentation.
  return value;
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
      return unwrapCloudflareJevResponse(response);
    } finally {
      clearTimeout(timer);
    }
  });
}
