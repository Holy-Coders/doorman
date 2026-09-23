import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createEvidence,
  requestEvidence,
} from "../packages/adapters/src/evidence.js";
import { createIdentityDirectory } from "../packages/adapters/src/identity.js";
import {
  createVisitorHandler,
  createNodeVisitor,
} from "@janitor/adapters/node";
import { createVercelVisitor } from "@janitor/adapters/vercel";
import {
  cloudflareRequestEvidence,
  createCloudflareVisitor,
} from "@janitor/adapters/cloudflare";
import { sqlBackend } from "./helpers/sql.js";
import { signals } from "./helpers/fixtures.js";
const request = (body: unknown = { signals }) =>
  new Request("https://app.test/api/visitor", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-bot-score": "99",
      "x-verified-agent": "true",
    },
    body: JSON.stringify(body),
  });

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind} trusted application evidence`, () => {
    let sql: Awaited<ReturnType<typeof sqlBackend>>;
    beforeAll(async () => {
      sql = await sqlBackend(kind);
    }, 30_000);
    afterAll(async () => sql.close());
    afterEach(() => vi.restoreAllMocks());
    const setup = async (maxEventsPerQuery = 1000) => {
      const identity = {
        secret: "x".repeat(64),
        namespace: crypto.randomUUID(),
      };
      const directory = createIdentityDirectory(sql.identities, identity);
      const subject = await directory.updateSubject({
        id: "user-a",
        kind: "person",
      });
      const other = await directory.updateSubject({
        id: "user-b",
        kind: "person",
      });
      const visitorId = await sql.storage.createVisitor();
      const evidence = createEvidence(sql.evidence, identity, {
        maxEventsPerQuery,
      });
      return { identity, directory, subject, other, visitorId, evidence };
    };
    it("composes protection and private evidence through the public provider factories", async () => {
      const factories = [
        (options: Parameters<typeof createCloudflareVisitor>[0]) =>
          createCloudflareVisitor(options),
        ...("query" in sql.db
          ? [createNodeVisitor, createVercelVisitor].map(
              (factory) =>
                (options: Parameters<typeof createCloudflareVisitor>[0]) => {
                  if (!("query" in options.db))
                    throw new Error("Expected Postgres");
                  return factory({ ...options, db: options.db });
                },
            )
          : []),
      ];
      for (const factory of factories) {
        const scope = {
          secret: "f".repeat(64),
          namespace: crypto.randomUUID(),
        };
        const visitor = factory({
          db: sql.db,
          identity: scope,
          evidence: true,
          protection: { ...scope, requests: { global: 1 } },
        });
        const subject = await visitor.identities!.updateSubject({
          id: "verified-account",
          kind: "person",
        });
        await visitor.evidence!.record({
          id: "login",
          type: "login-success",
          subjectId: subject.id,
        });
        expect(
          await visitor.evidence!.velocity({ subjectId: subject.id }),
        ).toMatchObject({ total: 1 });
        const assessment = await visitor.assess(request(), {
          evidence: { action: "sign-in" },
        });
        expect(assessment.response.status).toBe(200);
        expect(assessment.response.headers.get("set-cookie")).toContain(
          "HttpOnly",
        );
        expect(assessment.evidence?.application?.action).toBe("sign-in");
        expect(await assessment.response.json()).not.toHaveProperty("evidence");
        expect((await visitor.handle(request())).status).toBe(429);
      }
    });
    it("deduplicates concurrent events and rejects idempotency conflicts without storing raw references", async () => {
      const { evidence, subject, other } = await setup();
      const input = {
        id: "private-event-reference",
        type: "login-failure" as const,
        subjectId: subject.id,
        sessionId: "private-session-reference",
        action: "sign-in" as const,
      };
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () => evidence.record(input)),
      );
      expect(outcomes.filter((o) => o.recorded)).toHaveLength(1);
      expect(await evidence.velocity({ subjectId: subject.id })).toMatchObject({
        total: 1,
        counts: { "login-failure": 1 },
        saturated: false,
      });
      expect(
        await evidence.velocity({ sessionId: input.sessionId }),
      ).toMatchObject({ total: 1 });
      await expect(
        evidence.record({ ...input, subjectId: other.id }),
      ).rejects.toThrow("idempotency");
      expect(
        JSON.stringify(
          await sql.query("SELECT record FROM application_events"),
        ),
      ).not.toMatch(/private-event-reference|private-session-reference/);
    });
    it("filters activity by scope, time, action and actor and labels saturated counts as lower bounds", async () => {
      const { evidence, identity, subject, other } = await setup(3);
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
      await evidence.record({
        id: "old",
        type: "login-failure",
        subjectId: subject.id,
      });
      clock.mockReturnValue(1_900_000_010_000);
      for (let i = 0; i < 5; i++)
        await evidence.record({
          id: `payment-${i}`,
          type: "sensitive-action",
          action: "payment",
          subjectId: subject.id,
          actorId: other.id,
        });
      await evidence.record({
        id: "read",
        type: "sensitive-action",
        action: "read",
        subjectId: subject.id,
      });
      const payment = await evidence.velocity({
        subjectId: subject.id,
        action: "payment",
        windowMs: 1000,
      });
      expect(payment).toMatchObject({
        total: 3,
        saturated: true,
        counts: { "sensitive-action": 3 },
      });
      expect(
        await evidence.velocity({ subjectId: subject.id, action: "read" }),
      ).toMatchObject({ total: 1, saturated: false });
      expect(await evidence.velocity({ actorId: other.id })).toMatchObject({
        total: 3,
        saturated: true,
      });
      const separate = createEvidence(sql.evidence, {
        ...identity,
        namespace: "separate",
      });
      expect(await separate.velocity({ subjectId: subject.id })).toMatchObject({
        total: 0,
      });
      clock.mockReturnValue(1_900_000_012_000);
      expect(
        await evidence.velocity({ subjectId: subject.id, windowMs: 1000 }),
      ).toMatchObject({ total: 0 });
    });
    it("links only fresh verification, separates shared-device accounts, and never revives a revoked proof", async () => {
      const { evidence, subject, other, visitorId } = await setup();
      const now = Date.now();
      const input = {
        subjectId: subject.id,
        visitorId,
        expiresAt: now + 60_000,
        verification: {
          method: "passkey" as const,
          issuer: "my-auth",
          eventId: "verified-proof",
          verifiedAt: now,
        },
      };
      const link = await evidence.linkDevice(input);
      expect(await evidence.linkDevice(input)).toEqual(link);
      await expect(
        evidence.linkDevice({ ...input, subjectId: other.id }),
      ).rejects.toThrow("already used");
      const shared = await evidence.linkDevice({
        ...input,
        subjectId: other.id,
        verification: { ...input.verification, eventId: "other-proof" },
      });
      expect(shared.id).not.toBe(link.id);
      expect(
        await evidence.assessDevice({
          id: link.id,
          subjectId: other.id,
          visitorId,
        }),
      ).toEqual({ status: "invalid", reason: "subject" });
      expect(
        await evidence.assessDevice({
          id: link.id,
          subjectId: subject.id,
          visitorId,
        }),
      ).toMatchObject({ status: "verified-association" });
      await evidence.revokeDevice(link.id, {
        reason: "compromised",
        issuer: "my-auth",
        eventId: "revoke-proof",
      });
      await evidence.revokeDevice(link.id, {
        reason: "logout",
        issuer: "attacker-attempt",
        eventId: "later",
      });
      expect(
        await evidence.assessDevice({
          id: link.id,
          subjectId: subject.id,
          visitorId,
        }),
      ).toEqual({ status: "invalid", reason: "revoked" });
      expect((await evidence.linkDevice(input)).revocation).toMatchObject({
        reason: "compromised",
        issuer: "my-auth",
      });
      expect(await evidence.listDevices(subject.id)).toHaveLength(1);
      await expect(
        evidence.linkDevice({
          ...input,
          verification: { ...input.verification, verifiedAt: now - 301_000 },
        }),
      ).rejects.toThrow("fresh");
      await expect(
        evidence.linkDevice({
          ...input,
          verification: { ...input.verification, verifiedAt: now + 6000 },
        }),
      ).rejects.toThrow("fresh");
    });
    it("checks expiry without cleanup and prevents conflicting concurrent proof reuse", async () => {
      const { evidence, subject, other, visitorId } = await setup();
      const now = Date.now();
      const input = {
        subjectId: subject.id,
        visitorId,
        expiresAt: now + 1000,
        verification: {
          method: "mfa" as const,
          issuer: "auth",
          eventId: "shared-proof",
          verifiedAt: now,
        },
      };
      const results = await Promise.allSettled([
        evidence.linkDevice(input),
        evidence.linkDevice({ ...input, subjectId: other.id }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const link = results.find((r) => r.status === "fulfilled")!;
      if (link.status !== "fulfilled") throw Error("missing link");
      vi.spyOn(Date, "now").mockReturnValue(now + 1001);
      expect(
        await evidence.assessDevice({
          id: link.value.id,
          subjectId: link.value.subjectId,
          visitorId,
        }),
      ).toMatchObject({ status: "invalid", reason: "expired" });
    });
    it("cascades erasure and offers independent session deletion", async () => {
      const { evidence, directory, subject, visitorId } = await setup();
      await evidence.record({
        id: "a",
        type: "login-success",
        subjectId: subject.id,
        sessionId: "session-a",
      });
      await evidence.record({
        id: "b",
        type: "login-success",
        subjectId: subject.id,
        sessionId: "session-b",
      });
      await evidence.deleteSession("session-a");
      expect(await evidence.velocity({ subjectId: subject.id })).toMatchObject({
        total: 1,
      });
      await evidence.linkDevice({
        subjectId: subject.id,
        visitorId,
        expiresAt: Date.now() + 10000,
        verification: {
          method: "oauth",
          issuer: "auth",
          eventId: "login",
          verifiedAt: Date.now(),
        },
      });
      await directory.deleteSubject(subject.id);
      expect(await evidence.velocity({ sessionId: "session-b" })).toMatchObject(
        { total: 0 },
      );
      expect(await evidence.listDevices(subject.id)).toEqual([]);
    });
    it("keeps evidence private even with public score opt-in and rejects forged client evidence", async () => {
      const { identity } = await setup();
      const visitor = createVisitorHandler(
        sql.storage,
        undefined,
        { identity, evidence: true, exposeClientScores: true },
        sql.identities,
        undefined,
        undefined,
        sql.evidence,
      );
      const assessment = await visitor.assess(request(), {
        evidence: {
          edge: {
            source: "edge",
            provider: "cloudflare",
            observedAt: Date.now(),
            botScore: 7,
          },
          authentication: { method: "passkey", verifiedAt: Date.now() },
          action: "payment",
        },
      });
      expect(assessment.evidence).toMatchObject({
        client: { authenticated: false },
        edge: { botScore: 7 },
        authentication: { source: "authentication", method: "passkey" },
        application: { action: "payment" },
      });
      const body = await assessment.response.text();
      expect(body).not.toMatch(/botScore|passkey|payment|evidence/);
      expect(
        (
          await visitor.handle(
            request({ signals, evidence: { edge: { botScore: 99 } } }),
          )
        ).status,
      ).toBe(400);
      const noContext = await visitor.assess(request());
      expect(noContext.evidence).toEqual({
        client: { source: "browser", authenticated: false },
      });
      const stale = await visitor.assess(request(), {
        evidence: {
          edge: {
            source: "edge",
            provider: "cloudflare",
            observedAt: Date.now() - 61_000,
            botScore: 99,
          },
        },
      });
      expect(stale.response.status).toBe(503);
      expect(stale.identity).toBeUndefined();
    });
    it("bounds inputs, rejects arbitrary collected data and restricts event ingestion to server APIs", async () => {
      const { evidence, subject } = await setup();
      await expect(
        evidence.record({
          id: "bad",
          type: "login-attempt",
          subjectId: subject.id,
          url: "https://private",
        } as never),
      ).rejects.toThrow();
      await expect(
        evidence.record({
          id: "x".repeat(257),
          type: "login-attempt",
          subjectId: subject.id,
        }),
      ).rejects.toThrow();
      await expect(
        evidence.velocity({ subjectId: subject.id, sessionId: "two" }),
      ).rejects.toThrow();
      await expect(
        evidence.velocity({ subjectId: subject.id, windowMs: 86_400_001 }),
      ).rejects.toThrow();
      await expect(evidence.listDevices(subject.id, 101)).rejects.toThrow();
    });

    it("cleans bounded expiry pages without applying one namespace's retention to another", async () => {
      const { evidence, identity, subject, visitorId } = await setup();
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      const other = createEvidence(sql.evidence, {
        ...identity,
        namespace: "separate-retention",
      });
      for (let i = 0; i < 102; i++)
        await evidence.record({
          id: `expire-${i}`,
          type: "login-attempt",
          subjectId: subject.id,
        });
      await other.record({
        id: "keep-until-own-cleanup",
        type: "login-attempt",
        subjectId: subject.id,
      });
      const link = await evidence.linkDevice({
        subjectId: subject.id,
        visitorId,
        expiresAt: now + 1000,
        verification: {
          method: "mfa",
          issuer: "auth",
          eventId: "cleanup-link",
          verifiedAt: now,
        },
      });
      clock.mockReturnValue(now + 92 * 86_400_000);
      expect(await evidence.velocity({ subjectId: subject.id })).toMatchObject({
        total: 0,
      });
      await evidence.cleanup();
      const rows = await sql.query(
        "SELECT id FROM application_events WHERE subject_id = $1",
        [subject.id],
      );
      expect(rows).toHaveLength(3); // Two in this scope, one belongs to another scope.
      expect(
        await evidence.assessDevice({
          id: link.id,
          subjectId: subject.id,
          visitorId,
        }),
      ).toMatchObject({ reason: "missing" });
      await evidence.cleanup();
      expect(
        await sql.query(
          "SELECT id FROM application_events WHERE subject_id = $1",
          [subject.id],
        ),
      ).toHaveLength(1);
    });
  });

it("reads optional edge evidence only from the Worker cf property, never spoofed headers", () => {
  expect(cloudflareRequestEvidence(request())).toBeUndefined();
  const inbound = request();
  Object.defineProperty(inbound, "cf", {
    value: {
      botManagement: {
        score: 42,
        verifiedBot: false,
        signedAgent: true,
        ja4: "not-collected",
        detectionIds: [99],
      },
      country: "not-collected",
    },
  });
  const edge = cloudflareRequestEvidence(inbound)!;
  expect(edge).toMatchObject({
    botScore: 42,
    verifiedBot: false,
    signedAgent: true,
  });
  expect(Object.keys(edge).sort()).toEqual(
    [
      "botScore",
      "observedAt",
      "provider",
      "signedAgent",
      "source",
      "verifiedBot",
    ].sort(),
  );
  expect(() => requestEvidence({ edge: { ...edge, botScore: 0 } })).toThrow();
  expect(() =>
    requestEvidence({ edge: { ...edge, forwardedIp: "127.0.0.1" } } as never),
  ).toThrow();
});
