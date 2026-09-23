import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createProtection } from "../packages/adapters/src/protection.js";
import { createVisitorHandler } from "@aarondovturkel/doorman-adapters/node";
import { createVisitorEngine, normalizeObservation } from "@aarondovturkel/doorman-core";
import { sqlBackend } from "./helpers/sql.js";
import { signals, phone } from "./helpers/fixtures.js";
const result = { sameVisitor: 0.99, automation: 0.13, suspicious: 0.02 };
const input = {
  history: [],
  current: normalizeObservation(signals),
  deterministicSimilarity: 0,
};
const options = () => ({
  secret: "q".repeat(64),
  namespace: crypto.randomUUID(),
});
const request = (body: unknown = { signals }) =>
  new Request("https://app.test/api/visitor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind} shared abuse controls`, () => {
    let sql: Awaited<ReturnType<typeof sqlBackend>>;
    beforeAll(async () => {
      sql = await sqlBackend(kind);
    }, 30_000);
    afterAll(async () => sql.close());
    afterEach(() => vi.restoreAllMocks());

    it("shares one inference budget across lookup, batch matching and learning", async () => {
      const methods = {
        evaluate: vi.fn(async () => result),
        planLookup: vi.fn(async () => ({ graphics: true, locale: true })),
        evaluateCandidates: vi.fn(async () => [result]),
        predictIdentity: vi.fn(async () => ({})),
      };
      const evaluator = createProtection(
        sql.protection,
        { ...options(), evaluator: { maxCalls: 2 } },
        1000,
      ).wrap(methods);
      await evaluator.planLookup!(input.current);
      await evaluator.evaluateCandidates!({
        current: input.current,
        candidates: [{ history: [], deterministicSimilarity: 0 }],
      });
      await expect(
        evaluator.predictIdentity!({ current: input.current, examples: [] }),
      ).rejects.toThrow("admission");
      expect(methods.predictIdentity).not.toHaveBeenCalled();
    });
    it("atomically caps competing quota claims", async () => {
      const key = crypto.randomUUID();
      const accepted = await Promise.all(
        Array.from({ length: 25 }, () =>
          sql.protection.consumeQuota(key, 7, 1000, Date.now()),
        ),
      );
      expect(accepted.filter(Boolean)).toHaveLength(7);
    });
    it("shares sharded global quotas without multiplying the limit and resets at aligned boundaries", async () => {
      const opts = {
        ...options(),
        requests: { global: 21, shards: 4, windowMs: 1000 },
      };
      const a = createProtection(sql.protection, opts, 100);
      const b = createProtection(sql.protection, opts, 100);
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_200);
      const admitted = await Promise.all(
        Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).admit()),
      );
      expect(admitted.filter((r) => r.allowed)).toHaveLength(21);
      clock.mockReturnValue(1_900_000_001_001);
      const next = await Promise.all(
        Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).admit()),
      );
      expect(next.filter((r) => r.allowed)).toHaveLength(21);
    });
    it("uses shared account/session limits, hashes keys, and resets expired windows", async () => {
      const opts = {
        ...options(),
        requests: { global: 10, account: 2, session: 1, windowMs: 1000 },
      };
      const a = createProtection(sql.protection, opts, 100);
      const b = createProtection(sql.protection, opts, 100);
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
      expect(
        (await a.admit({ account: "private-user", session: "private-session" }))
          .allowed,
      ).toBe(true);
      expect(
        (await b.admit({ account: "private-user", session: "private-session" }))
          .allowed,
      ).toBe(false);
      expect(
        (await b.admit({ account: "private-user", session: "new" })).allowed,
      ).toBe(false);
      clock.mockReturnValue(1_900_000_001_001);
      expect(
        (await b.admit({ account: "private-user", session: "private-session" }))
          .allowed,
      ).toBe(true);
      expect(
        JSON.stringify(await sql.query("SELECT * FROM protection_quotas")),
      ).not.toMatch(/private-user|private-session/);
    });
    it("shares evaluator budgets across instances and falls back without throwing identity away", async () => {
      const opts = { ...options(), evaluator: { maxCalls: 1 } };
      const evaluate = vi.fn(async () => result);
      const a = createProtection(sql.protection, opts, 200).wrap({ evaluate });
      const b = createProtection(sql.protection, opts, 200).wrap({ evaluate });
      expect(await a.evaluate(input)).toEqual(result);
      const first = await createVisitorEngine({
        storage: sql.storage,
      }).identify({ signals });
      const returning = await createVisitorEngine({
        storage: sql.storage,
        evaluator: b,
      }).identify({ signals, visitorId: first.visitorId });
      expect(returning).toMatchObject({
        visitorId: first.visitorId,
        riskStatus: "unavailable",
        risk: { automation: 0, suspicious: 0 },
      });
      expect(evaluate).toHaveBeenCalledTimes(1);
    });
    it("reserves compound provider calls against budget and concurrency before running", async () => {
      const evaluate = vi.fn(async () => result);
      const evaluator = { requestCosts: { evaluate: 2 }, evaluate };
      const opts = {
        ...options(),
        evaluator: { maxCalls: 3, maxConcurrent: 2 },
      };
      const protectedEvaluator = createProtection(
        sql.protection,
        opts,
        1000,
      ).wrap(evaluator);
      await expect(protectedEvaluator.evaluate(input)).resolves.toEqual(result);
      await expect(protectedEvaluator.evaluate(input)).rejects.toThrow(
        "admission",
      );
      expect(evaluate).toHaveBeenCalledOnce();
      await expect(
        createProtection(
          sql.protection,
          { ...options(), evaluator: { maxConcurrent: 1 } },
          1000,
        )
          .wrap(evaluator)
          .evaluate(input),
      ).rejects.toThrow("admission");
      expect(evaluate).toHaveBeenCalledOnce();
    });
    it("limits concurrent reservations and releases only its own lease", async () => {
      const opts = { ...options(), evaluator: { maxConcurrent: 1 } };
      let finish!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const evaluate = vi.fn(async () => {
        entered();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return result;
      });
      const first = createProtection(sql.protection, opts, 1000)
        .wrap({ evaluate })
        .evaluate(input);
      await started;
      const next = createProtection(sql.protection, opts, 1000).wrap({
        evaluate: async () => result,
      });
      await expect(next.evaluate(input)).rejects.toThrow("admission");
      finish();
      await first;
      expect(await next.evaluate(input)).toEqual(result);
    });
    it("opens on provider failure, allows one recovery probe, and recovers", async () => {
      const opts = {
        ...options(),
        evaluator: { failureThreshold: 1, cooldownMs: 1000 },
      };
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
      const bad = vi.fn(async () => {
        throw new Error("500");
      });
      const a = createProtection(sql.protection, opts, 1000).wrap({
        evaluate: bad,
      });
      await expect(a.evaluate(input)).rejects.toThrow("500");
      await expect(a.evaluate(input)).rejects.toThrow("admission");
      expect(bad).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(1_900_000_001_001);
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((r) => {
        entered = r;
      });
      const b = createProtection(sql.protection, opts, 1000).wrap({
        evaluate: async () => {
          entered();
          await new Promise<void>((r) => {
            release = r;
          });
          return result;
        },
      });
      const probe = b.evaluate(input);
      await started;
      await expect(a.evaluate(input)).rejects.toThrow("admission");
      release();
      expect(await probe).toEqual(result);
      expect(
        await createProtection(sql.protection, opts, 1000)
          .wrap({ evaluate: async () => result })
          .evaluate(input),
      ).toEqual(result);
    });
    it("counts malformed outputs and timeouts as failures and keeps abandoned leases bounded", async () => {
      const events: unknown[] = [];
      const opts = {
        ...options(),
        evaluator: { maxConcurrent: 1 },
        onEvent: (e: unknown) => {
          events.push(e);
        },
      };
      const hung = createProtection(sql.protection, opts, 10).wrap({
        evaluate: () => new Promise(() => {}),
      });
      await expect(hung.evaluate(input)).rejects.toThrow("timeout");
      const next = createProtection(sql.protection, opts, 10).wrap({
        evaluate: async () => result,
      });
      await expect(next.evaluate(input)).rejects.toThrow("admission");
      expect(events).toContainEqual({ kind: "evaluator", reason: "timeout" });
      const malformed = createProtection(sql.protection, options(), 100).wrap({
        evaluate: async () => ({ ...result, automation: NaN }),
      });
      await expect(malformed.evaluate(input)).rejects.toThrow("Malformed");
    });
    it("returns controlled measurement errors and rejects browser-supplied control fields", async () => {
      const visitor = createVisitorHandler(
        sql.storage,
        undefined,
        { protection: { ...options(), requests: { global: 1 } } },
        undefined,
        undefined,
        sql.protection,
      );
      expect((await visitor.handle(request())).status).toBe(200);
      const limited = await visitor.assess(request());
      expect(limited.response.status).toBe(429);
      expect(limited.identity).toBeUndefined();
      expect(limited.response.headers.get("retry-after")).toBe("60");
      const unguarded = createVisitorHandler(sql.storage, undefined);
      expect(
        (
          await unguarded.handle(
            request({ signals, admission: { account: "other" } }),
          )
        ).status,
      ).toBe(400);
      const broken = createVisitorHandler(
        sql.storage,
        undefined,
        { protection: options() },
        undefined,
        undefined,
        {
          ...sql.protection,
          consumeQuota: async () => {
            throw Error("secret connection detail");
          },
        },
      );
      const failed = await broken.handle(request());
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain("secret");
    });
    it("does not let copied cookies teach a different device or empty profile into history", async () => {
      const engine = createVisitorEngine({ storage: sql.storage });
      const first = await engine.identify({ signals });
      const before = await sql.storage.getRecentObservations(
        first.visitorId,
        5,
      );
      for (const current of [phone, {}, phone, {}]) {
        const copied = await engine.identify({
          signals: current,
          visitorId: first.visitorId,
        });
        expect(copied.visitorId).toBe(first.visitorId);
      }
      expect(
        await sql.storage.getRecentObservations(first.visitorId, 5),
      ).toEqual(before);
      expect((await engine.identify({ signals: phone })).visitorId).not.toBe(
        first.visitorId,
      );
    });

    it("ignores an old successful completion while a newer recovery probe owns the circuit", async () => {
      const opts = {
        ...options(),
        evaluator: { failureThreshold: 1, cooldownMs: 1000, maxConcurrent: 3 },
      };
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
      let oldRelease!: () => void;
      let oldEntered!: () => void;
      const oldStarted = new Promise<void>((r) => {
        oldEntered = r;
      });
      const old = createProtection(sql.protection, opts, 1000)
        .wrap({
          evaluate: async () => {
            oldEntered();
            await new Promise<void>((r) => {
              oldRelease = r;
            });
            return result;
          },
        })
        .evaluate(input);
      await oldStarted;
      const failed = createProtection(sql.protection, opts, 1000).wrap({
        evaluate: async () => {
          throw Error("500");
        },
      });
      await expect(failed.evaluate(input)).rejects.toThrow("500");
      clock.mockReturnValue(1_900_000_001_001);
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((r) => {
        entered = r;
      });
      const recovering = createProtection(sql.protection, opts, 1000)
        .wrap({
          evaluate: async () => {
            entered();
            await new Promise<void>((r) => {
              release = r;
            });
            return result;
          },
        })
        .evaluate(input);
      await started;
      oldRelease();
      await old;
      await expect(failed.evaluate(input)).rejects.toThrow("admission");
      release();
      await recovering;
      expect(
        await createProtection(sql.protection, opts, 1000)
          .wrap({ evaluate: async () => result })
          .evaluate(input),
      ).toEqual(result);
    });

    it("persists a provider timeout before the HTTP response and applies the circuit on the next request", async () => {
      const evaluate = vi.fn(() => new Promise<never>(() => {}));
      const optionsWithBudget = {
        protection: { ...options(), evaluator: { failureThreshold: 1 } },
        evaluatorTimeoutMs: 10,
      };
      const visitor = createVisitorHandler(
        sql.storage,
        { evaluate },
        optionsWithBudget,
        undefined,
        undefined,
        sql.protection,
      );
      const first = await visitor.assess(request());
      expect(first.response.status).toBe(200);
      expect(first.identity?.riskStatus).toBe("unavailable");
      const again = await visitor.assess(
        new Request("https://app.test/api/visitor", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `__visitor=${first.identity!.visitorId}`,
          },
          body: JSON.stringify({ signals }),
        }),
      );
      expect(again.identity?.visitorId).toBe(first.identity?.visitorId);
      expect(evaluate).toHaveBeenCalledTimes(1);
    });
  });
