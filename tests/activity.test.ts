import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApiActivity } from "../packages/adapters/src/activity.js";
import { createProtection } from "../packages/adapters/src/protection.js";
import { createVisitorHandler } from "../packages/adapters/src/handler.js";
import {
  createJevMethods,
  createActivityInput,
  API_ACTIVITY_QUESTIONS,
} from "@aarondovturkel/doorman-evaluator-jev";
import { createCloudflareJevEvaluator } from "@aarondovturkel/doorman-evaluator-cloudflare-jev";
import { createJevEvaluator } from "@aarondovturkel/doorman-evaluator-jev";
import type {
  ApiActivityContext,
  ApiActivityInput,
  VisitorEvaluator,
} from "@aarondovturkel/doorman-core";
import { sqlBackend } from "./helpers/sql.js";
import { createApp } from "../examples/node-fastify/src/app.js";
import type { PostgresDatabase } from "@aarondovturkel/doorman-storage-postgres";
import { createSubjectLinker } from "../packages/adapters/src/subject.js";

const route = "GET /api/orders/:id";
const settings = { routes: [{ route, sensitive: true }] };
const context: ApiActivityContext = {
  key: { kind: "actor", id: "private-actor" },
  route,
  actor: { kind: "agent", delegated: true },
};
const outcome = { status: 200, durationMs: 15 };
const credentials = () => ({
  secret: "a".repeat(64),
  namespace: crypto.randomUUID(),
});
const evaluator = (): VisitorEvaluator => ({
  evaluate: vi.fn(),
  evaluateActivity: vi.fn(async () => ({ automation: 0.9, suspicious: 0.1 })),
});
afterEach(() => vi.restoreAllMocks());

