import {
  createLearningService,
  createLearningOperator,
  createWorkersNetworkEvaluator,
  createWorkersClassifierEvaluator,
} from "@aarondovturkel/doorman-network/server";
import { createD1NetworkStorage } from "@aarondovturkel/doorman-network/d1";
import type { NetworkD1Database } from "@aarondovturkel/doorman-network/d1";
export interface Env {
  NETWORK: NetworkD1Database;
  AI: { run(model: string, input: unknown): Promise<unknown> };
  OPERATOR_KEY_HASH?: string;
  JEV_ENABLED?: string;
  MAX_EVALUATIONS_PER_DAY?: string;
  MAX_EVALUATIONS_LIFETIME?: string;
  DISCOVERY_HOLDOUT_TENANTS?: string;
}
const services = new WeakMap<Env, ReturnType<typeof createLearningService>>();
function service(env: Env) {
  const existing = services.get(env);
  if (existing) return existing;
  const created = createLearningService(createD1NetworkStorage(env.NETWORK), {
    evaluator:
      env.JEV_ENABLED === "true"
        ? createWorkersNetworkEvaluator(env.AI)
        : undefined,
    classifierEvaluator:
      env.JEV_ENABLED === "true"
        ? createWorkersClassifierEvaluator(env.AI)
        : undefined,
    evaluatorVersion: "jev-network-questions-v1",
    maxEvaluationsPerDay: Number(env.MAX_EVALUATIONS_PER_DAY ?? 0),
    maxEvaluationsLifetime: Number(env.MAX_EVALUATIONS_LIFETIME ?? 0),
  });
  services.set(env, created);
  return created;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const learning = service(env);
    if (new URL(request.url).pathname.startsWith("/operator/")) {
      if (!env.OPERATOR_KEY_HASH)
        return Response.json(
          { error: "Operator API disabled" },
          { status: 503 },
        );
      return createLearningOperator(learning, env.OPERATOR_KEY_HASH)(request);
    }
    return learning.handle(request);
  },
  async scheduled(event: { scheduledTime?: number }, env: Env): Promise<void> {
    const learning = service(env);
    for (let page = 0; page < 4; page++) await learning.cleanup();
    // Hourly bounded retention, one discovery pass daily at 03:15 UTC.
    if (new Date(event.scheduledTime ?? Date.now()).getUTCHours() !== 3) return;
    const holdouts: unknown = JSON.parse(env.DISCOVERY_HOLDOUT_TENANTS ?? "[]");
    if (
      !Array.isArray(holdouts) ||
      holdouts.length < 3 ||
      holdouts.length > 10 ||
      !holdouts.every(
        (t) => typeof t === "string" && /^tenant_[a-f0-9]{32}$/.test(t),
      )
    )
      return;
    const now = Date.now();
    for (const target of ["assistant", "abuse"] as const)
      await learning.discover({
        target,
        trainingBefore: now - 14 * 86_400_000,
        validationBefore: now - 7 * 86_400_000,
        holdoutTenants: holdouts,
      });
    // Discovery creates shadow artifacts only. Promotion is an explicit operator action.
  },
};
