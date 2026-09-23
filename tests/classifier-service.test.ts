import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { networkBackend } from "./helpers/network.js";
import { classifierFixture } from "../scripts/classifier/fixture.js";
import { simpleModel } from "./helpers/classifier.js";
import {
  createClassifierDataset,
  sealClassifierManifest,
} from "../packages/network/src/classifier-data.js";
import {
  createLearningService,
  createLearningOperator,
} from "../packages/network/src/server.js";
import { digest } from "../packages/network/src/http.js";
import { CLASSIFIER_FEATURE_VERSION } from "../packages/network/src/classifier-schema.js";
import { finalizeClassifier } from "../packages/network/src/classifier-evaluation.js";
import { candidate } from "./helpers/classifier.js";

for (const kind of ["postgres", "d1"] as const)
  describe(`${kind} classifier lifecycle`, () => {
    let backend: Awaited<ReturnType<typeof networkBackend>>;
    beforeAll(async () => {
      backend = await networkBackend(kind);
    });
    afterAll(async () => backend.close());
    async function setup(
      options: Parameters<typeof createLearningService>[1] = {},
    ) {
      await backend.query("DELETE FROM jn_classifiers");
      await backend.query("DELETE FROM jn_quotas");
      const service = createLearningService(backend.storage, options),
        tenant = await service.registerTenant();
      const request = (path: string, body: unknown) =>
        service.handle(
          new Request("https://learning.test" + path, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tenant.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        );
      const { dataset, enrichment } = await classifierFixture();
      const observed = await createClassifierDataset(
        dataset.rows,
        dataset.manifest.split,
        {
          origin: "observed",
          revision: await backend.storage.revision(),
          now: dataset.manifest.createdAt,
        },
      );
      return {
        service,
        tenant,
        request,
        dataset: observed,
        enrichment: {
          ...enrichment,
          datasetDigest: observed.manifest.digest,
          synthetic: false,
        },
      };
    }
    it("stages sealed exports as private shadow predictions, gates promotion and invalidates after revision", async () => {
      const { service, request, dataset } = await setup();
      const token = "operator" + "a".repeat(40),
        hash = await digest(token),
        operator = createLearningOperator(service, hash);
      const model = await simpleModel(dataset);
      const operate = (path: string, body: unknown, key = token) =>
        operator(
          new Request("https://learning.test/operator/classifier/" + path, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        );
      expect(
        (await operate("stage", { model, seal: "0".repeat(64) })).status,
      ).toBe(400);
      expect(
        (
          await operate(
            "stage",
            { model, seal: await sealClassifierManifest(model.manifest, hash) },
            "wrong".repeat(10),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await operate("stage", {
            model,
            seal: await sealClassifierManifest(model.manifest, hash),
          })
        ).status,
      ).toBe(200);
      const body = { version: 1, features: dataset.rows[0]!.features };
      expect((await request("/v1/classify", body)).status).toBe(403);
      await request("/v1/preferences", {
        evaluation: true,
        contribution: false,
        training: false,
      });
      const first = await (await request("/v1/classify", body)).json();
      expect(first.predictions[0]).toMatchObject({
        mode: "shadow",
        target: "assistant",
        reason: "scored",
      });
      expect(first.risk).toBeUndefined();
      expect((await (await request("/v1/classify", body)).json()).cached).toBe(
        true,
      );
      expect(model.eligible).toBe(true);
      expect(
        (await operate("promote", { modelId: model.id, canaryPercent: 100 }))
          .status,
      ).toBe(200);
      expect(
        (await (await request("/v1/classify", body)).json()).predictions[0]
          .mode,
      ).toBe("canary");
      await backend.query("UPDATE jn_meta SET revision=revision+1 WHERE id=1");
      expect(
        (await (await request("/v1/classify", body)).json()).predictions,
      ).toEqual([]);
      expect((await operate("promote", { modelId: model.id })).status).toBe(
        400,
      );
      expect((await operate("rollback", { modelId: model.id })).status).toBe(
        200,
      );
    });
    it("rejects synthetic artifacts and mutated metric gates", async () => {
      const { service } = await setup(),
        { dataset } = await classifierFixture();
      const model = await simpleModel(dataset);
      await expect(service.stageClassifier(model)).rejects.toThrow("synthetic");
      model.metrics.holdout.precisionLower = 1;
      await expect(service.stageClassifier(model)).rejects.toThrow("metrics");
    });
    it("shares quotas with the risk endpoint and abstains on exhausted Jev features", async () => {
      const provider = vi.fn(async () => ({
        version: CLASSIFIER_FEATURE_VERSION,
        providerModel: "jev-1.13.0",
        values: {
          jev_regular_timing: 0.9,
          jev_repeated_workflow: 0.9,
          jev_mechanical_input: 0,
          jev_abuse_evidence: 0,
        },
      }));
      const { service, request, dataset, enrichment } = await setup({
        classifierEvaluator: provider,
        evaluator: async () => ({ automation: 0.1, suspicious: 0 }),
        evaluatorVersion: "test",
        maxEvaluationsLifetime: 1,
      });
      const jevCandidate = {
        ...candidate,
        name: "jev-logistic",
        mode: "jev",
        parameters: {
          ...candidate.parameters,
          columns: [
            candidate.parameters.columns[0],
            { name: "jev_repeated_workflow", mean: 0, scale: 1 },
          ],
        },
      };
      const model = await finalizeClassifier(
        dataset,
        {
          version: 1,
          datasetDigest: dataset.manifest.digest,
          trainerVersion: "test",
          candidates: [jevCandidate],
        },
        enrichment,
      );
      await service.stageClassifier(model);
      await request("/v1/preferences", {
        evaluation: true,
        contribution: false,
        training: false,
      });
      const body = { version: 1, features: dataset.rows[0]!.features };
      expect(
        (await (await request("/v1/evaluate", body)).json()).riskStatus,
      ).toBe("evaluated");
      const result = await (await request("/v1/classify", body)).json();
      expect(result.predictions[0]).toMatchObject({
        score: null,
        reason: "jev-unavailable",
        aboveThreshold: false,
      });
      expect(provider).not.toHaveBeenCalled();
    });
    it.each(["timeout", "malformed", "provider error"])(
      "abstains when classifier Jev returns %s",
      async (failure) => {
        const provider = async () => {
          if (failure === "timeout") return new Promise<never>(() => {});
          if (failure === "provider error") throw new Error("Provider 500");
          return {
            values: { jev_regular_timing: 2 },
          } as unknown as import("../packages/network/src/classifier-schema.js").JevFeatureResult;
        };
        const { service, request, dataset, enrichment } = await setup({
          classifierEvaluator: provider,
          evaluatorTimeoutMs: 50,
        });
        const enriched = {
          ...candidate,
          name: "jev-logistic",
          mode: "jev",
          parameters: {
            ...candidate.parameters,
            columns: [
              candidate.parameters.columns[0],
              { name: "jev_repeated_workflow", mean: 0, scale: 1 },
            ],
          },
        };
        const model = await finalizeClassifier(
          dataset,
          {
            version: 1,
            datasetDigest: dataset.manifest.digest,
            trainerVersion: "test",
            candidates: [enriched],
          },
          enrichment,
        );
        await service.stageClassifier(model);
        await request("/v1/preferences", {
          evaluation: true,
          contribution: false,
          training: false,
        });
        const response = await request("/v1/classify", {
          version: 1,
          features: dataset.rows[0]!.features,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          status: "unavailable",
          predictions: [
            { score: null, aboveThreshold: false, reason: "jev-unavailable" },
          ],
        });
      },
    );
    it("exports provenance and four windows without including future labels", async () => {
      const { service } = await setup();
      const participant = await service.registerTenant({
        trainingApproved: true,
        preferences: { evaluation: false, contribution: true, training: true },
      });
      const now = Date.now(),
        split = {
          target: "assistant" as const,
          trainingBefore: now - 300000,
          calibrationBefore: now - 200000,
          validationBefore: now - 100000,
          holdoutTenants: [1, 2, 3].map(
            (n) => "tenant_" + n.toString().repeat(32),
          ),
        };
      const tenant = await backend.storage.authenticate(
        await digest(participant.apiKey),
      );
      for (let i = 0; i < 3; i++) {
        const id = "sample_" + (i + 1).toString().repeat(32),
          time = now - 350000 + i * 100000;
        await backend.storage.contribute(
          tenant!,
          {
            version: 1,
            sampleId: id,
            sessionReference: "ref_" + (i + 1).toString().repeat(64),
            observedAt: time,
            cohort: "api",
            trainingAllowed: true,
            features: { api_gap_cv: 0.1, api_request_count: 20 },
          },
          now,
        );
        await backend.storage.feedback(
          tenant!.id,
          {
            sampleId: id,
            target: "assistant",
            positive: true,
            source: "verified-delegation",
            evidenceReference: "ref_" + (i + 4).toString().repeat(64),
          },
          time + 100,
        );
      }
      const data = await service.exportClassifier(split);
      expect(data.manifest.partitions.training.positives).toBe(1);
      expect(data.manifest.partitions.calibration.positives).toBe(1);
      expect(data.manifest.partitions.validation.positives).toBe(1);
      expect(data.rows[0]!.source).toBe("verified-delegation");
      await backend.storage.erase(tenant!.id);
      expect((await service.exportClassifier(split)).rows).toHaveLength(0);
    });
  });
