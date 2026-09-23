import type { NormalizedObservation } from "./types.js";

/** Verified login feedback, never inferred from a restored visitor ID. */
export type LearningExample = {
  sessionId: string;
  subjectId: string;
  observation: NormalizedObservation;
  observedAt: number;
  verifiedAt: number;
};
export type LearningPrediction = {
  subjectId?: string;
  score?: number;
  status: "not-run" | "suggested" | "abstained" | "unavailable";
};
export type LearningSession = {
  id: string;
  scope: string;
  startedAt: number;
  expiresAt: number;
  observedAt: number;
  observation: NormalizedObservation;
  subjectId?: string;
  disputed: boolean;
  prediction: LearningPrediction;
};
export type LearningReport = LearningExample & {
  prediction: LearningPrediction;
};
export interface LearningStorage {
  /** Indexed, tenant-scoped examples for prediction; reports remain an export API. */
  findExamples?(
    scope: string,
    current: NormalizedObservation,
    cutoff: number,
  ): Promise<{ examples: LearningExample[]; saturated: boolean }>;
  insertSession(session: LearningSession): Promise<void>;
  getSession(scope: string, id: string): Promise<LearningSession | undefined>;
  updateSession(session: LearningSession, now: number): Promise<void>;
  confirmSession(
    scope: string,
    id: string,
    subjectId: string,
    now: number,
  ): Promise<void>;
  deleteSession(scope: string, id: string): Promise<void>;
  reports(
    scope: string,
    cutoff: number,
    limit: number,
  ): Promise<LearningReport[]>;
  cleanupLearning(scope: string, now: number, cutoff: number): Promise<void>;
}
export type LearningOptions = {
  enabled: true;
  /** With Jev, shadow predictions are the default; they never change identity or permissions. */
  mode?: "collect" | "shadow";
  collectionPolicy?: "per-request" | "application";
  retentionDays?: number;
  sessionMinutes?: number;
  evaluatorTimeoutMs?: number;
  /** Optional replacement for the built-in Jev predictor. History supplies examples, not model training. */
  predict?: (input: {
    current: NormalizedObservation;
    examples: LearningExample[];
  }) => Promise<{ subjectId?: string; score?: number }>;
};
