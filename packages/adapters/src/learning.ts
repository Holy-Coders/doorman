import type {
  IdentityAttribution,
  LearningOptions,
  LearningPrediction,
  LearningStorage,
  NormalizedObservation,
  VisitorEvaluator,
} from "@aarondovturkel/doorman-core";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";

export function createLearning(
  storage: LearningStorage,
  identity: SubjectLinkingOptions,
  options: LearningOptions,
  evaluator?: VisitorEvaluator,
) {
  const retention = options.retentionDays ?? 30;
  const sessionMinutes = options.sessionMinutes ?? 30;
  const timeoutMs = options.evaluatorTimeoutMs ?? 1200;
  const predictor =
    options.predict ?? evaluator?.predictIdentity?.bind(evaluator);
  const mode = options.mode ?? (predictor ? "shadow" : "collect");
  if (
    !["per-request", "application"].includes(
      options.collectionPolicy ?? "per-request",
    )
  )
    throw new Error("Invalid learning collection policy");
  if (
    !Number.isInteger(retention) ||
    retention < 1 ||
    retention > 90 ||
    !Number.isInteger(sessionMinutes) ||
    sessionMinutes < 1 ||
    sessionMinutes > 60 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 5000
  )
    throw new Error("Invalid learning limits");
  if (
    !["collect", "shadow"].includes(mode) ||
    (mode === "shadow" && !predictor) ||
    (mode === "collect" && options.predict)
  )
    throw new Error(
      "Shadow learning requires Jev or a predictor; collect mode does not run one",
    );
  const scope = createSubjectLinker(identity)("doorman-learning-scope-v1");
  const validSession = (id?: string) =>
    id && /^ses_[a-f0-9]{48}$/.test(id) ? id : undefined;
  const cutoff = () => Date.now() - retention * 86400000;
  async function reports(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Learning report limit must be 1–100");
    return storage.reports(await scope, cutoff(), limit);
  }
  async function predict(
    current: NormalizedObservation,
  ): Promise<LearningPrediction> {
    if (mode !== "shadow") return { status: "not-run" };
    // No previous predictions are supplied as evidence. Only completed verified flows.
    const pool = storage.findExamples
      ? await storage.findExamples(await scope, current, cutoff())
      : { examples: await reports(), saturated: false };
    if (pool.saturated) return { status: "abstained" };
    const examples = pool.examples.map(
      ({ sessionId, subjectId, observation, observedAt, verifiedAt }) => ({
        sessionId,
        subjectId,
        observation,
        observedAt,
        verifiedAt,
      }),
    );
    if (!examples.length) return { status: "abstained" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        Promise.resolve().then(() => predictor!({ current, examples })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
      if (!answer || typeof answer !== "object")
        throw new Error("Invalid prediction");
      if (answer.subjectId === undefined) return { status: "abstained" };
      if (
        !examples.some((example) => example.subjectId === answer.subjectId) ||
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > 1
      )
        throw new Error("Invalid prediction");
      return {
        status: "suggested",
        subjectId: answer.subjectId,
        score: answer.score,
      };
    } catch {
      return { status: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async observe(input: {
      sessionId?: string;
      allowed: boolean;
      authenticated: boolean;
      attribution?: IdentityAttribution;
      observation: NormalizedObservation;
    }): Promise<{
      id?: string;
      maxAge: number;
      prediction?: LearningPrediction;
    }> {
      const currentScope = await scope;
      const id = validSession(input.sessionId);
      if (!input.allowed) {
        if (id) await storage.deleteSession(currentScope, id);
        return { maxAge: 0 };
      }
      const now = Date.now();
      const existing = id
        ? await storage.getSession(currentScope, id)
        : undefined;
      if (input.authenticated) {
        const { subject, actor, delegation } = input.attribution ?? {
          subject: undefined,
          actor: undefined,
          delegation: undefined,
        };
        const self =
          subject?.status === "verified" &&
          actor?.kind === "person" &&
          actor.id === subject.id &&
          delegation?.status === "none";
        // Do not train on post-login measurements, agent activity, or a shared-account delegation.
        if (existing && self && existing.expiresAt > now)
          await storage.confirmSession(
            currentScope,
            existing.id,
            subject.id!,
            now,
          );
        else if (existing && !existing.subjectId)
          await storage.deleteSession(currentScope, existing.id);
        return { maxAge: 0 };
      }
      const session =
        existing &&
        !existing.subjectId &&
        !existing.disputed &&
        existing.expiresAt > now
          ? existing
          : {
              id:
                "ses_" +
                Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join(""),
              scope: currentScope,
              startedAt: now,
              expiresAt: now + sessionMinutes * 60000,
              observedAt: now,
              observation: input.observation,
              disputed: false,
              prediction: { status: "not-run" as const },
            };
      session.observation = input.observation;
      session.observedAt = now;
      session.prediction = await predict(input.observation);
      if (session.id === existing?.id)
        await storage.updateSession(session, Date.now());
      else await storage.insertSession(session);
      return {
        id: session.id,
        prediction: session.prediction,
        maxAge: Math.max(
          0,
          Math.floor((session.expiresAt - Date.now()) / 1000),
        ),
      };
    },
    /** Server-only, bounded feedback export. Scores are uncalibrated and never identity proof. */
    reports,
    async deleteSession(id: string) {
      if (!validSession(id)) throw new Error("Invalid learning session");
      await storage.deleteSession(await scope, id);
    },
    cleanup: async () =>
      storage.cleanupLearning(await scope, Date.now(), cutoff()),
  };
}
