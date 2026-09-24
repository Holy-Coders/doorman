import type { EdgeEvidence } from "./evidence.js";

/** Application assertions after authentication. Never accept this object from browser JSON. */
export type AuthContext = {
  userId: string;
  accountId?: string;
  actor?: { id: string; kind: "person" | "agent" };
};
export type BrowserAssociation = {
  id: string;
  scope: string;
  visitorId: string;
  subjectId: string;
  accountId?: string;
  actorId: string;
  actorKind: "person" | "agent";
  seenAt: number;
  expiresAt: number;
};
export interface ContextStorage {
  remember(association: BrowserAssociation): Promise<void>;
  recall(
    scope: string,
    visitorId: string,
    now: number,
    limit: number,
  ): Promise<BrowserAssociation[]>;
  forget(scope: string, subjectId: string): Promise<void>;
  cleanupContext(scope: string, now: number): Promise<void>;
}
export type IdentityContext = {
  status: "authenticated" | "remembered" | "inferred" | "ambiguous" | "unknown";
  basis:
    | "authentication"
    | "cookie-history"
    | "browser-similarity"
    | "login-history"
    | "none";
  candidates: {
    subjectId: string;
    accountId?: string;
    actorId?: string;
    actorKind?: "person" | "agent";
    lastSeenAt?: number;
    score?: number;
  }[];
  /** Scores are not calibrated person probabilities. */
  calibrated: false;
  truncated: boolean;
};
export type ReputationEvidence = {
  provider: "abuseipdb";
  status: "available" | "unavailable" | "not-requested" | "limited";
  observedAt: number;
  cached: boolean;
  /** Provider's abuseConfidenceScore divided by 100, not a person-risk probability. */
  score?: number;
  totalReports?: number;
  lastReportedAt?: number;
};
/** Private, server supplied evidence. Never persisted in browser observation history. */
export type RiskEvidence = {
  edge?: EdgeEvidence;
  reputation?: ReputationEvidence;
  activity?: {
    windowMs: number;
    requests: number;
    denials: number;
    authenticationFailures: number;
  };
};
