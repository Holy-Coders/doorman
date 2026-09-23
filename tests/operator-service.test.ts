import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOperatorService } from "../packages/adapters/src/operators.js";
import type { OperatorWindowInput } from "../packages/adapters/src/operators.js";
import { createNodeVisitor } from "@aarondovturkel/doorman-adapters/node";
import { createVercelVisitor } from "@aarondovturkel/doorman-adapters/vercel";
import { createCloudflareVisitor } from "@aarondovturkel/doorman-adapters/cloudflare";
import type { VisitorEvaluator, OperatorStorage } from "@aarondovturkel/doorman-core";
import type { PostgresDatabase } from "@aarondovturkel/doorman-storage-postgres";
import type { D1Database } from "@aarondovturkel/doorman-storage-d1";
import { sqlBackend } from "./helpers/sql.js";
import { evidence, evaluation } from "./helpers/operators.js";
const identity = { secret: "a".repeat(64), namespace: "operator-tests" };
function input(
  accountId = crypto.randomUUID(),
  index = 0,
): OperatorWindowInput {
  const end = Date.now() - (20 - index) * 60000;
  return {
    accountId,
    sessionId: "private-session",
    windowId: `window-${index}`,
    browserId: "private-browser",
    startedAt: end - 60000,
    endedAt: end,
    evidence,
  };
}
const base = {
  evaluate: async () => ({ sameVisitor: 0, automation: 0, suspicious: 0 }),
};
for (const kind of ["postgres", "d1"] as const)
  describe(`operator storage and service: ${kind}`, () => {
    let db: Awaited<ReturnType<typeof sqlBackend>>;
    beforeAll(async () => {
      db = await sqlBackend(kind);
    }, 20000);
    afterAll(async () => {
      await db.close();
    });
    it("atomically evaluates an immutable window once under concurrent retries", async () => {
      const evaluateOperator = vi.fn(async () => evaluation());
      const service = createOperatorService(
        db.operators,
        identity,
        {},
        { ...base, evaluateOperator },
      );
      const secondService = createOperatorService(
        db.operators,
        identity,
        {},
        { ...base, evaluateOperator },
      );
      const data = input();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? service : secondService).observe(data),
        ),
      );
      expect(evaluateOperator).toHaveBeenCalledOnce();
      expect(results.some((r) => r.status === "recorded")).toBe(true);
      expect((await service.observe(data)).status).toBe("cached");
      expect(
        (
          await service.observe({
            ...data,
            evidence: {
              ...evidence,
              features: { ...evidence.features, api_request_count: 50 },
            },
          })
        ).status,
      ).toBe("conflict");
      const summary = await service.summarize(data.accountId, {
        since: data.startedAt - 1,
        until: Date.now(),
      });
      expect(summary.observedWindows).toBe(1);
      const persisted = JSON.stringify(
        await db.query("SELECT record FROM operator_windows"),
      );
      expect(persisted).not.toContain(data.accountId);
      expect(persisted).not.toContain("private-session");
      expect(persisted).not.toContain("private-browser");
    });
    it("stores label policy with windows and uses current policy for new reports", async () => {
      const options = { thresholds: { labelThreshold: 0.99 } };
      const evaluator = { ...base, evaluateOperator: async () => evaluation() };
      const strict = createOperatorService(
        db.operators,
        identity,
        options,
        evaluator,
      );
      options.thresholds.labelThreshold = 0.5;
      const data = input();
      const result = await strict.observe(data);
      expect(result.window?.thresholds?.labelThreshold).toBe(0.99);
      const range = { since: data.startedAt - 1, until: Date.now() };
      expect(
        (await strict.summarize(data.accountId, range)).unresolvedWindows,
      ).toBe(1);
      const defaults = createOperatorService(
        db.operators,
        identity,
        {},
        evaluator,
      );
      expect(
        (await defaults.observe(data)).window?.thresholds?.labelThreshold,
      ).toBe(0.99);
      expect(
        (await defaults.summarize(data.accountId, range)).unresolvedWindows,
      ).toBe(0);
    });
    it("bounds candidates, scopes them to the account and skips future windows", async () => {
      const evaluateOperator = vi.fn(
        async (
          i: Parameters<NonNullable<VisitorEvaluator["evaluateOperator"]>>[0],
        ) => ({
          ...evaluation(),
          links: i.candidates.map((c) => ({ windowId: c.id, score: 0.95 })),
        }),
      );
      const service = createOperatorService(
        db.operators,
        identity,
        {},
        { ...base, evaluateOperator },
      );
      const account = crypto.randomUUID();
      for (let i = 0; i < 12; i++) await service.observe(input(account, i));
      expect(evaluateOperator.mock.calls.at(-1)![0].candidates).toHaveLength(
        10,
      );
      await service.observe(input());
      expect(evaluateOperator.mock.calls.at(-1)![0].candidates).toHaveLength(0);
      expect(
        (
          await service.summarize(crypto.randomUUID(), {
            since: Date.now() - 1800000,
            until: Date.now(),
          })
        ).observedWindows,
      ).toBe(0);
    });
    it("handles timeout, malformed output, sparse evidence and disabled evaluation without inventing human labels", async () => {
      for (const evaluateOperator of [
        async () => {
          throw new Error("500");
        },
        async () => new Promise<never>(() => {}),
        async () => ({ ...evaluation(), abuse: 2 }),
        async () => ({
          ...evaluation(),
          links: [{ windowId: "forged", score: 1 }],
        }),
      ]) {
        const service = createOperatorService(
          db.operators,
          identity,
          {},
          { ...base, evaluateOperator },
          undefined,
          20,
        );
        const result = await service.observe(input());
        expect(result.status).toBe("recorded");
        expect(result.window?.status).toBe("unavailable");
        expect(result.window?.evaluation).toBeUndefined();
      }
      const evaluateOperator = vi.fn(async () => evaluation());
      const service = createOperatorService(
        db.operators,
        identity,
        {},
        { ...base, evaluateOperator },
      );
      expect(
        (
          await service.observe({
            ...input(),
            evidence: { source: "browser", features: {} },
          })
        ).window?.status,
      ).toBe("insufficient-evidence");
      expect(evaluateOperator).not.toHaveBeenCalled();
      expect(
        (
          await createOperatorService(db.operators, identity, {}).observe(
            input(),
          )
        ).window?.status,
      ).toBe("disabled");
    });
    it("expires family references and refuses unknown properties before persistence", async () => {
      const evaluateOperator = vi.fn<
        NonNullable<VisitorEvaluator["evaluateOperator"]>
      >(async () => evaluation());
      const service = createOperatorService(
        db.operators,
        identity,
        {
          families: [
            {
              family: "test-agent",
              version: "v1",
              source: "controlled-study",
              expiresAt: 1,
              examples: [evidence, evidence, evidence],
            },
          ],
        },
        { ...base, evaluateOperator },
      );
      await service.observe(input());
      expect(evaluateOperator.mock.calls[0]![0].families).toEqual([]);
      await expect(
        service.observe({ ...input(), email: "secret" } as OperatorWindowInput),
      ).rejects.toThrow();
      await expect(
        service.observe({
          ...input(),
          evidence: { source: "browser", features: { rawCoordinates: [] } },
        } as unknown as OperatorWindowInput),
      ).rejects.toThrow();
    });
    it("supports account, session and browser erasure; late finishes cannot recreate rows", async () => {
      const service = createOperatorService(
        db.operators,
        identity,
        {},
        { ...base, evaluateOperator: async () => evaluation() },
      );
      for (const erase of [
        "deleteAccount",
        "deleteBrowser",
        "deleteSession",
      ] as const) {
        const data = input(),
          result = await service.observe(data);
        expect(result.window).toBeDefined();
        if (erase === "deleteAccount")
          await service.deleteAccount(data.accountId);
        else if (erase === "deleteBrowser")
          await service.deleteBrowser(data.accountId, data.browserId!);
        else await service.deleteSession(data.accountId, data.sessionId);
        await db.operators.finish(result.window!);
        expect(
          await db.operators.get(result.window!.accountKey, result.window!.id),
        ).toBeUndefined();
      }
      const expired = (await service.observe(input())).window!;
      await db.operators.cleanup(expired.expiresAt + 1, 1000);
      expect(
        await db.operators.get(expired.accountKey, expired.id),
      ).toBeUndefined();
    });
    it("invalidates old evaluation claims and clears retained operator links after selective erasure", async () => {
      const service = createOperatorService(
        db.operators,
        identity,
        {},
        {
          ...base,
          evaluateOperator: async (i) => ({
            ...evaluation(),
            links: i.candidates.map((c) => ({ windowId: c.id, score: 0.99 })),
          }),
        },
      );
      const account = crypto.randomUUID();
      const a = (await service.observe(input(account, 0))).window!;
      const b = (
        await service.observe({
          ...input(account, 1),
          sessionId: "different-session",
          browserId: "different-browser",
        })
      ).window!;
      expect(b.evaluation!.links).toHaveLength(1);
      await service.deleteBrowser(account, "private-browser");
      const retained = (await db.operators.get(b.accountKey, b.id))!;
      expect(retained.evaluation!.links).toEqual([]);
      expect(retained.lease).not.toBe(b.lease);
      const replacement = {
        ...a,
        status: "pending" as const,
        lease: crypto.randomUUID(),
        evaluation: undefined,
      };
      expect(await db.operators.claim(replacement)).toBe(true);
      expect(await db.operators.finish(a)).toBe(false);
      expect((await db.operators.get(a.accountKey, a.id))!.status).toBe(
        "pending",
      );
    });
    it("shares evaluator budgets for operator scoring across adapter instances", async () => {
      const uniqueIdentity = { ...identity, namespace: crypto.randomUUID() };
      const evaluateOperator = vi.fn<
        NonNullable<VisitorEvaluator["evaluateOperator"]>
      >(async () => evaluation());
      const run = vi.fn(
        async (
          model: string,
          request: { questions: Record<string, unknown> },
        ) => ({
          model: model === "typesafe/jev" ? "jev-1.13.0" : "unexpected",
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { type: "noul", noul: key === "assistant" ? 0.95 : 0.1 },
            ]),
          ),
        }),
      );
      const options = {
        identity: uniqueIdentity,
        operators: {},
        protection: { ...uniqueIdentity, evaluator: { maxCalls: 1 } },
      };
      const create = () =>
        kind === "postgres"
          ? createNodeVisitor({
              ...options,
              db: db.db as PostgresDatabase,
              evaluator: { ...base, evaluateOperator },
            })
          : createCloudflareVisitor({
              ...options,
              db: db.db as D1Database,
              ai: { run },
            });
      const account = crypto.randomUUID();
      expect(
        (await create().operators!.observe(input(account, 0))).window!.status,
      ).toBe("evaluated");
      expect(
        (await create().operators!.observe(input(account, 1))).window!.status,
      ).toBe("unavailable");
      expect(
        kind === "postgres" ? evaluateOperator : run,
      ).toHaveBeenCalledOnce();
    });
    it("composes the platform adapters without exposing operator assessments in browser responses", async () => {
      const options = { identity, operators: {} };
      const adapters =
        kind === "postgres"
          ? [
              createNodeVisitor({ ...options, db: db.db as PostgresDatabase }),
              createVercelVisitor({
                ...options,
                db: db.db as PostgresDatabase,
              }),
            ]
          : [createCloudflareVisitor({ ...options, db: db.db as D1Database })];
      for (const adapter of adapters) {
        expect(adapter.operators).toBeDefined();
        expect((await adapter.operators!.observe(input())).window?.status).toBe(
          "disabled",
        );
        const response = await adapter.handle(
          new Request("https://app.test/api/visitor", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://app.test",
            },
            body: JSON.stringify({ signals: {} }),
          }),
        );
        expect(response.status).toBe(200);
        expect(Object.keys(await response.json())).toEqual([
          "visitorId",
          "isReturning",
        ]);
      }
    });
  });
