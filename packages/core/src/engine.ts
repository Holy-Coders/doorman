import { OPERATOR_THRESHOLDS } from "./operators.js";
import {
  attemptEvaluation,
  isLookupScope,
  isCandidateEvaluations,
} from "./intelligence.js";
import { normalizeObservation } from "./normalize.js";
import {
  calculateSimilarity,
  resolveSimilarityWeights,
  type SimilarityWeights,
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
  lookupPlanned: boolean;
  candidatesEvaluated: number;
  lookupSaturated: boolean;
  deterministicScore: number;
  finalConfidence: number;
  evaluatorUsed: boolean;
  evaluatorLatency: number;
  isReturning: boolean;
  observationSaved: boolean;
};
export type ScoringOptions = {
  similarity?: Partial<SimilarityWeights>;
  /** Relative weights normalized to sum to one. Both entries are required when overriding. */
  confidence?: { deterministic: number; evaluator: number };
  candidateFloor?: number;
  ambiguityMargin?: number;
};
export function resolveScoring(input: ScoringOptions = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "similarity",
          "confidence",
          "candidateFloor",
          "ambiguityMargin",
        ].includes(key),
    )
  )
    throw new Error("Invalid scoring options");
  const confidence = input.confidence ?? {
    deterministic: MATCHING_DEFAULTS.deterministicWeight,
    evaluator: MATCHING_DEFAULTS.evaluatorWeight,
  };
  if (
    !confidence ||
    typeof confidence !== "object" ||
    Array.isArray(confidence) ||
    Object.keys(confidence).some(
      (key) => !["deterministic", "evaluator"].includes(key),
    ) ||
    [confidence.deterministic, confidence.evaluator].some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
    )
  )
    throw new Error("Invalid confidence weights");
  const total = confidence.deterministic + confidence.evaluator;
  if (!Number.isFinite(total) || total <= 0)
    throw new Error("Invalid confidence weights");
  const candidateFloor =
    input.candidateFloor ?? MATCHING_DEFAULTS.candidateFloor;
  const ambiguityMargin =
    input.ambiguityMargin ?? MATCHING_DEFAULTS.ambiguityMargin;
  if (
    !Number.isFinite(candidateFloor) ||
    candidateFloor < 0.5 ||
    candidateFloor > 1 ||
    !Number.isFinite(ambiguityMargin) ||
    ambiguityMargin <= 0 ||
    ambiguityMargin > 1
  )
    throw new Error("Invalid scoring thresholds");
  return Object.freeze({
    similarity: resolveSimilarityWeights(input.similarity),
    confidence: Object.freeze({
      deterministic: confidence.deterministic / total,
      evaluator: confidence.evaluator / total,
    }),
    candidateFloor,
    ambiguityMargin,
  });
}
export type EngineOptions = {
  storage: VisitorStorage;
  evaluator?: VisitorEvaluator;
  evaluatorTimeoutMs?: number;
  restoreThreshold?: number;
  scoring?: ScoringOptions;
  /** Jev may choose fixed indexed probe families before a missing-cookie lookup. */
  lookupPlanning?: boolean;
  /** Suggest a recovered browser without merging IDs. Recommended for analytics. */
  restoreBrowser?: boolean;
  classifyOperator?: boolean;
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
  const op = (value as Evaluation).operator;
  if (
    op !== undefined &&
    (!op ||
      ![op.human, op.assistant, op.automation].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      ))
  )
    return false;
  return ["sameVisitor", "automation", "suspicious"].every((key) => {
    const n = (value as Record<string, unknown>)[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  });
}
export function createVisitorEngine(options: EngineOptions) {
  const { storage, evaluator } = options;
  const scoring = resolveScoring(options.scoring);
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
    return attemptEvaluation(
      () => evaluator.evaluate(input),
      timeout,
      isEvaluation,
    );
  }

  return {
    async identify(input: {
      signals: BrowserObservation;
      behavior?: BrowserBehavior;
      visitorId?: string;
      debug?: boolean;
      riskEvidence?: import("./context.js").RiskEvidence;
    }): Promise<VisitorIdentity> {
      let browserMatch: VisitorIdentity["browserMatch"];
      const current = normalizeObservation(input.signals, input.behavior);
      const enoughOperatorEvidence =
        (input.behavior?.mouseMoveCount ?? 0) >= 20 ||
        (input.behavior?.interactionIntervalCount ?? 0) >= 10 ||
        (input.riskEvidence?.activity?.requests ?? 0) >= 10;
      const classifyOperator =
        options.classifyOperator === true && enoughOperatorEvidence;
      let operator: VisitorIdentity["operator"] = options.classifyOperator
        ? {
            status: !evaluator
              ? "disabled"
              : !enoughOperatorEvidence
                ? "insufficient-evidence"
                : "unavailable",
            label: "unknown",
            calibrated: false,
          }
        : undefined;
      let candidateCount = 0;
      let lookupPlanned = false;
      let candidatesEvaluated = 0;
      let lookupSaturated = false;
      let deterministicScore = 0;
      let evaluatorUsed = false;
      let evaluatorLatency = 0;
      let observationSaved = true;
      let risk = { automation: 0, suspicious: 0 };
      let riskStatus: VisitorIdentity["riskStatus"] = evaluator
        ? "unavailable"
        : "disabled";
      const useRisk = (result: Evaluation | undefined) => {
        if (!result) return;
        risk = { automation: result.automation, suspicious: result.suspicious };
        riskStatus = "evaluated";
        if (classifyOperator && result.operator) {
          const ranked = (["human", "assistant", "automation"] as const)
            .map((label) => ({ label, score: result.operator![label] }))
            .sort((a, b) => b.score - a.score);
          operator = {
            status: "evaluated",
            scores: result.operator,
            calibrated: false,
            label:
              ranked[0]!.score >= OPERATOR_THRESHOLDS.labelThreshold &&
              ranked[0]!.score - ranked[1]!.score >=
                OPERATOR_THRESHOLDS.labelMargin
                ? ranked[0]!.label
                : "unknown",
          };
        }
      };
      const run = async (data: EvaluationInput) => {
        const started = Date.now();
        const result = await evaluate({
          ...data,
          riskEvidence: input.riskEvidence,
          classifyOperator,
        });
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
              (previous) =>
                calculateSimilarity(previous, current, scoring.similarity)
                  .score,
            ),
          );
          // A copied cookie must not teach a contradictory or sparse environment to the history.
          observationSaved = history.some(
            (previous) =>
              !hasContradiction(previous, current) &&
              calculateSimilarity(previous, current, scoring.similarity)
                .score >= scoring.candidateFloor &&
              evidenceCap(previous, current) >=
                MATCHING_DEFAULTS.restoreThreshold,
          );
          const result = await run({
            history,
            current,
            deterministicSimilarity: deterministicScore,
          });
          useRisk(result);
        } else {
          const scope =
            options.lookupPlanning !== false && evaluator?.planLookup
              ? await attemptEvaluation(
                  () => evaluator.planLookup!(current),
                  timeout,
                  isLookupScope,
                )
              : undefined;
          lookupPlanned = !!scope;
          let found = await storage.findCandidates(
            current,
            MATCHING_DEFAULTS.candidateLimit,
            scope,
          );
          // A planner cannot turn an empty restricted search into evidence of a new browser.
          if (!found.length && scope && (!scope.graphics || !scope.locale))
            found = await storage.findCandidates(
              current,
              MATCHING_DEFAULTS.candidateLimit,
            );
          const candidates = found.slice(0, MATCHING_DEFAULTS.candidateLimit);
          const unique = [
            ...new Map(
              candidates.map((candidate) => [candidate.visitorId, candidate]),
            ).values(),
          ];
          candidateCount = unique.length;
          const histories = storage.getRecentObservationsBatch
            ? await storage.getRecentObservationsBatch(
                unique.map((c) => c.visitorId),
                MATCHING_DEFAULTS.historyLimit,
              )
            : undefined;
          const ranked = (
            await Promise.all(
              unique.map(async (candidate) => {
                const history = (
                  histories
                    ? (histories[candidate.visitorId] ?? [])
                    : await storage.getRecentObservations(
                        candidate.visitorId,
                        MATCHING_DEFAULTS.historyLimit,
                      )
                ).slice(0, MATCHING_DEFAULTS.historyLimit);
                const best = history
                  .filter((previous) => !hasContradiction(previous, current))
                  .map((previous) => ({
                    score: calculateSimilarity(
                      previous,
                      current,
                      scoring.similarity,
                    ).score,
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
            .filter((candidate) => candidate.score >= scoring.candidateFloor)
            .sort(
              (a, b) =>
                b.score - a.score ||
                b.lastSeenAt - a.lastSeenAt ||
                a.visitorId.localeCompare(b.visitorId),
            );
          const selected = ranked.slice(
            0,
            evaluator?.evaluateCandidates
              ? MATCHING_DEFAULTS.candidateLimit
              : MATCHING_DEFAULTS.evaluationLimit,
          );
          const batchStarted = Date.now();
          const batch =
            selected.length && evaluator?.evaluateCandidates
              ? await attemptEvaluation(
                  () =>
                    evaluator.evaluateCandidates!({
                      current,
                      riskEvidence: input.riskEvidence,
                      classifyOperator,
                      candidates: selected.map((c) => ({
                        history: c.history,
                        deterministicSimilarity: c.score,
                      })),
                    }),
                  timeout,
                  isCandidateEvaluations,
                )
              : undefined;
          const validBatch =
            batch?.length === selected.length ? batch : undefined;
          if (evaluator?.evaluateCandidates && selected.length) {
            evaluatorLatency = Math.max(
              evaluatorLatency,
              Date.now() - batchStarted,
            );
            evaluatorUsed ||= !!validBatch;
          }
          candidatesEvaluated = evaluator ? selected.length : 0;
          const evaluated = await Promise.all(
            selected.map(async (candidate, index) => {
              // A failed batch falls back locally; do not amplify an outage with retries.
              const result = evaluator?.evaluateCandidates
                ? validBatch?.[index]
                : await run({
                    history: candidate.history,
                    current,
                    deterministicSimilarity: candidate.score,
                  });
              const confidence = Math.min(
                candidate.cap,
                result
                  ? candidate.score * scoring.confidence.deterministic +
                      result.sameVisitor * scoring.confidence.evaluator
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
          // An evaluator cannot erase a deterministic competitor, including an identical profile.
          const runnerUp = Math.max(
            evaluated[1]?.confidence ?? 0,
            ...ranked
              .filter((candidate) => candidate.visitorId !== best?.visitorId)
              .map((candidate) => candidate.score),
          );
          if (best) {
            lookupSaturated = best.lookupSaturated === true;
            deterministicScore = best.score;
            useRisk(best.result);
            if (
              !best.lookupSaturated &&
              best.confidence >= threshold &&
              best.confidence - runnerUp >= scoring.ambiguityMargin
            ) {
              browserMatch = {
                visitorId: best.visitorId,
                score: best.confidence,
              };
              if (options.restoreBrowser !== false) {
                visitorId = best.visitorId;
                confidence = best.confidence;
                isReturning = true;
              }
            }
          } else {
            // First visits still get risk evaluation, with no identity history to invent.
            const result = await run({
              history: [],
              current,
              deterministicSimilarity: 0,
            });
            useRisk(result);
          }
        }
        visitorId ??= await storage.createVisitor();
        if (observationSaved) await storage.saveObservation(visitorId, current);
        await storage.touchVisitor(visitorId);
        const identity: VisitorIdentity = {
          visitorId,
          ...(options.restoreBrowser === false && browserMatch
            ? { browserMatch }
            : {}),
          confidence,
          isReturning,
          risk,
          riskStatus,
          ...(operator ? { operator } : {}),
        };
        if (options.debug && input.debug)
          identity.debug = {
            deterministicScore,
            evaluatorUsed,
            candidateCount,
            lookupSaturated,
            collectedSignals: input.signals,
          };
        try {
          options.onMetrics?.({
            candidateCount,
            lookupPlanned,
            candidatesEvaluated,
            lookupSaturated,
            deterministicScore,
            finalConfidence: confidence,
            evaluatorUsed,
            evaluatorLatency,
            isReturning,
            observationSaved,
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
