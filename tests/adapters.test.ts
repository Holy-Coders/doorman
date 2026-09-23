import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import {
  createNodeVisitor,
  createVisitorHandler,
} from "@aarondovturkel/doorman-adapters/node";
import { createVercelVisitor } from "@aarondovturkel/doorman-adapters/vercel";
import { createCloudflareVisitor } from "@aarondovturkel/doorman-adapters/cloudflare";
import type { D1Database } from "@aarondovturkel/doorman-storage-d1";
import type { VisitorIdentity } from "@aarondovturkel/doorman-core";
import { createMemoryStorage } from "./helpers/memory.js";
import { evaluation, signals } from "./helpers/fixtures.js";
function request(
  body: unknown = { signals },
  headers: Record<string, string> = {},
) {
  return new Request("https://example.com/api/visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
for (const backend of ["node", "vercel", "cloudflare"] as const) {
  describe(`${backend} high-level adapter`, () => {
    let handler: ReturnType<typeof createNodeVisitor>;
    let postgres: PGlite;
    let miniflare: Miniflare;
    beforeAll(async () => {
      const storageType = backend === "cloudflare" ? "d1" : "postgres";
      const schema = await readFile(
        new URL(
          `../packages/storage/${storageType}/migrations/0001_visitors.sql`,
          import.meta.url,
        ),
        "utf8",
      );
      if (backend === "cloudflare") {
        miniflare = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          d1Databases: ["VISITORS"],
        });
        const db = await miniflare.getD1Database("VISITORS");
        for (const sql of schema.split(";").filter((sql) => sql.trim()))
          await db.prepare(sql).run();
        handler = createCloudflareVisitor({
          exposeClientScores: true,
          db: db as unknown as D1Database,
          ai: {
            run: async () => ({
              answers: Object.fromEntries(
                Object.entries(evaluation).map(([name, noul]) => [
                  name,
                  { type: "noul", noul },
                ]),
              ),
            }),
          },
        });
      } else {
        postgres = new PGlite();
        await postgres.exec(schema);
        handler = (
          backend === "node" ? createNodeVisitor : createVercelVisitor
        )({
          exposeClientScores: true,
          db: postgres,
          evaluator: { evaluate: async () => evaluation },
        });
      }
    }, 30_000);
    afterAll(async () => {
      await postgres?.close();
      await miniflare?.dispose();
    });
    it("sets a secure cookie and restores the ID on cookie and cookieless requests", async () => {
      const first = await handler.handle(request());
      expect(first.status).toBe(200);
      const cookie = first.headers.get("set-cookie")!;
      for (const flag of [
        "__visitor=vis_",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
      ])
        expect(cookie).toContain(flag);
      const id = ((await first.json()) as VisitorIdentity).visitorId;
      const second = await handler.handle(
        request({ signals }, { Cookie: cookie.split(";")[0]! }),
      );
      expect(await second.json()).toMatchObject({
        visitorId: id,
        isReturning: true,
        confidence: 1,
      });
      const restored = await handler.handle(request());
      expect(await restored.json()).toMatchObject({
        visitorId: id,
        isReturning: true,
      });
      await handler.deleteVisitor(id);
      await handler.cleanup();
    });
  });
}
describe("HTTP boundary", () => {
  it.each([
    [{ signals: { userAgent: "x".repeat(513) } }, 400],
    [{ signals: { languages: Array(21).fill("en") } }, 400],
    [{ signals: { screen: { width: -1 } } }, 400],
    [{ signals: { formValues: "never retain me" } }, 400],
    [{ signals: { automation: { webdriver: "false" } } }, 400],
    [{ signals: null }, 400],
    [{ signals: {}, behavior: { actualKey: "secret" } }, 400],
    [{ signals: { userAgent: "x".repeat(20_000) } }, 413],
  ])("rejects invalid or oversized payloads", async (body, status) => {
    expect(
      (
        await createVisitorHandler(createMemoryStorage(), undefined).handle(
          request(body),
        )
      ).status,
    ).toBe(status);
  });
  it("enforces size limits on streamed bodies without Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(17_000));
        controller.close();
      },
    });
    const req = new Request("https://example.com/api/visitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(
      (await createVisitorHandler(createMemoryStorage(), undefined).handle(req))
        .status,
    ).toBe(413);
  });
  it("rejects bad methods, cross-origin requests, invalid JSON and incorrect content types", async () => {
    const handler = createVisitorHandler(createMemoryStorage(), undefined);
    expect(
      (await handler.handle(new Request("https://example.com/api/visitor")))
        .status,
    ).toBe(405);
    expect(
      (
        await handler.handle(
          request({ signals }, { origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler.handle(
          request({ signals }, { "content-type": "text/plain" }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await handler.handle(
          new Request("https://example.com/api/visitor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{bad",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("only exposes debug with explicit non-production server and browser opt-in", async () => {
    expect(() =>
      createVisitorHandler(createMemoryStorage(), undefined, { debug: true }),
    ).toThrow("non-production");
    const handler = createVisitorHandler(createMemoryStorage(), undefined, {
      debug: true,
      exposeClientScores: true,
      environment: "test",
    });
    expect(
      (await (await handler.handle(request({ signals }))).json()).debug,
    ).toBeUndefined();
    expect(
      (await (await handler.handle(request({ signals, debug: true }))).json())
        .debug,
    ).toBeDefined();
  });
  it("returns a sanitized no-store 503 for storage failure without setting a cookie", async () => {
    const storage = createMemoryStorage();
    vi.spyOn(storage, "findCandidates").mockRejectedValue(
      new Error("SECRET DATABASE CREDENTIAL"),
    );
    const response = await createVisitorHandler(storage, undefined).handle(
      request(),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects unsafe production configuration and keeps logging free of fingerprint payloads", async () => {
    const storage = createMemoryStorage();
    expect(() =>
      createVisitorHandler(storage, undefined, {
        cookie: { name: "bad;name" },
      }),
    ).toThrow();
    expect(() =>
      createVisitorHandler(storage, undefined, { cookie: { secure: false } }),
    ).toThrow();
    const onMetrics = vi.fn();
    await createVisitorHandler(storage, undefined, { onMetrics }).handle(
      request(),
    );
    expect(Object.keys(onMetrics.mock.calls[0]?.[0])).toEqual([
      "candidateCount",
      "lookupPlanned",
      "candidatesEvaluated",
      "lookupSaturated",
      "deterministicScore",
      "finalConfidence",
      "evaluatorUsed",
      "evaluatorLatency",
      "isReturning",
      "observationSaved",
    ]);
  });
});

describe("verified cross-device subjects", () => {
  const secret = "a".repeat(64);
  const options = {
    exposeClientScores: true,
    subjectLinking: { secret, namespace: "test-app" },
  };
  it("links a verified account across different browsers without merging visitor IDs or sharing account data with the evaluator", async () => {
    const evaluate = vi.fn(async () => evaluation);
    const handler = createVisitorHandler(
      createMemoryStorage(),
      { evaluate },
      options,
    );
    const first = await (
      await handler.handle(request(), { authenticatedSubject: "account-123" })
    ).json();
    const phone = {
      ...signals,
      platform: "iPhone",
      userAgent: "Version/18 Safari/605",
      hardware: { maxTouchPoints: 5 },
    };
    const second = await (
      await handler.handle(request({ signals: phone }), {
        authenticatedSubject: "account-123",
      })
    ).json();
    expect(first.subjectId).toMatch(/^sub_[a-f0-9]{64}$/);
    expect(second.subjectId).toBe(first.subjectId);
    expect(second.visitorId).not.toBe(first.visitorId);
    expect(second.isReturning).toBe(false);
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain("account-123");
    const loggedOut = await (
      await handler.handle(
        request({ signals }, { Cookie: `__visitor=${first.visitorId}` }),
      )
    ).json();
    expect(loggedOut.visitorId).toBe(first.visitorId);
    expect(loggedOut.subjectId).toBeUndefined();
  });
  it("ignores identity headers, rejects body claims, and only adds subjects for verified context", async () => {
    const handler = createVisitorHandler(
      createMemoryStorage(),
      undefined,
      options,
    );
    const anonymous = await (
      await handler.handle(request({ signals }, { "x-user-id": "account-123" }))
    ).json();
    expect(anonymous.subjectId).toBeUndefined();
    expect(
      (
        await handler.handle(
          request({ signals, authenticatedSubject: "account-123" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handler.handle(request(), { authenticatedSubject: "" })).status,
    ).toBe(400);
    expect(
      (
        await createVisitorHandler(createMemoryStorage(), undefined).handle(
          request(),
          { authenticatedSubject: "account-123" },
        )
      ).status,
    ).toBe(500);
  });
  it("separates accounts, application namespaces and secrets", async () => {
    const derive = async (account: string, namespace: string, key = secret) =>
      (
        await (
          await createVisitorHandler(createMemoryStorage(), undefined, {
            exposeClientScores: true,
            subjectLinking: { secret: key, namespace },
          }).handle(request(), { authenticatedSubject: account })
        ).json()
      ).subjectId;
    const ids = await Promise.all([
      derive("a", "one"),
      derive("b", "one"),
      derive("a", "two"),
      derive("a", "one", "b".repeat(64)),
    ]);
    expect(new Set(ids).size).toBe(4);
    expect(await derive("a", "one")).toBe(ids[0]);
    expect(() =>
      createVisitorHandler(createMemoryStorage(), undefined, {
        subjectLinking: { secret: "short", namespace: "one" },
      }),
    ).toThrow();
  });
});

it("accepts bounded extended summaries while rejecting trajectories and excessive values", async () => {
  const handler = createVisitorHandler(createMemoryStorage(), undefined);
  const behavior = {
    pageAgeMs: 2000,
    mouseMoveCount: 10,
    pointerDownCount: 1,
    keyDownCount: 0,
    scrollCount: 2,
    visibilityChangeCount: 0,
    mouseDistancePx: 150,
    mouseActiveMs: 120,
    mouseDirectionChanges: 2,
    mousePauseCount: 0,
    scrollDistancePx: 100,
    scrollDirectionChanges: 1,
    interactionIntervalCount: 0,
  };
  expect((await handler.handle(request({ signals, behavior }))).status).toBe(
    200,
  );
  expect(
    (
      await handler.handle(
        request({ signals, behavior: { ...behavior, mouseDistancePx: 1e12 } }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handler.handle(
        request({
          signals,
          behavior: {
            ...behavior,
            path: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
      )
    ).status,
  ).toBe(400);
});

it("times out and cancels an unfinished request body without creating a visitor", async () => {
  const cancel = vi.fn();
  const storage = createMemoryStorage();
  const stream = new ReadableStream({ cancel });
  const req = new Request("https://example.com/api/visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  const response = await createVisitorHandler(storage, undefined, {
    requestTimeoutMs: 100,
  }).handle(req);
  expect(response.status).toBe(408);
  expect(cancel).toHaveBeenCalledOnce();
  expect(storage.rows.size).toBe(0);
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("keeps scores, linked subjects and debug server-side even when the browser requests diagnostics", async () => {
  const handler = createVisitorHandler(
    createMemoryStorage(),
    { evaluate: async () => evaluation },
    {
      environment: "test",
      debug: true,
      subjectLinking: { secret: "x".repeat(64), namespace: "test" },
    },
  );
  const { identity, response } = await handler.assess(
    request({ signals, debug: true }),
    { authenticatedSubject: "account-private" },
  );
  expect(identity).toMatchObject({
    subjectId: expect.any(String),
    debug: expect.any(Object),
  });
  expect(identity?.risk).toEqual({
    automation: evaluation.automation,
    suspicious: evaluation.suspicious,
  });
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["isReturning", "visitorId"]);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(
    (await handler.assess(request({ signals, exposeClientScores: true })))
      .identity,
  ).toBeUndefined();
  expect(
    (await handler.handle(request({ signals }, { "x-expose-scores": "true" })))
      .status,
  ).toBe(200);
});

it("does not cross-contaminate concurrent private assessments or expose failed results", async () => {
  const handler = createVisitorHandler(createMemoryStorage(), {
    evaluate: async ({ current }) => ({
      sameVisitor: 0,
      automation: current.automation?.webdriver ? 1 : 0,
      suspicious: 0,
    }),
  });
  const results = await Promise.all(
    [true, false].map((webdriver) =>
      handler.assess(request({ signals: { automation: { webdriver } } })),
    ),
  );
  expect(results.map((r) => r.identity?.risk.automation)).toEqual([1, 0]);
  for (const result of results)
    expect(Object.keys(await result.response.json()).sort()).toEqual([
      "isReturning",
      "visitorId",
    ]);
  const invalid = await handler.assess(
    request({ signals: { platform: "x".repeat(10000) } }),
  );
  expect(invalid.response.status).toBe(400);
  expect(invalid.identity).toBeUndefined();
});

it("composes Cloudflare AI with Postgres and keeps its result private", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL(
          "../packages/storage/postgres/migrations/0001_visitors.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const visitor = createCloudflareVisitor({
      db,
      ai: {
        run: async () => ({
          answers: {
            sameVisitor: { type: "noul", noul: 0.9 },
            automation: { type: "noul", noul: 0.93 },
            suspicious: { type: "noul", noul: 0.2 },
          },
        }),
      },
    });
    const first = await visitor.assess(request());
    expect(first.identity?.risk.automation).toBe(0.93);
    expect(Object.keys(await first.response.json()).sort()).toEqual([
      "isReturning",
      "visitorId",
    ]);
    const next = await visitor.assess(
      request(
        { signals },
        { Cookie: first.response.headers.get("set-cookie")!.split(";")[0]! },
      ),
    );
    expect(next.identity?.visitorId).toBe(first.identity?.visitorId);
    expect(next.identity?.isReturning).toBe(true);
  } finally {
    await db.close();
  }
});
