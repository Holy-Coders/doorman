import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiActivity } from "../packages/adapters/src/activity.js";
import { createActivityInput } from "@aarondovturkel/doorman-evaluator-jev";
import type { VisitorEvaluator, ApiActivityInput } from "@aarondovturkel/doorman-core";
import { sqlBackend } from "./helpers/sql.js";

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind} linked suspicious activity`, () => {
    let db: Awaited<ReturnType<typeof sqlBackend>>;
    beforeAll(async () => {
      db = await sqlBackend(kind);
    });
    afterAll(async () => {
      await db.close();
    });
    const route = "POST /api/orders";
    const identity = () => ({
      namespace: crypto.randomUUID(),
      secret: "s".repeat(64),
    });
    it("carries denials across changing sessions without IPs, identity merging or identifier disclosure", async () => {
      const inputs: ApiActivityInput[] = [];
      const evaluator: VisitorEvaluator = {
        evaluate: vi.fn(),
        evaluateActivity: async (input) => {
          inputs.push(input);
          return { automation: 0.2, suspicious: 0.7 };
        },
      };
      const scope = identity();
      const config = { routes: [{ route }], correlation: {} };
      const a = createApiActivity(db.activity, scope, config, evaluator);
      const b = createApiActivity(db.activity, scope, config, evaluator);
      const reference = {
        basis: "request-pattern" as const,
        confidence: 0.92,
        parts: [
          { kind: "shape" as const, value: "order-create-v2:invalid-target" },
          {
            kind: "application" as const,
            value: "app-reviewed-campaign-reference",
          },
        ],
      };
      const link = await a.correlation(reference);
      expect(
        await b.correlation({
          ...reference,
          parts: [...reference.parts].reverse(),
        }),
      ).toEqual(link);
      const first = {
        key: { kind: "session" as const, id: "rotating-session-a" },
        route,
        correlations: [link],
      };
      for (let i = 0; i < 4; i++)
        await a.observe(first, { status: 403, durationMs: 5 });
      const result = await b.assess({
        ...first,
        key: { kind: "session", id: "rotating-session-b" },
      });
      expect(result.assessment?.summary.buckets).toEqual([]);
      expect(result.assessment?.relatedActivity?.[0]).toMatchObject({
        basis: "request-pattern",
        confidence: 0.92,
      });
      expect(
        result.assessment?.relatedActivity?.[0]?.summary.buckets.reduce(
          (n, r) => n + r.denied,
          0,
        ),
      ).toBe(4);
      const prompt = JSON.stringify(createActivityInput(inputs.at(-1)!));
      for (const privateValue of [
        link.id,
        "rotating-session",
        "app-reviewed-campaign-reference",
        "order-create-v2:invalid-target",
      ])
        expect(prompt).not.toContain(privateValue);
      expect(prompt).toContain("never sum their counts");
      const rows = JSON.stringify(
        await db.query("SELECT * FROM api_activity_buckets"),
      );
      expect(rows).not.toContain("app-reviewed-campaign-reference");
      const unrelated = await b.assess({
        key: { kind: "session", id: "unrelated" },
        route,
      });
      expect(unrelated.assessment?.relatedActivity).toBeUndefined();
      const otherTenant = createApiActivity(
        db.activity,
        identity(),
        config,
        evaluator,
      );
      expect((await otherTenant.correlation(reference)).id).not.toBe(link.id);
      await a.deleteCorrelation(link);
      const after = await b.assess({
        ...first,
        key: { kind: "session", id: "after-erasure" },
      });
      expect(after.assessment?.relatedActivity).toBeUndefined();
    });
    it("isolates historical contributions and cached results when the admission threshold changes", async () => {
      const scope = identity();
      const make = (minConfidence: number) =>
        createApiActivity(db.activity, scope, {
          routes: [{ route }],
          correlation: { minConfidence },
        });
      const broad = make(0.8),
        strict = make(0.95);
      const link = await broad.correlation({
        basis: "browser-match",
        confidence: 0.85,
        parts: [{ kind: "browser", value: "matched-environment" }],
      });
      await broad.observe(
        {
          key: { kind: "session", id: "original" },
          route,
          correlations: [link],
        },
        { status: 403, durationMs: 0 },
      );
      const query = {
        key: { kind: "session" as const, id: "new" },
        route,
        correlations: [{ ...link, confidence: 0.99 }],
      };
      const initial = await broad.assess(query);
      expect(
        initial.assessment?.relatedActivity?.[0]?.minimumLinkConfidence,
      ).toBe(0.8);
      const changed = await strict.assess(query);
      expect(changed.assessment?.cached).toBe(false);
      expect(changed.assessment?.relatedActivity).toBeUndefined();
    });

    it("excludes weak links and rejects shape-only cohorts and client-supplied extras", async () => {
      const service = createApiActivity(db.activity, identity(), {
        routes: [{ route }],
        correlation: { minConfidence: 0.9 },
      });
      await expect(
        service.correlation({
          basis: "request-pattern",
          confidence: 1,
          parts: [{ kind: "shape", value: "login" }],
        }),
      ).rejects.toThrow("alone");
      const link = await service.correlation({
        basis: "browser-match",
        confidence: 0.7,
        parts: [{ kind: "browser", value: "visitor-observation-match" }],
      });
      const context = {
        key: { kind: "session" as const, id: "weak-source" },
        route,
        correlations: [link],
      };
      await service.observe(context, { status: 403, durationMs: 0 });
      const result = await service.assess({
        ...context,
        key: { kind: "session", id: "weak-other" },
      });
      expect(result.assessment?.relatedActivity).toBeUndefined();
      expect(
        (
          await service.observe({ ...context, ip: "127.0.0.1" } as never, {
            status: 403,
            durationMs: 0,
          })
        ).status,
      ).toBe("unavailable");
      expect(
        (
          await service.observe(
            { ...context, correlations: Array(4).fill(link) },
            { status: 403, durationMs: 0 },
          )
        ).status,
      ).toBe("unavailable");
      const disabled = createApiActivity(db.activity, identity(), {
        routes: [{ route }],
      });
      await expect(
        disabled.correlation({
          basis: "browser-match",
          confidence: 1,
          parts: [{ kind: "browser", value: "x" }],
        }),
      ).rejects.toThrow("disabled");
    });
  });
