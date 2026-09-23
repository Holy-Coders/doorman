import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import { createNodeVisitor } from "@janitor/adapters/node";
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";
import { createD1LearningStorage, type D1Database } from "@janitor/storage-d1";
import { createPostgresLearningStorage } from "@janitor/storage-postgres";
import {
  normalizeObservation,
  type LearningOptions,
  type LearningStorage,
  type LearningSession,
} from "@janitor/core";
import { signals } from "./helpers/fixtures.js";

const request = (cookie = "", observation = signals, extra = {}) =>
  new Request("https://app.test/api/visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ signals: observation, ...extra }),
  });
const cookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith("__visitor_learning="))
    ?.split(";")[0] ?? "";
const sessionId = (r: Response) => cookie(r).split("=")[1]!;

for (const backend of ["postgres", "d1"] as const) {
  describe(`${backend} opt-in learning (real SQL)`, () => {
    let pg: PGlite;
    let mf: Miniflare;
    let db: D1Database;
    let storage: LearningStorage;
    let namespace = 0;
    const create = (
      learning: false | LearningOptions = { enabled: true },
      scope = `learning-${++namespace}`,
    ) => {
      const options = {
        identity: { secret: "l".repeat(64), namespace: scope },
        learning,
      };
      return backend === "postgres"
        ? createNodeVisitor({ db: pg, evaluator: false, ...options })
        : createCloudflareVisitor({ db, ...options });
    };
    beforeAll(async () => {
      const schemas = await Promise.all(
        ["0001_visitors", "0002_identity", "0003_learning"].map((name) =>
          readFile(
            new URL(
              `../packages/storage/${backend}/migrations/${name}.sql`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
      if (backend === "postgres") {
        pg = new PGlite();
        await pg.exec(schemas.join("\n"));
        storage = createPostgresLearningStorage(pg);
      } else {
        mf = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          d1Databases: ["VISITORS"],
        });
        db = (await mf.getD1Database("VISITORS")) as unknown as D1Database;
        for (const sql of schemas
          .join("\n")
          .split(";")
          .filter((s) => s.trim()))
          await db.prepare(sql).run();
        storage = createD1LearningStorage(db);
      }
    }, 30000);
    afterAll(async () => {
      await pg?.close();
      await mf?.dispose();
    });

    it("requires both configuration and server-side session permission", async () => {
      const off = create(false);
      expect(off.learning).toBeUndefined();
      expect(
        cookie(await off.handle(request(), { learningConsent: true })),
      ).toBe("");
      const visitor = create();
      const denied = await visitor.handle(request());
      expect(denied.status).toBe(200);
      expect(cookie(denied)).toBe("");
      expect(await visitor.learning!.reports()).toEqual([]);
      expect(
        (await visitor.handle(request("", signals, { learningConsent: true })))
          .status,
      ).toBe(400);
      const allowed = await visitor.handle(request(), {
        learningConsent: true,
      });
      expect(allowed.status).toBe(200);
      expect(cookie(allowed)).toMatch(/=ses_[a-f0-9]{48}$/);
      expect(allowed.headers.getSetCookie()[1]).toContain(
        "HttpOnly; Secure; SameSite=Lax",
      );
    });
    it("supports application collection without per-request consent and honors an explicit opt-out", async () => {
      const visitor = create({
        enabled: true,
        collectionPolicy: "application",
      });
      const first = await visitor.handle(request());
      expect(cookie(first)).toMatch(/=ses_[a-f0-9]{48}$/);
      const stopped = await visitor.handle(request(cookie(first)), {
        learningConsent: false,
      });
      expect(stopped.status).toBe(200);
      expect(stopped.headers.getSetCookie()[1]).toContain("Max-Age=0");
      expect(() =>
        create({ enabled: true, collectionPolicy: "invalid" as "application" }),
      ).toThrow();
    });
    it("labels only the pre-login snapshot and freezes it after verification", async () => {
      const visitor = create();
      const owner = await visitor.identities!.updateSubject({
        id: "person",
        kind: "person",
      });
      const first = await visitor.handle(request(), { learningConsent: true });
      const second = await visitor.handle(
        request(cookie(first), { ...signals, timezone: "Europe/London" }),
        { learningConsent: true },
      );
      expect(cookie(second)).toBe(cookie(first));
      const context = {
        learningConsent: true,
        verified: { subjectId: owner.id, actorId: owner.id },
      };
      const login = await visitor.handle(
        request(cookie(first), { ...signals, timezone: "Asia/Tokyo" }),
        context,
      );
      expect(login.status).toBe(200);
      expect(login.headers.getSetCookie()[1]).toContain("Max-Age=0");
      await visitor.handle(
        request(cookie(first), { ...signals, timezone: "America/New_York" }),
        context,
      );
      const reports = await visitor.learning!.reports();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        subjectId: owner.id,
        observation: { timezone: "Europe/London" },
        prediction: { status: "not-run" },
      });
      expect(JSON.stringify(await login.json())).not.toContain(
        sessionId(first),
      );
      const next = await visitor.handle(request(), { learningConsent: true });
      expect(cookie(next)).not.toBe(cookie(first));
    });
    it("never promotes a restored browser identity into an account label", async () => {
      const visitor = create();
      const owner = await visitor.identities!.updateSubject({
        id: "person",
        kind: "person",
      });
      const first = await visitor.handle(request(), { learningConsent: true });
      const identity = await first.json();
      await visitor.handle(request(cookie(first)), {
        learningConsent: true,
        verified: { subjectId: owner.id, actorId: owner.id },
      });
      const next = await visitor.handle(
        request(`__visitor=${identity.visitorId}`),
        { learningConsent: true },
      );
      expect((await next.json()).attribution.subject.status).toBe("unknown");
      expect(await visitor.learning!.reports()).toHaveLength(1);
    });
    it("excludes unknown actors, agents and separately authenticated family members", async () => {
      const visitor = create();
      const owner = await visitor.identities!.updateSubject({
        id: "owner",
        kind: "person",
      });
      const agent = await visitor.identities!.updateSubject({
        id: "agent",
        kind: "agent",
      });
      const family = await visitor.identities!.updateSubject({
        id: "family",
        kind: "person",
      });
      for (const actorId of [undefined, agent.id, family.id]) {
        const first = await visitor.handle(request(), {
          learningConsent: true,
        });
        expect(
          (
            await visitor.handle(request(cookie(first)), {
              learningConsent: true,
              verified: { subjectId: owner.id, actorId },
            })
          ).status,
        ).toBe(200);
      }
      expect(await visitor.learning!.reports()).toEqual([]);
    });
    it("excludes disputed sessions when two accounts confirm the same flow", async () => {
      const visitor = create();
      const accounts = await Promise.all(
        ["one", "two"].map((id) =>
          visitor.identities!.updateSubject({ id, kind: "person" }),
        ),
      );
      const first = await visitor.handle(request(), { learningConsent: true });
      await Promise.all(
        accounts.map((a) =>
          visitor.handle(request(cookie(first)), {
            learningConsent: true,
            verified: { subjectId: a.id, actorId: a.id },
          }),
        ),
      );
      expect(await visitor.learning!.reports()).toEqual([]);
    });
    it("clears and deletes the current session on permission withdrawal", async () => {
      const visitor = create();
      const first = await visitor.handle(request(), { learningConsent: true });
      const denied = await visitor.handle(request(cookie(first)), {
        learningConsent: false,
      });
      expect(denied.headers.getSetCookie()[1]).toContain("Max-Age=0");
      const owner = await visitor.identities!.updateSubject({
        id: "owner",
        kind: "person",
      });
      await visitor.handle(request(cookie(first)), {
        learningConsent: true,
        verified: { subjectId: owner.id, actorId: owner.id },
      });
      expect(await visitor.learning!.reports()).toEqual([]);
    });
    it("keeps namespaces separate even when a learning cookie is replayed", async () => {
      const a = create();
      const b = create();
      const first = await a.handle(request(), { learningConsent: true });
      const owner = await b.identities!.updateSubject({
        id: "owner",
        kind: "person",
      });
      await b.handle(request(cookie(first)), {
        learningConsent: true,
        verified: { subjectId: owner.id, actorId: owner.id },
      });
      expect(await a.learning!.reports()).toEqual([]);
      expect(await b.learning!.reports()).toEqual([]);
    });
    it("runs shadow predictions on verified examples only and keeps them out of browser responses", async () => {
      const predict = vi.fn(
        async (
          input: Parameters<NonNullable<LearningOptions["predict"]>>[0],
        ) => ({ subjectId: input.examples[0]!.subjectId, score: 0.72 }),
      );
      const visitor = create({ enabled: true, mode: "shadow", predict });
      const owner = await visitor.identities!.updateSubject({
        id: "person",
        kind: "person",
      });
      const label = async (first: Response) =>
        visitor.handle(request(cookie(first)), {
          learningConsent: true,
          verified: { subjectId: owner.id, actorId: owner.id },
        });
      const first = await visitor.handle(request(), { learningConsent: true });
      expect(predict).not.toHaveBeenCalled();
      await label(first);
      const second = await visitor.handle(request(), { learningConsent: true });
      const anonymous = await second.json();
      expect(JSON.stringify(anonymous)).not.toContain(owner.id);
      expect(anonymous.attribution.subject.status).toBe("unknown");
      expect(anonymous.riskStatus).toBe("disabled");
      await label(second);
      const reports = await visitor.learning!.reports();
      expect(
        reports.find((r) => r.sessionId === sessionId(second))?.prediction,
      ).toEqual({ status: "suggested", subjectId: owner.id, score: 0.72 });
      await visitor.handle(request(), { learningConsent: true });
      for (const [input] of predict.mock.calls)
        for (const e of input.examples)
          expect(e).not.toHaveProperty("prediction");
      await visitor.identities!.deleteSubject(owner.id);
      expect(await visitor.learning!.reports()).toEqual([]);
    });
    it.each(["throw", "timeout", "unknown", "malformed"])(
      "fails open for %s shadow predictions",
      async (mode) => {
        const predict = async () => {
          if (mode === "throw") throw new Error("private service detail");
          if (mode === "timeout") return new Promise<never>(() => {});
          return {
            subjectId: "unknown",
            score: mode === "malformed" ? NaN : 1,
          };
        };
        const visitor = create({
          enabled: true,
          mode: "shadow",
          evaluatorTimeoutMs: 10,
          predict,
        });
        const owner = await visitor.identities!.updateSubject({
          id: "person",
          kind: "person",
        });
        const context = {
          learningConsent: true,
          verified: { subjectId: owner.id, actorId: owner.id },
        };
        const first = await visitor.handle(request(), {
          learningConsent: true,
        });
        await visitor.handle(request(cookie(first)), context);
        const next = await visitor.handle(request(), { learningConsent: true });
        expect(next.status).toBe(200);
        expect((await next.json()).risk).toEqual({
          automation: 0,
          suspicious: 0,
        });
        await visitor.handle(request(cookie(next)), context);
        expect(
          (await visitor.learning!.reports()).find(
            (r) => r.sessionId === sessionId(next),
          )?.prediction.status,
        ).toBe("unavailable");
      },
    );
    it("expires pending flows, bounds verified examples and cascades deletion", async () => {
      const visitor = create();
      const owner = await visitor.identities!.updateSubject({
        id: "bounded",
        kind: "person",
      });
      const now = Date.now();
      const scope = "sql-retention-test";
      const make = (n: number): LearningSession => ({
        id: `ses_${n.toString(16).padStart(48, "0")}`,
        scope,
        startedAt: now - 1000,
        expiresAt: now + 60000,
        observedAt: now - 500,
        observation: normalizeObservation(signals),
        disputed: false,
        prediction: { status: "not-run" },
      });
      for (let n = 0; n < 22; n++) {
        const s = make(n);
        await storage.insertSession(s);
        await storage.confirmSession(scope, s.id, owner.id, now + n);
      }
      expect(await storage.reports(scope, 0, 100)).toHaveLength(20);
      const expired = { ...make(100), expiresAt: now - 1 };
      await storage.insertSession(expired);
      await storage.confirmSession(scope, expired.id, owner.id, now);
      expect(
        (await storage.getSession(scope, expired.id))?.subjectId,
      ).toBeUndefined();
      await storage.cleanupLearning(scope, now, now - 86400000);
      expect(await storage.getSession(scope, expired.id)).toBeUndefined();
      expect(await storage.reports(scope, now + 1, 100)).toEqual([]);
      await storage.cleanupLearning(scope, now, now + 1);
      expect(await storage.reports(scope, 0, 100)).toEqual([]);
      const s = make(101);
      await storage.insertSession(s);
      await storage.confirmSession(scope, s.id, owner.id, now);
      await storage.updateSession(
        { ...s, observation: normalizeObservation({ timezone: "changed" }) },
        now,
      );
      expect(
        (await storage.getSession(scope, s.id))?.observation.timezone,
      ).toBe(signals.timezone);
      await visitor.identities!.deleteSubject(owner.id);
      expect(await storage.getSession(scope, s.id)).toBeUndefined();
    });
  });
}
