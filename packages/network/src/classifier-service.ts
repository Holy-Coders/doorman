import type { FeatureVector } from "./schema.js";
import type { NetworkStorage, StoredClassifier, Tenant } from "./storage.js";
import type {
  ClassifierAssessment,
  ClassifierSplit,
  JevFeatureResult,
} from "./classifier-schema.js";
import type { ClassifierFeatureEvaluator } from "./classifier-jev.js";
import { jevFeatureResultSchema } from "./classifier-schema.js";
import { createClassifierDataset, canonicalJSON } from "./classifier-data.js";
import { createClassifierPredictor } from "./classifier.js";
import { validateClassifierReport } from "./classifier-evaluation.js";
import { digest, newId } from "./http.js";
const empty = (): ClassifierAssessment => ({
  version: 1,
  status: "unavailable",
  cached: false,
  predictions: [],
});
export function createClassifierService(
  storage: NetworkStorage,
  featureEvaluator: ClassifierFeatureEvaluator | undefined,
  callProvider: (
    tenant: Tenant,
    work: () => Promise<unknown>,
    check: () => void,
  ) => Promise<unknown>,
) {
  return {
    async export(split: ClassifierSplit) {
      const now = Date.now(),
        data = await storage.dataset(split.target, now, split);
      return createClassifierDataset(data.rows, split, {
        ...data,
        now,
        origin: "observed",
      });
    },
    async stage(value: unknown) {
      const model = validateClassifierReport(value);
      await storage.saveClassifier(model);
      return {
        modelId: model.id,
        status: "shadow" as const,
        eligible: model.eligible,
      };
    },
    async classify(
      tenant: Tenant,
      features: FeatureVector,
      check: () => void,
    ): Promise<ClassifierAssessment> {
      const now = Date.now(),
        revision = await storage.revision();
      const models = (
        await Promise.all([
          storage.latestClassifier(now, "assistant"),
          storage.latestClassifier(now, "abuse"),
        ])
      ).filter((m): m is StoredClassifier => !!m);
      if (!models.length) return empty();
      const fingerprint = await digest(canonicalJSON(features));
      const bucket =
        parseInt((await digest(tenant.id + fingerprint)).slice(0, 8), 16) % 100;
      const key =
        "classifier:" +
        (await digest(
          canonicalJSON([
            tenant.id,
            revision,
            models.map((m) => [m.model.id, m.status, m.canaryPercent]),
            fingerprint,
          ]),
        ));
      const cached = await storage.cachedClassifier(key, now);
      check();
      if (cached)
        return revision === (await storage.revision()) &&
          models.every((m) => m.model.manifest.expiresAt > Date.now())
          ? cached
          : empty();
      const lease = newId("lease");
      if (!(await storage.claim(key, lease, now))) return empty();
      let jev: JevFeatureResult | undefined;
      if (
        models.some((m) => m.model.selected.mode === "jev") &&
        featureEvaluator
      ) {
        try {
          jev = jevFeatureResultSchema.parse(
            await callProvider(tenant, () => featureEvaluator(features), check),
          );
        } catch {
          /* Missing evidence abstains. */
        }
      }
      const predictions: ClassifierAssessment["predictions"] = models.map(
        (m) => {
          const result = createClassifierPredictor(m.model).predict(
            features,
            jev,
            Date.now(),
          );
          return {
            target: m.model.manifest.split.target,
            modelId: m.model.id,
            mode:
              m.status === "canary" && bucket < m.canaryPercent
                ? "canary"
                : "shadow",
            ...result,
            aboveThreshold:
              result.score !== null && result.score >= m.model.threshold,
          };
        },
      );
      check();
      if (revision !== (await storage.revision())) return empty();
      const result: ClassifierAssessment = {
        version: 1,
        status: predictions.some((p) => p.score !== null)
          ? "evaluated"
          : "unavailable",
        cached: false,
        predictions,
      };
      await storage.saveClassification(
        key,
        lease,
        result,
        Math.min(
          now + (result.status === "evaluated" ? 60000 : 5000),
          ...models.map((m) => m.model.manifest.expiresAt),
        ),
      );
      return result;
    },
  };
}
