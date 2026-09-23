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
  confidence: number;
  isReturning: boolean;
  risk: { automation: number; suspicious: number };
  debug?: {
    deterministicScore: number;
    evaluatorUsed: boolean;
    candidateCount: number;
    collectedSignals: BrowserObservation;
  };
};

export type VisitorCandidate = { visitorId: string; lastSeenAt: number };

export interface VisitorStorage {
  findCandidates(
    observation: NormalizedObservation,
    limit: number,
  ): Promise<VisitorCandidate[]>;
  getRecentObservations(
    visitorId: string,
    limit: number,
  ): Promise<NormalizedObservation[]>;
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
  evaluate(input: EvaluationInput): Promise<Evaluation>;
}

export type RetentionOptions = {
  observationRetentionDays?: number;
  maxObservationsPerVisitor?: number;
};
export type ManagedVisitorStorage = VisitorStorage & {
  cleanup(): Promise<void>;
  deleteVisitor(visitorId: string): Promise<void>;
};
