export const EVENT_TYPES = [
  "login-attempt",
  "login-success",
  "login-failure",
  "verification-success",
  "verification-failure",
  "recovery-requested",
  "recovery-completed",
  "sensitive-action",
  "action-denied",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const ACTIONS = [
  "sign-in",
  "recovery",
  "payment",
  "profile-update",
  "read",
  "other",
] as const;
export type EvidenceAction = (typeof ACTIONS)[number];
export const VERIFICATION_METHODS = [
  "password",
  "passkey",
  "mfa",
  "oauth",
  "email-link",
  "recovery",
  "admin-review",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type ApplicationEvent = {
  id: string;
  scope: string;
  digest: string;
  type: EventType;
  action?: EvidenceAction;
  subjectId?: string;
  sessionId?: string;
  actorId?: string;
  visitorId?: string;
  occurredAt: number;
  expiresAt: number;
};
export type DeviceLink = {
  id: string;
  scope: string;
  digest: string;
  subjectId: string;
  visitorId: string;
  verification: {
    method: VerificationMethod;
    issuer: string;
    eventId: string;
    verifiedAt: number;
  };
  createdAt: number;
  expiresAt: number;
  revocation?: {
    revokedAt: number;
    reason: "logout" | "device-removed" | "compromised" | "account-recovery";
    issuer: string;
    eventId: string;
  };
};
export type ActivitySummary = {
  source: "application";
  observedAt: number;
  windowMs: number;
  action?: EvidenceAction;
  counts: Partial<Record<EventType, number>>;
  total: number;
  /** Counts are lower bounds when more than the bounded query limit exists. */
  saturated: boolean;
};
export type EdgeEvidence = {
  source: "edge";
  /** Provider-specific validation and score interpretation belong to adapters. */
  provider: string;
  observedAt: number;
  botScore?: number;
  verifiedBot?: boolean;
  signedAgent?: boolean;
};
export type RequestEvidence = {
  client: { source: "browser"; authenticated: false };
  edge?: EdgeEvidence;
  authentication?: {
    source: "authentication";
    method: VerificationMethod;
    verifiedAt: number;
  };
  application?: { source: "application"; action: EvidenceAction };
};
export interface EvidenceStorage {
  putEvent(event: ApplicationEvent): Promise<boolean>;
  recentEvents(input: {
    scope: string;
    kind: "subject" | "session" | "actor";
    id: string;
    since: number;
    until: number;
    action?: EvidenceAction;
    limit: number;
  }): Promise<Pick<ApplicationEvent, "type">[]>;
  putDeviceLink(link: DeviceLink): Promise<DeviceLink>;
  getDeviceLink(scope: string, id: string): Promise<DeviceLink | undefined>;
  listDeviceLinks(
    scope: string,
    subjectId: string,
    limit: number,
  ): Promise<DeviceLink[]>;
  revokeDeviceLink(
    scope: string,
    id: string,
    revocation: NonNullable<DeviceLink["revocation"]>,
  ): Promise<void>;
  deleteEvents(
    scope: string,
    kind: "subject" | "session",
    id: string,
  ): Promise<void>;
  cleanupEvidence(
    scope: string,
    now: number,
    linkCutoff: number,
    limit: number,
  ): Promise<void>;
}
