import type {
  LookupScope,
  CandidateEvaluationInput,
  CrossDeviceInput,
  CrossDevicePrediction,
} from "./intelligence.js";
import type { IdentityAttribution } from "./identity.js";
export type BrowserObservation = {
  userAgent?: string;
  platform?: string;
  languages?: string[];
  timezone?: string;
  screen?: {
    width?: number;
    height?: number;
    colorDepth?: number;
    pixelRatio?: number;
  };
  viewport?: { width?: number; height?: number };
  hardware?: {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    maxTouchPoints?: number;
  };
  automation?: { webdriver?: boolean };
  graphics?: { webglVendor?: string; webglRenderer?: string };
};

export type BrowserBehavior = {
  pageAgeMs: number;
  mouseMoveCount: number;
  pointerDownCount: number;
  keyDownCount: number;
  scrollCount: number;
  visibilityChangeCount: number;
  /** Extended collection only. Valid movement samples; coordinates are never retained. */
  mouseSampleCount?: number;
  mouseLargeStepCount?: number;
  mouseIntervalCount?: number;
  mouseIntervalMeanMs?: number;
  mouseIntervalStdDevMs?: number;
  interactionShortGapCount?: number;
  interactionRepeatGapCount?: number;
  interactionComparableGapCount?: number;
  mouseDistancePx?: number;
  mouseActiveMs?: number;
  mouseDirectionChanges?: number;
  mousePauseCount?: number;
  scrollDistancePx?: number;
  scrollDirectionChanges?: number;
  interactionIntervalCount?: number;
  interactionIntervalMeanMs?: number;
  interactionIntervalStdDevMs?: number;
};

export type NormalizedObservation = BrowserObservation & {
  browser?: string;
  behavior?: BrowserBehavior;
};

export type VisitorIdentity = {
  visitorId: string;
  /** Present only when the server supplies a verified account identity. */
  subjectId?: string;
  attribution?: IdentityAttribution;
  confidence: number;
  isReturning: boolean;
  risk: { automation: number; suspicious: number };
  riskStatus: "evaluated" | "unavailable" | "disabled";
  debug?: {
    deterministicScore: number;
    evaluatorUsed: boolean;
    candidateCount: number;
    lookupSaturated?: boolean;
    collectedSignals: BrowserObservation;
  };
};

/** Browser responses omit scores unless the server explicitly exposes them. */
export type VisitorClientIdentity = Pick<
  VisitorIdentity,
  "visitorId" | "isReturning"
> &
  Partial<Omit<VisitorIdentity, "visitorId" | "isReturning">>;

export type VisitorCandidate = {
  visitorId: string;
  lastSeenAt: number;
  /** All retrieval buckets containing this visitor were truncated. Never auto-restore. */
  lookupSaturated?: boolean;
};

export interface VisitorStorage {
  findCandidates(
    observation: NormalizedObservation,
    limit: number,
    scope?: LookupScope,
  ): Promise<VisitorCandidate[]>;
  getRecentObservations(
    visitorId: string,
    limit: number,
  ): Promise<NormalizedObservation[]>;
  /** Optional bounded bulk read; custom storage can retain the single-visitor method. */
  getRecentObservationsBatch?(
    visitorIds: string[],
    limit: number,
  ): Promise<Record<string, NormalizedObservation[]>>;
  createVisitor(): Promise<string>;
  saveObservation(
    visitorId: string,
    observation: NormalizedObservation,
  ): Promise<void>;
  touchVisitor(visitorId: string): Promise<void>;
}

export type EvaluationInput = {
  history: NormalizedObservation[];
  current: NormalizedObservation;
  deterministicSimilarity: number;
};
export type Evaluation = {
  sameVisitor: number;
  automation: number;
  suspicious: number;
};
export interface VisitorEvaluator {
  evaluateOperator?(
    input: import("./operators.js").OperatorEvaluationInput,
  ): Promise<import("./operators.js").OperatorEvaluation>;
  evaluate(input: EvaluationInput): Promise<Evaluation>;
  planLookup?(current: NormalizedObservation): Promise<LookupScope>;
  evaluateCandidates?(input: CandidateEvaluationInput): Promise<Evaluation[]>;
  predictIdentity?(input: CrossDeviceInput): Promise<CrossDevicePrediction>;
  evaluateActivity?(
    input: import("./activity.js").ApiActivityInput,
  ): Promise<import("./activity.js").ApiActivityRisk>;
}

export type RetentionOptions = {
  observationRetentionDays?: number;
  maxObservationsPerVisitor?: number;
};
export type CleanupOptions = { batchSize?: number; afterVisitorId?: string };
export type CleanupProgress = {
  nextVisitorId?: string;
  hasMoreExpired: boolean;
};
export type ManagedVisitorStorage = VisitorStorage & {
  cleanup(options?: CleanupOptions): Promise<CleanupProgress | void>;
  deleteVisitor(visitorId: string): Promise<void>;
};
