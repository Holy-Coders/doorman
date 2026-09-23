import { isProbability } from "./intelligence.js";

/** Application-owned references. Never populate from arbitrary client claims. */
export type ApiActivityKey = { kind: "session" | "actor"; id: string };
export type ApiActivityContext = {
  key: ApiActivityKey;
  /** A configured route template, never the incoming URL. */
  route: string;
  /** Supplied only after the application verifies credentials and delegation. */
  actor?: { kind: "person" | "agent"; delegated: boolean };
};
export type ApiActivityBucket = {
  windowStart: number;
  route: string;
  requests: number;
  denied: number;
  clientErrors: number;
  serverErrors: number;
  durationTotalMs: number;
  durationMaxMs: number;
  firstSeenAt: number;
  lastSeenAt: number;
  shortGaps: number;
};
export type ApiActivitySummary = {
  source: "application-api";
  observedAt: number;
  windowMs: number;
  truncated: boolean;
  /** At most five windows and 32 configured routes per window. */
  buckets: ApiActivityBucket[];
};
export const API_ACTIVITY_LIMITS = {
  routes: 32,
  windows: 5,
  rows: 128,
  shortGapMs: 100,
  maxDurationMs: 60_000,
  maxCount: 1_000_000_000,
} as const;
export type ApiActivityInput = {
  activity: ApiActivitySummary;
  route: string;
  sensitive: boolean;
  actor?: ApiActivityContext["actor"];
};
export type ApiActivityRisk = { automation: number; suspicious: number };
export type ApiActivityAssessment = {
  source: "application-api";
  evaluatedAt: number;
  expiresAt: number;
  risk: ApiActivityRisk;
  riskStatus: "evaluated" | "unavailable" | "disabled";
  summary: ApiActivitySummary;
  cached: boolean;
};
export type ApiActivityResult = {
  status: "recorded" | "skipped" | "unavailable";
  assessment?: ApiActivityAssessment;
};
export interface ApiActivityStorage {
  increment(input: {
    key: string;
    route: string;
    windowStart: number;
    now: number;
    expiresAt: number;
    status: number;
    durationMs: number;
  }): Promise<ApiActivityBucket>;
  recent(
    key: string,
    since: number,
    until: number,
  ): Promise<ApiActivityBucket[]>;
  claim(
    key: string,
    owner: string,
    lease: string,
    now: number,
    nextAt: number,
  ): Promise<boolean>;
  cached(key: string, now: number): Promise<ApiActivityAssessment | undefined>;
  save(
    key: string,
    lease: string,
    assessment: ApiActivityAssessment,
  ): Promise<void>;
  deleteKey(key: string): Promise<void>;
  cleanup(now: number, limit: number): Promise<void>;
}
export function isApiActivityRisk(value: unknown): value is ApiActivityRisk {
  if (!value || typeof value !== "object") return false;
  const result = value as ApiActivityRisk;
  return isProbability(result.automation) && isProbability(result.suspicious);
}
