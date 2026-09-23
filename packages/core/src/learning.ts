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
  /** Collection is the default. Shadow output never changes returned identity or permissions. */
  mode?: "collect" | "shadow";
  retentionDays?: number;
  sessionMinutes?: number;
  evaluatorTimeoutMs?: number;
  /** Optional implementer-owned experiment. This does not train Jev automatically. */
  predict?: (input: {
    current: NormalizedObservation;
    examples: LearningExample[];
  }) => Promise<{ subjectId?: string; score?: number }>;
};
