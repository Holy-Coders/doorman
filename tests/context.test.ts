import { afterEach, describe, expect, it, vi } from "vitest";
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";
import { createDoorman as createCloudflareDoorman } from "@aarondovturkel/doorman-adapters/cloudflare";
import {
  createJevMethods,
  createRiskInput,
  createJevInput,
} from "@aarondovturkel/doorman-evaluator-jev";
import { normalizeObservation } from "@aarondovturkel/doorman-core";
import { createReputation } from "../packages/adapters/src/reputation.js";
import { sqlBackend } from "./helpers/sql.js";
import { signals, phone } from "./helpers/fixtures.js";

const config = {
  secret: "context-test-secret-which-is-at-least-32-characters",
  namespace: "context-test",
};
const request = (cookie = "", body: unknown = { signals }) =>
  new Request("https://example.com/api/visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
afterEach(() => vi.unstubAllGlobals());

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind}: unified context`, () => {
    it("remembers shared browser users without claiming current authentication or leaking candidates", async () => {
      const backend = await sqlBackend(kind);
      try {
        const service =
          kind === "postgres"
            ? createDoorman({
                ...config,
                db: backend.db as Parameters<typeof createDoorman>[0]["db"],
              })
            : createCloudflareDoorman({ ...config, db: backend.db });
        const first = await service.assess(request(), {
          auth: { userId: "alice", accountId: "home" },
        });
        expect(first.response.status).toBe(200);
        expect(first.context?.status).toBe("authenticated");
        const cookie = cookies(first.response);
        const next = await service.assess(request(cookie));
        expect(next.context?.status).toBe("remembered");
        expect(next.identity?.attribution?.subject.status).toBe("unknown");
        expect(await next.response.json()).toEqual({
          visitorId: first.identity!.visitorId,
          sessionId: first.identity!.sessionId,
          isReturning: true,
        });
        expect(next.properties?.doorman_candidate_subject_id).toBe(
          first.context?.candidates[0]?.subjectId,
        );
        expect(next.properties?.doorman_subject_id).toBeUndefined();
        await service.assess(request(cookie), {
          auth: { userId: "bob", accountId: "home" },
        });
        const shared = await service.assess(request(cookie));
        expect(shared.context?.status).toBe("ambiguous");
        expect(shared.context?.candidates).toHaveLength(2);
        expect(shared.properties?.doorman_candidate_subject_id).toBeUndefined();
        const lost = await service.assess(request());
        expect(lost.identity?.visitorId).not.toBe(first.identity?.visitorId);
        expect(lost.context?.basis).toBe("browser-similarity");
        expect(lost.context?.status).toBe("ambiguous");
        const unrelated = await service.assess(request("", { signals: phone }));
        expect(unrelated.context?.status).toBe("unknown");
        await service.forgetUser!("alice");
        const remaining = await service.assess(request(cookie));
        expect(remaining.context?.candidates).toHaveLength(1);
        expect(remaining.context?.candidates[0]?.subjectId).not.toBe(
          first.context?.candidates[0]?.subjectId,
        );
        await service.deleteVisitor(first.identity!.visitorId);
        const rows = await backend.query("SELECT * FROM browser_associations");
        expect(rows).toHaveLength(0);
      } finally {
        await backend.close();
      }
    }, 30_000);
    it("upserts authenticated associations, isolates tenants, expires history and rejects client identity claims", async () => {
      const backend = await sqlBackend(kind);
      try {
        const make = (namespace: string) =>
          kind === "postgres"
            ? createDoorman({
                ...config,
                namespace,
                db: backend.db as Parameters<typeof createDoorman>[0]["db"],
              })
            : createCloudflareDoorman({ ...config, namespace, db: backend.db });
        const service = make("a");
        const context = {
          auth: {
            userId: "owner",
            accountId: "team",
            actor: { id: "agent-1", kind: "agent" as const },
          },
        };
        const first = await service.assess(request(), context);
        const cookie = cookies(first.response);
        await service.assess(request(cookie), context);
        expect(
          await backend.query("SELECT * FROM browser_associations"),
        ).toHaveLength(1);
        expect(first.context?.candidates[0]?.actorKind).toBe("agent");
        expect((await make("b").assess(request(cookie))).context?.status).toBe(
          "unknown",
        );
        expect(
          (
            await service.handle(
              request("", { signals, auth: { userId: "forged" } }),
            )
          ).status,
        ).toBe(400);
        await service.forgetUser!("agent-1");
        expect((await service.assess(request(cookie))).context?.status).toBe(
          "unknown",
        );
        await service.assess(request(cookie), context);
        await backend.query("UPDATE browser_associations SET expires_at=0");
        expect((await service.assess(request(cookie))).context?.status).toBe(
          "unknown",
        );
        await service.cleanup();
        expect(
          await backend.query("SELECT * FROM browser_associations"),
        ).toHaveLength(0);
      } finally {
        await backend.close();
      }
    }, 30_000);
  });

describe("cross-device suggestions", () => {
  it("uses confirmed login examples without changing IDs, authentication or analytics identity", async () => {
    const backend = await sqlBackend("postgres");
    try {
      const predictIdentity = vi.fn(
        async (
          input: import("@aarondovturkel/doorman-core").CrossDeviceInput,
        ) => ({ subjectId: input.examples[0]?.subjectId, score: 0.93 }),
      );
      const service = createDoorman({
        ...config,
        db: backend.db as Parameters<typeof createDoorman>[0]["db"],
        crossDevice: true,
        evaluator: {
          evaluate: async () => ({
            sameVisitor: 0.99,
            automation: 0,
            suspicious: 0,
          }),
          predictIdentity,
        },
      });
      const anonymous = await service.assess(request());
      expect(anonymous.context?.status).toBe("unknown");
      const verified = await service.assess(
        request(cookies(anonymous.response)),
        { auth: { userId: "person-a" } },
      );
      expect(verified.context?.status).toBe("authenticated");
      const fresh = await service.assess(request("", { signals: phone }));
      expect(fresh.context).toMatchObject({
        status: "inferred",
        basis: "login-history",
        calibrated: false,
      });
      expect(fresh.context?.candidates[0]?.subjectId).toBe(
        verified.context?.candidates[0]?.subjectId,
      );
      expect(fresh.identity?.visitorId).not.toBe(verified.identity?.visitorId);
      expect(fresh.identity?.attribution?.subject.status).toBe("unknown");
      expect(fresh.properties?.doorman_subject_id).toBeUndefined();
      expect(await fresh.response.json()).not.toHaveProperty("context");
      expect(predictIdentity).toHaveBeenCalled();
      await service.forgetUser!("person-a");
      const later = await service.assess(request("", { signals: phone }));
      expect(later.context?.status).toBe("unknown");
    } finally {
      await backend.close();
    }
  });
  it("shares reputation quota across adapter instances and keeps provider failure optional", async () => {
    const backend = await sqlBackend("postgres");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 500 })),
    );
    try {
      const options = {
        ...config,
        db: backend.db as Parameters<typeof createDoorman>[0]["db"],
        reputation: { apiKey: "test", maxRequestsPerHour: 1 },
      };
      const first = await createDoorman(options).assess(request(), {
        clientIp: "8.8.8.8",
      });
      expect(first.response.status).toBe(200);
      expect(first.riskEvidence?.reputation?.status).toBe("unavailable");
      const second = await createDoorman(options).assess(request(), {
        clientIp: "1.1.1.1",
      });
      expect(second.response.status).toBe(200);
      expect(second.riskEvidence?.reputation?.status).toBe("limited");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await backend.close();
    }
  });
});

describe("operator assessment", () => {
  it("abstains on sparse sessions and keeps human/assistant/script scores private", async () => {
    const backend = await sqlBackend("postgres");
    const calls: import("@aarondovturkel/doorman-core").EvaluationInput[] = [];
    try {
      const service = createDoorman({
        ...config,
        db: backend.db as Parameters<typeof createDoorman>[0]["db"],
        evaluator: {
          evaluate: async (input) => {
            calls.push(input);
            return {
              sameVisitor: 0.9,
              automation: 0.8,
              suspicious: 0.1,
              operator: { human: 0.1, assistant: 0.9, automation: 0.2 },
            };
          },
        },
      });
      const first = await service.assess(request());
      expect(first.identity?.operator).toMatchObject({
        status: "insufficient-evidence",
        label: "unknown",
      });
      expect(calls[0]?.classifyOperator).toBe(false);
      const second = await service.assess(request(cookies(first.response)), {
        riskEvidence: {
          activity: {
            windowMs: 60000,
            requests: 40,
            denials: 0,
            authenticationFailures: 0,
          },
        },
      });
      expect(calls.at(-1)?.classifyOperator).toBe(true);
      expect(second.identity?.operator).toMatchObject({
        status: "evaluated",
        label: "assistant",
        calibrated: false,
      });
      expect(second.properties?.doorman_assistant_score).toBe(0.9);
      expect(JSON.stringify(await second.response.json())).not.toMatch(
        /assistant|operator|score/,
      );
    } finally {
      await backend.close();
    }
  });
  it("adds typed operator questions only to the risk request when explicitly enabled", () => {
    const current = normalizeObservation(signals);
    const input = createRiskInput(current, undefined, true);
    expect(Object.keys(input.questions)).toEqual(
      expect.arrayContaining(["human", "assistant", "script"]),
    );
    expect(Object.keys(createRiskInput(current).questions)).toEqual([
      "automation",
      "suspicious",
    ]);
    expect(
      Object.keys(
        createJevInput({
          current,
          history: [],
          deterministicSimilarity: 0,
          classifyOperator: true,
        }).questions,
      ),
    ).toEqual(["sameVisitor"]);
  });
});

describe("private risk evidence", () => {
  it("reaches only Jev's risk question, never its identity, raw IP or transport state", async () => {
    const evidence = {
      activity: {
        windowMs: 60000,
        requests: 100,
        denials: 90,
        authenticationFailures: 20,
      },
      reputation: {
        provider: "abuseipdb" as const,
        status: "available" as const,
        observedAt: Date.now(),
        cached: false,
        score: 0.9,
        totalReports: 20,
      },
    };
    const current = normalizeObservation(signals);
    const a = createJevInput({
      current,
      history: [current],
      deterministicSimilarity: 1,
      riskEvidence: evidence,
    });
    expect(JSON.stringify(a)).not.toContain("abuseipdb");
    expect(createRiskInput(current, evidence).state).toHaveProperty(
      "serverEvidence.reputation.score",
      0.9,
    );
    const calls: unknown[] = [];
    const evaluator = createJevMethods(async (input) => {
      calls.push(input);
      return {
        answers: Object.fromEntries(
          Object.keys(input.questions).map((k) => [
            k,
            { type: "noul", noul: 0.9 },
          ]),
        ),
      };
    });
    await evaluator.evaluateCandidates!({
      current,
      candidates: [{ history: [current], deterministicSimilarity: 1 }],
      riskEvidence: evidence,
    });
    expect(
      calls.filter((c) => JSON.stringify(c).includes('"abuseipdb"')),
    ).toHaveLength(1);
  });
  it("bounds, caches and coalesces read-only IP lookups without exposing raw responses", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          ipAddress: "8.8.8.8",
          isPublic: true,
          abuseConfidenceScore: 80,
          totalReports: 4,
          lastReportedAt: null,
          isp: "not retained",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = createReputation(
      { apiKey: "test", maxRequestsPerHour: 1 },
      config,
    );
    const [a, b] = await Promise.all([
      provider.check("8.8.8.8"),
      provider.check("8.8.8.8"),
    ]);
    expect(a.score).toBe(0.8);
    expect(b.status).toBe("available");
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(a)).not.toContain("8.8.8.8");
    expect(JSON.stringify(a)).not.toContain("not retained");
    expect((await provider.check("1.1.1.1")).status).toBe("limited");
    expect((await provider.check("127.0.0.1")).status).toBe("not-requested");
    expect((await provider.check("::ffff:127.0.0.1")).status).toBe(
      "not-requested",
    );
  });
  it("fails open on provider errors and malformed output with a negative cache", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ data: { abuseConfidenceScore: 400 } }),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = createReputation({ apiKey: "test" }, config);
    expect((await provider.check("8.8.8.8")).status).toBe("unavailable");
    expect((await provider.check("8.8.8.8")).cached).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