it("the Fastify example records only its authenticated route template and leaves API responses private", async () => {
  const backend = await sqlBackend("postgres");
  const token = "test-token-".repeat(4);
  const app = createApp(backend.db as PostgresDatabase, {
    activity: { secret: "s".repeat(64), apiToken: token },
  });
  try {
    const denied = await app.inject({
      method: "GET",
      url: "/api/orders/123",
      headers: { authorization: "Bearer forged" },
    });
    expect(denied.statusCode).toBe(401);
    expect(await backend.query("SELECT * FROM api_activity_buckets")).toEqual(
      [],
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/orders/123?email=private",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.json()).toEqual({ orderId: "123", status: "example" });
    await vi.waitFor(async () =>
      expect(
        await backend.query("SELECT route,requests FROM api_activity_buckets"),
      ).toEqual([{ route: "GET /api/orders/:id", requests: 1 }]),
    );
    expect(
      JSON.stringify(await backend.query("SELECT * FROM api_activity_buckets")),
    ).not.toContain(token);
  } finally {
    await app.close();
    await backend.close();
  }
});

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind} API activity`, () => {
    let db: Awaited<ReturnType<typeof sqlBackend>>;
    beforeAll(async () => {
      db = await sqlBackend(kind);
    });
    afterAll(async () => {
      await db.close();
    });

    it("atomically aggregates concurrent completions without storing raw identifiers or one row per request", async () => {
      const service = createApiActivity(db.activity, credentials(), {
        routes: [{ route }],
        minRequests: 1000,
      });
      await Promise.all(
        Array.from({ length: 24 }, (_, i) =>
          service.observe(context, {
            status: i < 4 ? 500 : 200,
            durationMs: 10,
          }),
        ),
      );
      const result = await service.assess(context);
      expect(result.assessment?.riskStatus).toBe("disabled");
      const rows = result.assessment!.summary.buckets;
      expect(rows.reduce((sum, r) => sum + r.requests, 0)).toBe(24);
      expect(rows.reduce((sum, r) => sum + r.serverErrors, 0)).toBe(4);
      expect(rows.reduce((sum, r) => sum + r.durationTotalMs, 0)).toBe(240);
      const stored = await db.query("SELECT * FROM api_activity_buckets");
      expect(JSON.stringify(stored)).not.toContain("private-actor");
      expect(rows.length).toBeLessThanOrEqual(2);
    });
    it("shares leases and cached assessments across service replicas and isolates actor and route context", async () => {
      const identity = credentials(),
        model = evaluator();
      const config = {
        routes: [
          { route, sensitive: true },
          { route: "POST /api/payment", sensitive: true },
        ],
      };
      const a = createApiActivity(db.activity, identity, config, model);
      const b = createApiActivity(db.activity, identity, config, model);
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          (i % 2 ? a : b).observe(context, outcome),
        ),
      );
      expect(model.evaluateActivity).toHaveBeenCalledOnce();
      expect(results.every((r) => r.status === "recorded")).toBe(true);
      const cached = await b.observe(context, outcome);
      expect(cached.assessment).toMatchObject({
        cached: true,
        risk: { automation: 0.9, suspicious: 0.1 },
      });
      const state = vi.mocked(model.evaluateActivity!).mock.calls[0]![0];
      expect(JSON.stringify(state)).not.toContain("private-actor");
      await a.observe(
        { ...context, actor: { kind: "agent", delegated: false } },
        outcome,
      );
      await a.observe({ ...context, route: "POST /api/payment" }, outcome);
      await a.observe(
        { ...context, key: { kind: "actor", id: "another" } },
        outcome,
      );
      expect(model.evaluateActivity).toHaveBeenCalledTimes(4);
    });
    it("only evaluates count milestones, first denials and sensitive routes", async () => {
      const model = evaluator();
      const service = createApiActivity(
        db.activity,
        credentials(),
        { routes: [{ route }], minRequests: 4 },
        model,
      );
      for (let i = 0; i < 3; i++)
        expect(
          (await service.observe(context, outcome)).assessment,
        ).toBeUndefined();
      expect(model.evaluateActivity).not.toHaveBeenCalled();
      expect(
        (await service.observe(context, outcome)).assessment?.riskStatus,
      ).toBe("evaluated");
      expect(
        (await service.observe(context, outcome)).assessment,
      ).toBeUndefined();
      const denied = await service.observe(
        {
          ...context,
          key: { kind: "session", id: "new-session" },
          actor: undefined,
        },
        { status: 403, durationMs: 0 },
      );
      expect(denied.assessment?.summary.buckets[0]?.denied).toBe(1);
      expect(model.evaluateActivity).toHaveBeenCalledTimes(2);
    });
    it("skips unconfigured routes and opt-outs, rejects unsafe labels and context extras", async () => {
      const increment = vi.spyOn(db.activity, "increment");
      const service = createApiActivity(db.activity, credentials(), settings);
      expect(await service.observe(undefined, outcome)).toEqual({
        status: "skipped",
      });
      expect(
        await service.observe(
          { ...context, route: "GET /unconfigured" },
          outcome,
        ),
      ).toEqual({ status: "skipped" });
      expect(
        await service.observe(
          { ...context, route: "GET /api/orders/123?email=private" },
          outcome,
        ),
      ).toEqual({ status: "unavailable" });
      expect(
        await service.observe(
          { ...context, password: "private" } as ApiActivityContext,
          outcome,
        ),
      ).toEqual({ status: "unavailable" });
      expect(increment).not.toHaveBeenCalled();
      expect(() =>
        createApiActivity(db.activity, credentials(), {
          routes: [{ route: "GET /x?secret=yes" }],
        }),
      ).toThrow();
    });
    it("preserves Web response, unread streams, headers, cookies and application exceptions", async () => {
      const service = createApiActivity(
        db.activity,
        credentials(),
        settings,
        evaluator(),
      );
      const request = new Request(
        "https://app.test/api/orders/123?secret=private",
        {
          method: "POST",
          headers: { authorization: "Bearer secret" },
          body: JSON.stringify({ password: "secret" }),
        },
      );
      const response = new Response("stream body", {
        status: 201,
        headers: { "set-cookie": "app=unchanged" },
      });
      const result = await service.handle(request, context, async (req) => {
        expect(req).toBe(request);
        expect(req.bodyUsed).toBe(false);
        expect(await req.json()).toEqual({ password: "secret" });
        return response;
      });
      expect(result.response).toBe(response);
      expect(result.response.bodyUsed).toBe(false);
      expect(result.response.headers.get("set-cookie")).toBe("app=unchanged");
      expect(await result.response.text()).toBe("stream body");
      expect(JSON.stringify(result.activity)).not.toContain("secret");
      const error = new Error("application failure");
      await expect(
        service.handle(new Request("https://app.test/"), context, () => {
          throw error;
        }),
      ).rejects.toBe(error);
    });
    it("retains five windows, expires caches, fences late writers and erases activity", async () => {
      let now = Math.floor(Date.now() / 60000) * 60000 + 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const model = evaluator(),
        service = createApiActivity(
          db.activity,
          credentials(),
          settings,
          model,
        );
      for (let i = 0; i < 7; i++) {
        await service.observe(context, outcome);
        now += 60000;
      }
      const result = await service.observe(context, outcome);
      expect(result.assessment?.summary.buckets).toHaveLength(5);
      expect(model.evaluateActivity).toHaveBeenCalledTimes(8);
      const id = crypto.randomUUID();
      expect(await db.activity.claim(id, "owner", "old", now, now + 1)).toBe(
        true,
      );
      expect(
        await db.activity.claim(id, "owner", "new", now + 2, now + 1000),
      ).toBe(true);
      await db.activity.save(id, "old", result.assessment!);
      expect(await db.activity.cached(id, now + 3)).toBeUndefined();
      await service.deleteKey(context.key);
      expect(
        (await service.assess(context)).assessment?.summary.buckets,
      ).toEqual([]);
      now += 2 * 86400000;
      for (let i = 0; i < 5; i++) await service.cleanup();
      expect(
        await db.query(
          "SELECT * FROM api_activity_buckets WHERE expires_at <= $1",
          [now],
        ),
      ).toEqual([]);
    });
    it("shares inference budgets with other evaluator methods and fails open on exhaustion", async () => {
      const identity = credentials(),
        model = evaluator();
      const guarded = createProtection(
        db.protection,
        { ...identity, evaluator: { maxCalls: 1 } },
        100,
      ).wrap(model);
      const service = createApiActivity(
        db.activity,
        identity,
        settings,
        guarded,
      );
      expect(
        (await service.observe(context, outcome)).assessment?.riskStatus,
      ).toBe("evaluated");
      const result = await service.observe(
        { ...context, key: { kind: "actor", id: "budget-other" } },
        outcome,
      );
      expect(result.assessment).toMatchObject({
        riskStatus: "unavailable",
        risk: { automation: 0, suspicious: 0 },
      });
      expect(model.evaluateActivity).toHaveBeenCalledOnce();
    });
    it("bounds slow providers and caches malformed/provider failures without retry storms", async () => {
      for (const evaluateActivity of [
        async () => {
          throw new Error("500");
        },
        async () => ({ automation: 2, suspicious: 0 }),
        () => new Promise<never>(() => {}),
      ]) {
        const model = {
          evaluate: vi.fn(),
          evaluateActivity: vi.fn(evaluateActivity),
        };
        const service = createApiActivity(
          db.activity,
          credentials(),
          settings,
          model,
          10,
        );
        const result = await service.observe(context, outcome);
        expect(result.assessment).toMatchObject({
          riskStatus: "unavailable",
          risk: { automation: 0, suspicious: 0 },
        });
        expect(
          (await service.observe(context, outcome)).assessment?.cached,
        ).toBe(true);
        expect(model.evaluateActivity).toHaveBeenCalledOnce();
      }
    });
    it("composes with adapters while leaving browser responses and scores separate", async () => {
      const model = evaluator();
      const visitor = createVisitorHandler(
        db.storage,
        model,
        { identity: credentials(), activity: settings },
        db.identities,
        undefined,
        db.protection,
        undefined,
        db.activity,
      );
      expect(
        (await visitor.activity!.observe(context, outcome)).assessment
          ?.riskStatus,
      ).toBe("evaluated");
      expect(model.evaluate).not.toHaveBeenCalled();
      expect(await db.query("SELECT id FROM observations")).toEqual([]);
    });
    it("bounds a full five-window route history and marks truncation before evaluation", async () => {
      const identity = credentials();
      const routes = Array.from({ length: 32 }, (_, i) => ({
        route: `GET /api/route${i}`,
      }));
      const key = await createSubjectLinker(identity)(
        JSON.stringify(["api-activity-v1", context.key.kind, context.key.id]),
      );
      const now = Math.floor(Date.now() / 60000) * 60000 + 500;
      vi.spyOn(Date, "now").mockReturnValue(now);
      await Promise.all(
        Array.from({ length: 160 }, (_, i) =>
          db.activity.increment({
            key,
            route: routes[i % 32]!.route,
            windowStart:
              Math.floor(now / 60000) * 60000 - Math.floor(i / 32) * 60000,
            now: now - Math.floor(i / 32) * 60000,
            expiresAt: now + 86400000,
            status: 200,
            durationMs: 1,
          }),
        ),
      );
      const model = evaluator();
      const result = await createApiActivity(
        db.activity,
        identity,
        { routes },
        model,
      ).assess({ ...context, route: routes[0]!.route });
      expect(result.assessment?.summary.truncated).toBe(true);
      expect(result.assessment?.summary.buckets).toHaveLength(128);
      expect(
        vi.mocked(model.evaluateActivity!).mock.calls[0]![0].activity.buckets,
      ).toHaveLength(128);
    });
    it("keeps stalled database work bounded and never starts late inference", async () => {
      const model = evaluator();
      let finish!: () => void;
      const original = db.activity.increment;
      const increment = vi.fn(async (input: Parameters<typeof original>[0]) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return original(input);
      });
      const service = createApiActivity(
        { ...db.activity, increment },
        credentials(),
        { ...settings, timeoutMs: 50, maxInFlight: 1 },
        model,
      );
      const response = new Response("ok");
      expect(
        (
          await service.handle(
            new Request("https://app.test/"),
            context,
            () => response,
          )
        ).response,
      ).toBe(response);
      expect(await service.observe(context, outcome)).toEqual({
        status: "unavailable",
      });
      expect(increment).toHaveBeenCalledOnce();
      finish();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(model.evaluateActivity).not.toHaveBeenCalled();
    });
  });

describe("Jev API activity protocol", () => {
  const input: ApiActivityInput = {
    activity: {
      source: "application-api",
      windowMs: 60000,
      observedAt: 123,
      truncated: false,
      buckets: [],
    },
    route,
    sensitive: true,
    actor: { kind: "agent", delegated: true },
  };
  const answers = {
    answers: {
      automation: { type: "noul", noul: 0.9 },
      suspicious: { type: "noul", noul: 0.1 },
    },
  };
  it("keeps the largest permitted aggregate request inside the provider byte limit", () => {
    const longestRoute = "GET /" + "x".repeat(155);
    const largest = {
      ...input,
      route: longestRoute,
      activity: {
        ...input.activity,
        buckets: Array.from({ length: 128 }, () => ({
          route: longestRoute,
          windowStart: Date.now(),
          requests: 1e9,
          denied: 1e9,
          clientErrors: 1e9,
          serverErrors: 1e9,
          durationTotalMs: 6e13,
          durationMaxMs: 60000,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          shortGaps: 1e9,
        })),
      },
    };
    expect(
      new TextEncoder().encode(JSON.stringify(createActivityInput(largest)))
        .byteLength,
    ).toBeLessThan(65536);
  });
  it("uses narrow typed questions and projects only allowlisted aggregate state", async () => {
    const transport = vi.fn(async () => answers);
    const value = await createJevMethods(transport).evaluateActivity!({
      ...input,
      password: "secret",
      key: { id: "private" },
    } as ApiActivityInput);
    expect(value).toEqual({ automation: 0.9, suspicious: 0.1 });
    expect(transport).toHaveBeenCalledWith(createActivityInput(input));
    expect(JSON.stringify(transport.mock.calls)).not.toContain("private");
    expect(API_ACTIVITY_QUESTIONS.automation.instructions).toContain(
      "not evidence of abuse",
    );
    expect(API_ACTIVITY_QUESTIONS.suspicious.instructions).toContain(
      "server errors and high throughput alone are not suspicious",
    );
  });
  it("uses the documented direct and Workers AI transports", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(answers));
    expect(
      await createJevEvaluator({ apiKey: "test" }).evaluateActivity!(input),
    ).toEqual({ automation: 0.9, suspicious: 0.1 });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    const ai = {
      run: vi.fn(async () => ({ state: "Completed", result: answers })),
    };
    expect(
      await createCloudflareJevEvaluator(ai).evaluateActivity!(input),
    ).toEqual({ automation: 0.9, suspicious: 0.1 });
    expect(ai.run).toHaveBeenCalledWith(
      "typesafe/jev",
      createActivityInput(input),
    );
  });
});
