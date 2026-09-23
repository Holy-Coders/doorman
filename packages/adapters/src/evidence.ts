import { z } from "zod";
import { ACTIONS, EVENT_TYPES, VERIFICATION_METHODS } from "@janitor/core";
import type {
  ActivitySummary,
  EvidenceStorage,
  RequestEvidence,
} from "@janitor/core";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";

const label = z.string().trim().min(1).max(256);
const subject = z.string().regex(/^sub_[a-f0-9]{64}$/);
const visitor = z.string().regex(/^vis_[a-f0-9]{48}$/);
const linkId = z.string().regex(/^dev_[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative().safe();
const event = z
  .object({
    id: label,
    type: z.enum(EVENT_TYPES),
    action: z.enum(ACTIONS).optional(),
    subjectId: subject.optional(),
    sessionId: label.optional(),
    actorId: subject.optional(),
    visitorId: visitor.optional(),
  })
  .strict()
  .refine(
    (v) => !!(v.subjectId || v.sessionId || v.actorId),
    "An application subject, session or actor is required",
  );
export type ApplicationEventInput = z.input<typeof event>;
const verification = z
  .object({
    method: z.enum(VERIFICATION_METHODS),
    issuer: label,
    eventId: label,
    verifiedAt: timestamp,
  })
  .strict();
const device = z
  .object({
    subjectId: subject,
    visitorId: visitor,
    verification,
    expiresAt: timestamp,
  })
  .strict();
export type DeviceLinkInput = z.input<typeof device>;
const revocation = z
  .object({
    reason: z.enum([
      "logout",
      "device-removed",
      "compromised",
      "account-recovery",
    ]),
    issuer: label,
    eventId: label,
  })
  .strict();
const evidenceOptions = z
  .object({
    eventRetentionDays: z.number().int().min(1).max(30).default(7),
    linkRetentionDays: z.number().int().min(1).max(365).default(90),
    maxEventsPerQuery: z.number().int().min(1).max(1000).default(1000),
  })
  .strict();
export type EvidenceOptions = z.input<typeof evidenceOptions>;
const DAY = 86_400_000;

/** Strictly server-owned records; no public event-ingestion endpoint is installed. */
export function createEvidence(
  storage: EvidenceStorage,
  identity: SubjectLinkingOptions,
  options: EvidenceOptions = {},
) {
  const limits = evidenceOptions.parse(options);
  const labelKey = createSubjectLinker(identity);
  const key = (purpose: string, value: unknown) =>
    labelKey(JSON.stringify(["evidence-v1", purpose, value]));
  const scope = key("scope", "application");
  return {
    async record(input: ApplicationEventInput) {
      const parsed = event.parse(input);
      const now = Date.now();
      const id = await key("event", parsed.id);
      const digest = await key("event-payload", [
        parsed.type,
        parsed.action ?? null,
        parsed.subjectId ?? null,
        parsed.sessionId ?? null,
        parsed.actorId ?? null,
        parsed.visitorId ?? null,
      ]);
      return {
        recorded: await storage.putEvent({
          ...parsed,
          id,
          digest,
          scope: await scope,
          sessionId: parsed.sessionId
            ? await key("session", parsed.sessionId)
            : undefined,
          occurredAt: now,
          expiresAt: now + limits.eventRetentionDays * DAY,
        }),
      };
    },
    async velocity(input: {
      subjectId?: string;
      sessionId?: string;
      actorId?: string;
      action?: (typeof ACTIONS)[number];
      windowMs?: number;
    }): Promise<ActivitySummary> {
      const parsed = z
        .object({
          subjectId: subject.optional(),
          sessionId: label.optional(),
          actorId: subject.optional(),
          action: z.enum(ACTIONS).optional(),
          windowMs: z.number().int().min(1000).max(DAY).default(900_000),
        })
        .strict()
        .refine(
          (v) =>
            [v.subjectId, v.sessionId, v.actorId].filter(Boolean).length === 1,
          "Select exactly one activity key",
        )
        .parse(input);
      const now = Date.now();
      const kind = parsed.subjectId
        ? "subject"
        : parsed.actorId
          ? "actor"
          : "session";
      const id =
        parsed.subjectId ??
        parsed.actorId ??
        (await key("session", parsed.sessionId!));
      const rows = await storage.recentEvents({
        scope: await scope,
        kind,
        id,
        since: now - parsed.windowMs,
        until: now,
        action: parsed.action,
        limit: limits.maxEventsPerQuery + 1,
      });
      const counts: ActivitySummary["counts"] = {};
      for (const row of rows.slice(0, limits.maxEventsPerQuery))
        counts[row.type] = (counts[row.type] ?? 0) + 1;
      return {
        source: "application",
        observedAt: now,
        windowMs: parsed.windowMs,
        ...(parsed.action ? { action: parsed.action } : {}),
        counts,
        total: Math.min(rows.length, limits.maxEventsPerQuery),
        saturated: rows.length > limits.maxEventsPerQuery,
      };
    },
    async linkDevice(input: DeviceLinkInput) {
      const parsed = device.parse(input);
      const now = Date.now();
      if (
        parsed.verification.verifiedAt > now + 5000 ||
        parsed.verification.verifiedAt < now - 300_000
      )
        throw new Error("Device verification must be fresh");
      if (parsed.expiresAt <= now || parsed.expiresAt > now + 90 * DAY)
        throw new Error("Device link must expire within 90 days");
      const proof = await key("verification", [
        parsed.verification.issuer,
        parsed.verification.eventId,
      ]);
      return storage.putDeviceLink({
        ...parsed,
        id: proof.replace(/^sub_/, "dev_"),
        digest: await key("device-payload", [
          parsed.subjectId,
          parsed.visitorId,
          parsed.verification.method,
          parsed.verification.verifiedAt,
          parsed.expiresAt,
        ]),
        scope: await scope,
        verification: { ...parsed.verification, eventId: proof },
        createdAt: now,
      });
    },
    async assessDevice(input: {
      id: string;
      subjectId: string;
      visitorId: string;
    }) {
      const parsed = z
        .object({ id: linkId, subjectId: subject, visitorId: visitor })
        .strict()
        .parse(input);
      const link = await storage.getDeviceLink(await scope, parsed.id);
      const reason = !link
        ? "missing"
        : link.revocation
          ? "revoked"
          : link.expiresAt <= Date.now()
            ? "expired"
            : link.subjectId !== parsed.subjectId
              ? "subject"
              : link.visitorId !== parsed.visitorId
                ? "visitor"
                : undefined;
      return reason
        ? { status: "invalid" as const, reason }
        : { status: "verified-association" as const, link: link! };
    },
    async listDevices(subjectId: string, limit = 20) {
      return storage.listDeviceLinks(
        await scope,
        subject.parse(subjectId),
        z.number().int().min(1).max(100).parse(limit),
      );
    },
    async revokeDevice(id: string, input: z.input<typeof revocation>) {
      const parsed = revocation.parse(input);
      await storage.revokeDeviceLink(await scope, linkId.parse(id), {
        ...parsed,
        revokedAt: Date.now(),
        eventId: await key("revocation", [parsed.issuer, parsed.eventId]),
      });
    },
    async deleteSession(sessionId: string) {
      await storage.deleteEvents(
        await scope,
        "session",
        await key("session", label.parse(sessionId)),
      );
    },
    async deleteSubjectEvents(subjectId: string) {
      await storage.deleteEvents(
        await scope,
        "subject",
        subject.parse(subjectId),
      );
    },
    cleanup: async () =>
      storage.cleanupEvidence(
        await scope,
        Date.now(),
        Date.now() - limits.linkRetentionDays * DAY,
        100,
      ),
  };
}

const edge = z
  .object({
    source: z.literal("edge"),
    provider: z.literal("cloudflare"),
    observedAt: timestamp,
    botScore: z.number().int().min(1).max(99).optional(),
    verifiedBot: z.boolean().optional(),
    signedAgent: z.boolean().optional(),
  })
  .strict();
const trusted = z
  .object({
    edge: edge.optional(),
    authentication: z
      .object({ method: z.enum(VERIFICATION_METHODS), verifiedAt: timestamp })
      .strict()
      .optional(),
    action: z.enum(ACTIONS).optional(),
  })
  .strict();
export type TrustedRequestEvidence = z.input<typeof trusted>;
export function requestEvidence(
  input?: TrustedRequestEvidence,
): RequestEvidence {
  const parsed = trusted.parse(input ?? {});
  const now = Date.now();
  if (
    parsed.edge &&
    (parsed.edge.observedAt > now + 5000 ||
      parsed.edge.observedAt < now - 60_000)
  )
    throw new Error("Stale edge evidence");
  if (
    parsed.authentication &&
    (parsed.authentication.verifiedAt > now + 5000 ||
      parsed.authentication.verifiedAt < now - 30 * DAY)
  )
    throw new Error("Stale authentication evidence");
  return {
    client: { source: "browser", authenticated: false },
    ...(parsed.edge ? { edge: parsed.edge } : {}),
    ...(parsed.authentication
      ? {
          authentication: {
            source: "authentication",
            ...parsed.authentication,
          },
        }
      : {}),
    ...(parsed.action
      ? { application: { source: "application", action: parsed.action } }
      : {}),
  };
}
