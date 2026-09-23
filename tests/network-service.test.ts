import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { networkBackend, discoveryFixture } from "./helpers/network.js";
import {
  createLearningService,
  createNetworkJevMethods,
  createWorkersNetworkEvaluator,
  createLearningOperator,
} from "../packages/network/src/server.js";
import {
  createNetworkClient,
  withNetworkRisk,
} from "../packages/network/src/client.js";
import { discoverPatterns } from "../packages/network/src/discovery.js";
import type { Contribution } from "../packages/network/src/schema.js";
import { digest } from "../packages/network/src/http.js";

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind} learning service`, () => {
    let backend: Awaited<ReturnType<typeof networkBackend>>;
    beforeAll(async () => {
      backend = await networkBackend(kind);
    });
    afterAll(async () => {
      await backend.close();
    });
    async function setup(
      options: Parameters<typeof createLearningService>[1] = {},
    ) {
      const service = createLearningService(backend.storage, options);
      const tenant = await service.registerTenant({ trainingApproved: true });
      const request = (path: string, body?: unknown, method = "POST") =>
        service.handle(
          new Request("https://network.test" + path, {
            method,
            headers: {
              Authorization: `Bearer ${tenant.apiKey}`,
              "Content-Type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
      return { service, tenant, request };
    }
    const sample = (): Contribution => ({
      version: 1,
      sampleId: "sample_" + crypto.randomUUID().replaceAll("-", ""),
      sessionReference:
        "ref_" + crypto.randomUUID().replaceAll("-", "").repeat(2),
      observedAt: Date.now() - 1000,
      features: { route_telemetry_share: 0.5, api_gap_cv: 0.1 },
      cohort: "api",
      trainingAllowed: true,
    });
    it("keeps three independent opt-ins, deduplicates samples and requires separate verified feedback", async () => {
      const { request, tenant } = await setup();
      const input = sample();
      expect((await request("/v1/contributions", input)).status).toBe(403);
      expect(
        (
          await request("/v1/evaluate", {
            version: 1,
            features: input.features,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request("/v1/preferences", {
            evaluation: false,
            contribution: true,
            training: false,
          })
        ).status,
      ).toBe(200);
      expect(await (await request("/v1/contributions", input)).json()).toEqual({
        sampleId: input.sampleId,
        created: true,
      });
      expect(await (await request("/v1/contributions", input)).json()).toEqual({
        sampleId: input.sampleId,
        created: false,
      });
      const label = {
        sampleId: input.sampleId,
        target: "assistant",
        positive: true,
        source: "verified-delegation",
        evidenceReference: "ref_" + "a".repeat(64),
      };
      expect(
        (await request("/v1/feedback", { ...label, source: "jev-prediction" }))
          .status,
      ).toBe(400);
      expect((await request("/v1/feedback", label)).status).toBe(200);
      expect(
        (await backend.storage.dataset("assistant", Date.now())).rows.some(
          (r) => r.tenantId === tenant.tenantId,
        ),
      ).toBe(false);
      await request("/v1/preferences", {
        evaluation: false,
        contribution: true,
        training: true,
      });
      // Enabling training cannot silently opt old samples in.
      expect(
        (await backend.storage.dataset("assistant", Date.now())).rows.some(
          (r) => r.tenantId === tenant.tenantId,
        ),
      ).toBe(false);
      const next = sample();
      await request("/v1/contributions", next);
      await request("/v1/feedback", { ...label, sampleId: next.sampleId });
      expect(
        (await backend.storage.dataset("assistant", Date.now())).rows.filter(
          (r) => r.tenantId === tenant.tenantId,
        ),
      ).toHaveLength(1);
    });
    it("isolates tenants, revokes training and invalidates model evidence on disputed labels", async () => {
      const { request, tenant } = await setup();
      const other = await setup();
      await request("/v1/preferences", {
        evaluation: false,
        contribution: true,
        training: true,
      });
      await other.request("/v1/preferences", {
        evaluation: false,
        contribution: true,
        training: true,
      });
      const input = sample(),
        label = {
          sampleId: input.sampleId,
          target: "assistant",
          positive: true,
          source: "verified-delegation",
          evidenceReference: "ref_" + "b".repeat(64),
        };
      await request("/v1/contributions", input);
      expect((await other.request("/v1/feedback", label)).status).toBe(404);
      await request("/v1/feedback", label);
      const revision = await backend.storage.revision();
      expect(
        (
          await request("/v1/feedback", {
            ...label,
            positive: false,
            source: "reviewed-session",
          })
        ).status,
      ).toBe(409);
      expect(await backend.storage.revision()).toBeGreaterThan(revision);
      expect(
        (await backend.storage.dataset("assistant", Date.now())).rows.some(
          (r) => r.tenantId === tenant.tenantId,
        ),
      ).toBe(false);
      await request("/v1/preferences", {
        evaluation: false,
        contribution: false,
        training: false,
      });
      expect(
        await backend.query("SELECT * FROM jn_samples WHERE tenant_id=?", [
          tenant.tenantId,
        ]),
      ).toEqual([]);
      expect(
        await backend.query("SELECT * FROM jn_labels WHERE tenant_id=?", [
          tenant.tenantId,
        ]),
      ).toEqual([]);
    });
    it("caches private inference without contributing and bounds concurrent provider calls", async () => {
      const provider = vi.fn(async () => ({
        automation: 0.8,
        suspicious: 0.1,
      }));
      const { request, tenant } = await setup({
        evaluator: provider,
        evaluatorVersion: "test-1",
        maxEvaluationsPerDay: 100,
        maxEvaluationsLifetime: 1000,
      });
      await request("/v1/preferences", {
        evaluation: true,
        contribution: false,
        training: false,
      });
      const input = {
        version: 1,
        features: { api_request_count: 100, api_gap_cv: 0.1 },
      };
      await Promise.all(
        Array.from({ length: 12 }, () => request("/v1/evaluate", input)),
      );
      const result = await (await request("/v1/evaluate", input)).json();
      expect(result).toMatchObject({
        cached: true,
        riskStatus: "evaluated",
        risk: { automation: 0.8, suspicious: 0.1 },
      });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(
        await backend.query("SELECT * FROM jn_samples WHERE tenant_id=?", [
          tenant.tenantId,
        ]),
      ).toEqual([]);
    });
    it("fails open on timeout/malformed provider output and never charges an empty snapshot", async () => {
      for (const evaluator of [
        async () => new Promise<never>(() => {}),
        async () => ({ automation: 2, suspicious: 0 }),
      ]) {
        const provider = vi.fn(evaluator);
        const { request } = await setup({
          evaluator: provider,
          evaluatorVersion: crypto.randomUUID(),
          evaluatorTimeoutMs: 50,
        });
        await request("/v1/preferences", {
          evaluation: true,
          contribution: false,
          training: false,
        });
        expect(
          await (
            await request("/v1/evaluate", { version: 1, features: {} })
          ).json(),
        ).toMatchObject({ riskStatus: "unavailable" });
        expect(provider).not.toHaveBeenCalled();
        expect(
          await (
            await request("/v1/evaluate", {
              version: 1,
              features: { api_request_count: 20 },
            })
          ).json(),
        ).toMatchObject({
          riskStatus: "unavailable",
          risk: { automation: 0, suspicious: 0 },
        });
      }
    });
    it("rejects browser origins, invalid credentials, unknown fields and oversized bodies", async () => {
      const { service, tenant, request } = await setup();
      await request("/v1/preferences", {
        evaluation: true,
        contribution: true,
        training: true,
      });
      expect(
        (
          await service.handle(
            new Request("https://network.test/v1/evaluate", {
              method: "POST",
              headers: {
                origin: "https://app.test",
                authorization: `Bearer ${tenant.apiKey}`,
              },
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await service.handle(
            new Request("https://network.test/v1/preferences"),
          )
        ).status,
      ).toBe(401);
      expect(
        (await request("/v1/contributions", { ...sample(), email: "secret" }))
          .status,
      ).toBe(400);
      expect(
        (await request("/v1/contributions", { value: "x".repeat(17000) }))
          .status,
      ).toBe(413);
    });
    it("persists quotas across service instances and keeps erasure available after exhaustion", async () => {
      const { service, tenant, request } = await setup({
        maxRequestsPerTenantPerDay: 1,
      });
      await request("/v1/preferences", {
        evaluation: false,
        contribution: true,
        training: false,
      });
      const input = sample();
      expect((await request("/v1/contributions", input)).status).toBe(202);
      const restarted = createLearningService(backend.storage, {
        maxRequestsPerTenantPerDay: 1,
      });
      expect(
        (
          await restarted.handle(
            new Request("https://network.test/v1/contributions", {
              method: "POST",
              headers: {
                authorization: `Bearer ${tenant.apiKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(input),
            }),
          )
        ).status,
      ).toBe(429);
      expect(
        (await request("/v1/contributions", undefined, "DELETE")).status,
      ).toBe(200);
      expect(
        (await service.handle(new Request("https://network.test/health")))
          .status,
      ).toBe(200);
    });
    it("requires successful holdout gates before canary and invalidates on erasure", async () => {
      const { rows, options } = discoveryFixture();
      const model = discoverPatterns(rows, {
        ...options,
        datasetRevision: await backend.storage.revision(),
      });
      await backend.storage.saveModel(model);
      expect((await backend.storage.latestModel(Date.now()))?.status).toBe(
        "shadow",
      );
      await backend.storage.promote(model.id, 1, Date.now());
      expect((await backend.storage.latestModel(Date.now()))?.status).toBe(
        "canary",
      );
      const { request, tenant } = await setup();
      await request("/v1/preferences", {
        evaluation: false,
        contribution: true,
        training: true,
      });
      await request("/v1/contributions", sample());
      await backend.storage.erase(tenant.tenantId);
      expect(await backend.storage.latestModel(Date.now())).toBeUndefined();
      await expect(
        backend.storage.promote(model.id, 100, Date.now()),
      ).rejects.toThrow();
      const invalid = {
        ...model,
        id: "model_" + crypto.randomUUID().replaceAll("-", ""),
        datasetRevision: await backend.storage.revision(),
        eligible: false,
      };
      await backend.storage.saveModel(invalid);
      await expect(
        backend.storage.promote(invalid.id, 1, Date.now()),
      ).rejects.toThrow();
    });
    it("never supplies shadow patterns to Jev, and rollback removes canary evidence", async () => {
      const provider = vi.fn(async () => ({
        automation: 0.8,
        suspicious: 0.1,
      }));
      const { request } = await setup({
        evaluator: provider,
        evaluatorVersion: "shadow-isolation",
      });
      await request("/v1/preferences", {
        evaluation: true,
        contribution: false,
        training: false,
      });
      const { rows, options } = discoveryFixture();
      const model = discoverPatterns(rows, {
        ...options,
        datasetRevision: await backend.storage.revision(),
      });
      await backend.storage.saveModel(model);
      const payload = {
        version: 1,
        features: { route_telemetry_share: 0.5, api_gap_cv: 0.1 },
      };
      const shadow = await (await request("/v1/evaluate", payload)).json();
      expect(shadow.patternMode).toBe("shadow");
      expect(shadow.patterns.length).toBeGreaterThan(0);
      expect(provider).toHaveBeenLastCalledWith({
        features: payload.features,
        patterns: [],
      });
      await backend.storage.promote(model.id, 100, Date.now());
      const canary = await (await request("/v1/evaluate", payload)).json();
      expect(canary.patternMode).toBe("canary");
      expect(provider).toHaveBeenLastCalledWith(
        expect.objectContaining({
          patterns: expect.arrayContaining([
            expect.objectContaining({ target: "assistant" }),
          ]),
        }),
      );
      await backend.storage.rollback(model.id);
      await request("/v1/evaluate", payload);
      expect(provider).toHaveBeenLastCalledWith({
        features: payload.features,
        patterns: [],
      });
    });
    it("reserves shared quota atomically and requires operator-approved training enrollment", async () => {
      const key = crypto.randomUUID();
      const reservations = await Promise.all(
        Array.from({ length: 12 }, () =>
          backend.storage.quota(key, 0, 3, Date.now() + 60000),
        ),
      );
      expect(reservations.filter(Boolean)).toHaveLength(3);
      const service = createLearningService(backend.storage);
      const tenant = await service.registerTenant();
      const response = await service.handle(
        new Request("https://network.test/v1/preferences", {
          method: "POST",
          headers: {
            authorization: `Bearer ${tenant.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            evaluation: false,
            contribution: true,
            training: true,
          }),
        }),
      );
      expect(response.status).toBe(403);
      const revision = await backend.storage.revision();
      await backend.storage.erase(tenant.tenantId, "sample_" + "0".repeat(32));
      expect(await backend.storage.revision()).toBe(revision);
      const token = "operator_" + "x".repeat(64);
      const operator = createLearningOperator(service, await digest(token));
      expect(
        (
          await operator(
            new Request("https://network.test/operator/tenants", {
              method: "POST",
              headers: {
                authorization: `Bearer ${tenant.apiKey}`,
                "content-type": "application/json",
              },
              body: "{}",
            }),
          )
        ).status,
      ).toBe(401);
      const created = await operator(
        new Request("https://network.test/operator/tenants", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(created.status).toBe(201);
      expect(created.headers.get("cache-control")).toContain("no-store");
    });
  });

it("server client previews, scopes references and never contributes implicitly", async () => {
  const backend = await networkBackend("postgres");
  const service = createLearningService(backend.storage);
  const tenant = await service.registerTenant({ trainingApproved: true });
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) =>
      service.handle(new Request(input, init)),
    );
  try {
    const client = createNetworkClient({
      endpoint: "https://network.test",
      apiKey: tenant.apiKey,
    });
    await client.evaluate({ api_request_count: 20 });
    expect(await backend.query("SELECT * FROM jn_samples")).toEqual([]);
    expect(await client.contribute({} as Contribution)).toEqual({
      status: "disabled",
    });
    const enabled = createNetworkClient({
      endpoint: "https://network.test",
      apiKey: tenant.apiKey,
      contribution: {
        enabled: true,
        training: true,
        referenceSecret: "s".repeat(32),
        sampleRate: 1,
      },
    });
    await enabled.preferences({
      evaluation: false,
      contribution: true,
      training: true,
    });
    const sample = await enabled.prepare({
      sessionId: "private-customer-session",
      features: { api_request_count: 20 },
    });
    expect(JSON.stringify(sample)).not.toContain("private-customer-session");
    const another = await enabled.prepare({
      sessionId: "private-customer-session",
      features: { api_request_count: 20 },
      observedAt: Date.now() - 86_400_000,
    });
    expect(another.sessionReference).not.toEqual(sample.sessionReference);
    expect((await enabled.contribute(sample)).status).toBe("accepted");
    expect(
      (
        await enabled.confirmAssistant(sample.sampleId, {
          subject: { status: "unknown" },
          actor: { kind: "unknown", basis: "unknown" },
          delegation: { status: "none" },
        })
      ).status,
    ).toBe("unverified");
    expect(
      (
        await enabled.feedback({
          sampleId: sample.sampleId,
          target: "assistant",
          positive: true,
          source: "verified-delegation",
          evidenceReference: await enabled.evidenceReference("grant-secret"),
        })
      ).status,
    ).toBe("recorded");
    await enabled.erase(sample.sampleId);
    expect(await backend.query("SELECT * FROM jn_samples")).toEqual([]);
    expect(
      (await backend.storage.authenticate(await digest(tenant.apiKey)))
        ?.preferences.training,
    ).toBe(true);
  } finally {
    transport.mockRestore();
    await backend.close();
  }
});
it("sampling is stable and scopes identical local sessions to the participant credential", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    const options = {
      endpoint: "https://network.test",
      apiKey: "a".repeat(64),
      contribution: {
        enabled: true as const,
        referenceSecret: "s".repeat(32),
        sampleRate: 0,
      },
    };
    const client = createNetworkClient(options);
    const sample = await client.prepare({
      sessionId: "same-session",
      features: { api_request_count: 20 },
    });
    expect(await client.contribute(sample)).toEqual({ status: "sampled-out" });
    expect(fetch).not.toHaveBeenCalled();
    const other = await createNetworkClient({
      ...options,
      apiKey: "b".repeat(64),
    }).prepare({
      sessionId: "same-session",
      features: { api_request_count: 20 },
    });
    expect(other.sessionReference).not.toBe(sample.sessionReference);
  } finally {
    fetch.mockRestore();
  }
});
it("Workers AI uses documented typed Jev requests and rejects malformed responses", async () => {
  const run = vi.fn(async () => ({
    answers: {
      automation: { type: "noul", noul: 0.9 },
      suspicious: { type: "noul", noul: 0.1 },
    },
  }));
  const evaluate = createWorkersNetworkEvaluator({ run });
  expect(
    await evaluate({ features: { api_request_count: 20 }, patterns: [] }),
  ).toEqual({ automation: 0.9, suspicious: 0.1 });
  expect(run).toHaveBeenCalledWith(
    "typesafe/jev",
    expect.objectContaining({
      state: { features: { api_request_count: 20 }, validatedPatterns: [] },
      questions: expect.objectContaining({
        automation: expect.objectContaining({ type: "noul" }),
      }),
    }),
  );
  await expect(
    createNetworkJevMethods(async () => ({}))({ features: {}, patterns: [] }),
  ).rejects.toThrow();
});
it("remote risk cannot change sameVisitor or authorization and preserves fallback", async () => {
  const remote = vi.fn(async () => ({
    riskStatus: "evaluated",
    risk: { automation: 0.9, suspicious: 0.1 },
  }));
  const client = {
    evaluate: remote,
  } as unknown as ReturnType<typeof createNetworkClient>;
  class ExistingEvaluator {
    scope = { graphics: true, locale: false };
    prediction = { subjectId: "local-subject", score: 0.7 };
    async planLookup() {
      return this.scope;
    }
    async predictIdentity() {
      return this.prediction;
    }
    async evaluate() {
      return {
        sameVisitor: 0.4,
        automation: 0.2,
        suspicious: 0.3,
      };
    }
  }
  const evaluator = withNetworkRisk(new ExistingEvaluator(), client);
  expect(await evaluator.planLookup!({})).toEqual({
    graphics: true,
    locale: false,
  });
  expect(
    await evaluator.predictIdentity!({ current: {}, examples: [] }),
  ).toEqual({
    subjectId: "local-subject",
    score: 0.7,
  });
  expect(
    await evaluator.evaluate({
      current: {},
      history: [],
      deterministicSimilarity: 0.4,
    }),
  ).toEqual({ sameVisitor: 0.4, automation: 0.9, suspicious: 0.1 });
  remote.mockResolvedValue({
    riskStatus: "unavailable",
    risk: { automation: 0, suspicious: 0 },
  });
  expect(
    await evaluator.evaluate({
      current: {},
      history: [],
      deterministicSimilarity: 0.4,
    }),
  ).toEqual({ sameVisitor: 0.4, automation: 0.2, suspicious: 0.3 });
});