it("bounds stalled storage work and returns controlled failures", async () => {
  const storage = {
    get: vi.fn(async () => new Promise<never>(() => {})),
  } as unknown as OperatorStorage;
  const service = createOperatorService(storage, identity, {
    timeoutMs: 50,
    maxInFlight: 1,
  });
  const pending = service.observe(input());
  expect(await service.observe(input())).toEqual({ status: "limited" });
  expect(await pending).toEqual({ status: "unavailable" });
  expect(await service.observe(input())).toEqual({ status: "limited" });
  expect(storage.get).toHaveBeenCalledOnce();
  const failed = createOperatorService(
    {
      get: async () => {
        throw new Error("db down");
      },
    } as unknown as OperatorStorage,
    identity,
    {},
  );
  expect(await failed.observe(input())).toEqual({ status: "unavailable" });
});

it("bounds stalled report reads and prevents timed-out work from resolving a report later", async () => {
  const storage = {
    recent: vi.fn(async () => new Promise<never>(() => {})),
  } as unknown as OperatorStorage;
  const service = createOperatorService(storage, identity, {
    timeoutMs: 50,
    maxInFlight: 1,
  });
  const range = { since: Date.now() - 10000, until: Date.now() };
  const pending = service.summarize("account", range);
  await expect(service.summarize("account", range)).rejects.toThrow("capacity");
  await expect(pending).rejects.toThrow("deadline");
  await expect(service.summarize("account", range)).rejects.toThrow("capacity");
  expect(storage.recent).toHaveBeenCalledOnce();
});
