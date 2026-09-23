import { normalizeObservation } from "./normalize.js";
import {
  calculateSimilarity,
  evidenceCap,
  hasContradiction,
} from "./similarity.js";
import type {
  BrowserBehavior,
  BrowserObservation,
  Evaluation,
  EvaluationInput,
  VisitorEvaluator,
  VisitorIdentity,
  VisitorStorage,
} from "./types.js";

export const MATCHING_DEFAULTS = {
  candidateLimit: 10,
  evaluationLimit: 3,
  historyLimit: 5,
  restoreThreshold: 0.9,
  candidateFloor: 0.65,
  ambiguityMargin: 0.03,
  deterministicWeight: 0.35,
  evaluatorWeight: 0.65,
  evaluatorTimeoutMs: 1200,
} as const;
export type IdentifyMetrics = {
  candidateCount: number;
  deterministicScore: number;
  finalConfidence: number;
  evaluatorUsed: boolean;
  evaluatorLatency: number;
  isReturning: boolean;
};
export type EngineOptions = {
  storage: VisitorStorage;
  evaluator?: VisitorEvaluator;
  evaluatorTimeoutMs?: number;
  restoreThreshold?: number;
  debug?: boolean;
  onMetrics?: (metrics: IdentifyMetrics) => void;
};
export class VisitorStorageError extends Error {
  constructor(cause: unknown) {
    super("Visitor storage is unavailable", { cause });
    this.name = "VisitorStorageError";
  }
}
export function isEvaluation(value: unknown): value is Evaluation {
  if (!value || typeof value !== "object") return false;
  return ["sameVisitor", "automation", "suspicious"].every((key) => {
    const n = (value as Record<string, unknown>)[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  });
}
export function createVisitorEngine(options: EngineOptions) {
  const { storage, evaluator } = options;
  const timeout =
    options.evaluatorTimeoutMs ?? MATCHING_DEFAULTS.evaluatorTimeoutMs;
  const threshold =
    options.restoreThreshold ?? MATCHING_DEFAULTS.restoreThreshold;
  if (
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    !Number.isFinite(threshold) ||
    threshold < 0.8 ||
    threshold > 1
  )
    throw new Error("Invalid matching options");

  async function evaluate(
    input: EvaluationInput,
  ): Promise<Evaluation | undefined> {
    if (!evaluator) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => evaluator.evaluate(input)),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeout);
        }),
      ]);
      return isEvaluation(result) ? result : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async identify(input: {
      signals: BrowserObservation;
      behavior?: BrowserBehavior;
      visitorId?: string;
      debug?: boolean;
    }): Promise<VisitorIdentity> {
      const current = normalizeObservation(input.signals, input.behavior);
      let candidateCount = 0;
      let deterministicScore = 0;
      let evaluatorUsed = false;
      let evaluatorLatency = 0;
      let risk = { automation: 0, suspicious: 0 };
      const run = async (data: EvaluationInput) => {
        const started = Date.now();
        const result = await evaluate(data);
        evaluatorLatency = Math.max(evaluatorLatency, Date.now() - started);
        evaluatorUsed ||= !!result;
        return result;
      };
      try {
        let visitorId: string | undefined;
        let confidence = 0;
        let isReturning = false;
        // A cookie is only recognized when storage still has a retained observation.
        const history = input.visitorId
          ? (
              await storage.getRecentObservations(
                input.visitorId,
                MATCHING_DEFAULTS.historyLimit,
              )
            ).slice(0, MATCHING_DEFAULTS.historyLimit)
          : [];
        if (input.visitorId && history.length) {
          visitorId = input.visitorId;
          isReturning = true;
          confidence = 1; // Continuity of the opaque cookie; never authentication.
          deterministicScore = Math.max(
            ...history.map(
              (previous) => calculateSimilarity(previous, current).score,
            ),
          );
          const result = await run({
            history,
            current,
            deterministicSimilarity: deterministicScore,
          });
          if (result)
            risk = {
              automation: result.automation,
              suspicious: result.suspicious,
            };
        } else {
          const candidates = (
            await storage.findCandidates(
              current,
              MATCHING_DEFAULTS.candidateLimit,
            )
          ).slice(0, MATCHING_DEFAULTS.candidateLimit);
          const unique = [
            ...new Map(
              candidates.map((candidate) => [candidate.visitorId, candidate]),
            ).values(),
          ];
          candidateCount = unique.length;
          const ranked = (
            await Promise.all(
              unique.map(async (candidate) => {
                const history = (
                  await storage.getRecentObservations(
                    candidate.visitorId,
                    MATCHING_DEFAULTS.historyLimit,
                  )
                ).slice(0, MATCHING_DEFAULTS.historyLimit);
                const best = history
                  .filter((previous) => !hasContradiction(previous, current))
                  .map((previous) => ({
                    score: calculateSimilarity(previous, current).score,
                    cap: evidenceCap(previous, current),
                  }))
                  .sort((a, b) => b.score - a.score)[0];
                return {
                  ...candidate,
                  history,
                  score: best?.score ?? 0,
                  cap: best?.cap ?? 0,
                };
              }),
            )
          )
            .filter(
              (candidate) =>
                candidate.score >= MATCHING_DEFAULTS.candidateFloor,
            )
            .sort(
              (a, b) =>
                b.score - a.score ||
                b.lastSeenAt - a.lastSeenAt ||
                a.visitorId.localeCompare(b.visitorId),
            );
          const evaluated = await Promise.all(
            ranked
              .slice(0, MATCHING_DEFAULTS.evaluationLimit)
              .map(async (candidate) => {
                const result = await run({
                  history: candidate.history,
                  current,
                  deterministicSimilarity: candidate.score,
                });
                const confidence = Math.min(
                  candidate.cap,
                  result
                    ? candidate.score * MATCHING_DEFAULTS.deterministicWeight +
                        result.sameVisitor * MATCHING_DEFAULTS.evaluatorWeight
                    : candidate.score,
                );
                return { ...candidate, result, confidence };
              }),
          );
          evaluated.sort(
            (a, b) =>
              b.confidence - a.confidence ||
              b.lastSeenAt - a.lastSeenAt ||
              a.visitorId.localeCompare(b.visitorId),
          );
          const best = evaluated[0];
          // Include unevaluated candidates in the ambiguity check so a tied fourth device is not hidden.
          const runnerUp = Math.max(
            evaluated[1]?.confidence ?? 0,
            ...ranked
              .slice(MATCHING_DEFAULTS.evaluationLimit)
              .map((candidate) => candidate.score),
          );
          if (best) {
            deterministicScore = best.score;
            if (best.result)
              risk = {
                automation: best.result.automation,
                suspicious: best.result.suspicious,
              };
            if (
              best.confidence >= threshold &&
              best.confidence - runnerUp >= MATCHING_DEFAULTS.ambiguityMargin
            ) {
              visitorId = best.visitorId;
              confidence = best.confidence;
              isReturning = true;
            }
          } else {
            // First visits still get risk evaluation, with no identity history to invent.
            const result = await run({
              history: [],
              current,
              deterministicSimilarity: 0,
            });
            if (result)
              risk = {
                automation: result.automation,
                suspicious: result.suspicious,
              };
          }
        }
        visitorId ??= await storage.createVisitor();
        await storage.saveObservation(visitorId, current);
        await storage.touchVisitor(visitorId);
        const identity: VisitorIdentity = {
          visitorId,
          confidence,
          isReturning,
          risk,
        };
        if (options.debug && input.debug)
          identity.debug = {
            deterministicScore,
            evaluatorUsed,
            candidateCount,
            collectedSignals: input.signals,
          };
        try {
          options.onMetrics?.({
            candidateCount,
            deterministicScore,
            finalConfidence: confidence,
            evaluatorUsed,
            evaluatorLatency,
            isReturning,
          });
        } catch {
          /* Telemetry must not affect identity. */
        }
        return identity;
      } catch (cause) {
        throw new VisitorStorageError(cause);
      }
    },
  };
}
