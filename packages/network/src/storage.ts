import type {
  ClassifierAssessment,
  ClassifierModel,
} from "./classifier-schema.js";
import { classifierAssessmentSchema } from "./classifier-schema.js";
import { validateClassifierReport } from "./classifier-evaluation.js";
import type {
  Contribution,
  Feedback,
  NetworkAssessment,
  NetworkPreferences,
  TrainingRow,
  Target,
} from "./schema.js";
import type { PatternModel } from "./discovery.js";
import type { DiscoveryOptions } from "./discovery.js";

export type Tenant = {
  id: string;
  preferences: NetworkPreferences;
  retentionDays: number;
  trainingApproved: boolean;
};
export type StoredModel = {
  model: PatternModel;
  canaryPercent: number;
  status: "shadow" | "canary";
};
export type StoredClassifier = {
  model: ClassifierModel;
  status: "shadow" | "canary";
  canaryPercent: number;
};
export interface NetworkStorage {
  saveClassifier(model: ClassifierModel): Promise<void>;
  latestClassifier(
    now: number,
    target: Target,
  ): Promise<StoredClassifier | undefined>;
  promoteClassifier(id: string, percent: number, now: number): Promise<void>;
  rollbackClassifier(id: string): Promise<void>;
  cachedClassifier(
    key: string,
    now: number,
  ): Promise<ClassifierAssessment | undefined>;
  saveClassification(
    key: string,
    lease: string,
    result: ClassifierAssessment,
    expiresAt: number,
  ): Promise<void>;
  registerTenant(input: Tenant & { keyHash: string }): Promise<void>;
  authenticate(keyHash: string): Promise<Tenant | undefined>;
  preferences(tenantId: string, value: NetworkPreferences): Promise<void>;
  contribute(
    tenant: Tenant,
    sample: Contribution,
    now: number,
  ): Promise<{ sampleId: string; created: boolean }>;
  feedback(
    tenantId: string,
    feedback: Feedback,
    now: number,
  ): Promise<"recorded" | "duplicate" | "disputed" | "missing">;
  erase(tenantId: string, sampleId?: string): Promise<void>;
  revokeTenant(tenantId: string): Promise<void>;
  quota(
    key: string,
    window: number,
    maximum: number,
    expiresAt: number,
  ): Promise<boolean>;
  revision(): Promise<number>;
  dataset(
    target: Target,
    now: number,
    split?: Pick<
      DiscoveryOptions,
      "trainingBefore" | "validationBefore" | "holdoutTenants"
    > & { calibrationBefore?: number },
  ): Promise<{
    rows: TrainingRow[];
    revision: number;
    truncated: boolean;
    sampled: boolean;
  }>;
  saveModel(model: PatternModel): Promise<void>;
  latestModel(now: number, target?: Target): Promise<StoredModel | undefined>;
  promote(modelId: string, canaryPercent: number, now: number): Promise<void>;
  rollback(modelId: string): Promise<void>;
  cached(key: string, now: number): Promise<NetworkAssessment | undefined>;
  claim(key: string, lease: string, now: number): Promise<boolean>;
  saveAssessment(
    key: string,
    lease: string,
    result: NetworkAssessment,
    expiresAt: number,
  ): Promise<void>;
  cleanup(now: number): Promise<void>;
}

export type Statement = { sql: string; args?: unknown[] };
export type NetworkDatabase = {
  query(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Must be an actual transaction: revocation and model invalidation commit together. */
  atomic(statements: Statement[]): Promise<void>;
};
const preferences = (row: Record<string, unknown>): NetworkPreferences => ({
  evaluation: !!Number(row.evaluation),
  contribution: !!Number(row.contribution),
  training: !!Number(row.training),
});

/** SQL shared by the concrete D1 and Postgres transports; no background workers. */
export function createNetworkStorage(db: NetworkDatabase): NetworkStorage {
  return {
    async registerTenant(input) {
      await db.query(
        "INSERT INTO jn_tenants (id,key_hash,evaluation,contribution,training,retention_days,training_approved) VALUES (?,?,?,?,?,?,?)",
        [
          input.id,
          input.keyHash,
          Number(input.preferences.evaluation),
          Number(input.preferences.contribution),
          Number(input.preferences.training),
          input.retentionDays,
          Number(input.trainingApproved),
        ],
      );
    },
    async authenticate(keyHash) {
      const row = (
        await db.query("SELECT * FROM jn_tenants WHERE key_hash = ?", [keyHash])
      )[0];
      return row
        ? {
            id: String(row.id),
            preferences: preferences(row),
            retentionDays: Number(row.retention_days),
            trainingApproved: !!Number(row.training_approved),
          }
        : undefined;
    },
    async preferences(id, value) {
      const statements: Statement[] = [];
      if (!value.contribution || !value.training)
        statements.push({
          sql: "UPDATE jn_meta SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM jn_samples WHERE tenant_id=? AND training_allowed=1)",
          args: [id],
        });
      statements.push({
        sql: "UPDATE jn_tenants SET evaluation=?, contribution=?, training=CASE WHEN training_approved=1 THEN ? ELSE 0 END WHERE id=?",
        args: [
          Number(value.evaluation),
          Number(value.contribution),
          Number(value.training),
          id,
        ],
      });
      // Disabling contribution erases it. Turning training off irrevocably removes eligibility
      // from existing samples; re-enabling applies only to new contributions.
      if (!value.contribution)
        statements.push({
          sql: "DELETE FROM jn_samples WHERE tenant_id=?",
          args: [id],
        });
      else if (!value.training)
        statements.push({
          sql: "UPDATE jn_samples SET training_allowed=0 WHERE tenant_id=?",
          args: [id],
        });
      await db.atomic(statements);
    },
    async contribute(tenant, sample, now) {
      const payload = JSON.stringify(sample.features);
      const inserted = await db.query(
        "INSERT INTO jn_samples (tenant_id,id,session_ref,observed_at,features,cohort,training_allowed,expires_at) SELECT id,?,?,?,?,?,CASE WHEN training=1 AND ?=1 THEN 1 ELSE 0 END,? FROM jn_tenants WHERE id=? AND contribution=1 ON CONFLICT DO NOTHING RETURNING id",
        [
          sample.sampleId,
          sample.sessionReference,
          sample.observedAt,
          payload,
          sample.cohort,
          Number(sample.trainingAllowed),
          now + tenant.retentionDays * 86_400_000,
          tenant.id,
        ],
      );
      if (inserted.length) return { sampleId: sample.sampleId, created: true };
      const old = (
        await db.query(
          "SELECT id,features,observed_at FROM jn_samples WHERE tenant_id=? AND (id=? OR session_ref=?) LIMIT 1",
          [tenant.id, sample.sampleId, sample.sessionReference],
        )
      )[0];
      if (
        !old ||
        String(old.features) !== payload ||
        Number(old.observed_at) !== sample.observedAt
      )
        throw new Error("Contribution conflict or revoked");
      return { sampleId: String(old.id), created: false };
    },
    async feedback(tenantId, label, now) {
      const sample = (
        await db.query(
          "SELECT id FROM jn_samples WHERE tenant_id=? AND id=? AND expires_at>?",
          [tenantId, label.sampleId, now],
        )
      )[0];
      if (!sample) return "missing";
      const args = [
        tenantId,
        label.sampleId,
        label.target,
        Number(label.positive),
        label.source,
        label.evidenceReference,
        now,
      ];
      await db.atomic([
        {
          sql: "UPDATE jn_meta SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM jn_labels l JOIN jn_samples s ON s.tenant_id=l.tenant_id AND s.id=l.sample_id WHERE l.tenant_id=? AND l.sample_id=? AND l.target=? AND l.positive<>? AND s.training_allowed=1)",
          args: args.slice(0, 4),
        },
        {
          sql: "INSERT INTO jn_labels (tenant_id,sample_id,target,positive,source,evidence_ref,confirmed_at,disputed) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(tenant_id,sample_id,target) DO UPDATE SET disputed=CASE WHEN jn_labels.positive<>excluded.positive THEN 1 ELSE jn_labels.disputed END",
          args,
        },
      ]);
      const row = (
        await db.query(
          "SELECT disputed,confirmed_at FROM jn_labels WHERE tenant_id=? AND sample_id=? AND target=?",
          [tenantId, label.sampleId, label.target],
        )
      )[0]!;
      return Number(row.disputed)
        ? "disputed"
        : Number(row.confirmed_at) === now
          ? "recorded"
          : "duplicate";
    },
    async erase(tenantId, sampleId) {
      const where = "tenant_id=?" + (sampleId ? " AND id=?" : ""),
        args = sampleId ? [tenantId, sampleId] : [tenantId];
      await db.atomic([
        {
          sql: `UPDATE jn_meta SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM jn_samples WHERE ${where} AND training_allowed=1)`,
          args,
        },
        { sql: `DELETE FROM jn_samples WHERE ${where}`, args },
      ]);
    },
    async revokeTenant(tenantId) {
      await db.atomic([
        {
          sql: "UPDATE jn_meta SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM jn_samples WHERE tenant_id=? AND training_allowed=1)",
          args: [tenantId],
        },
        { sql: "DELETE FROM jn_tenants WHERE id=?", args: [tenantId] },
      ]);
    },
    async quota(key, window, maximum, expiresAt) {
      if (maximum < 1) return false;
      return (
        (
          await db.query(
            "INSERT INTO jn_quotas (key,window_id,used,expires_at) VALUES (?,?,1,?) ON CONFLICT(key,window_id) DO UPDATE SET used=jn_quotas.used+1 WHERE jn_quotas.used<? RETURNING used",
            [key, window, expiresAt, maximum],
          )
        ).length > 0
      );
    },
    async revision() {
      return Number(
        (await db.query("SELECT revision FROM jn_meta WHERE id=1"))[0]!
          .revision,
      );
    },
    async dataset(target, now, split) {
      const before = await this.revision();
      const tenants = await db.query(
        "SELECT id FROM jn_tenants WHERE contribution=1 AND training=1 ORDER BY id LIMIT 11",
      );
      const rows: TrainingRow[] = [];
      let truncated = tenants.length > 10;
      let sampled = false;
      // Indexed per-tenant cap prevents one contributor dominating retrieval.
      for (const tenant of tenants.slice(0, 10)) {
        const ranges = split
          ? split.holdoutTenants.includes(String(tenant.id))
            ? [[split.validationBefore, now + 1, now + 1]]
            : [
                [0, split.trainingBefore, split.trainingBefore],
                ...(split.calibrationBefore
                  ? [
                      [
                        split.trainingBefore,
                        split.calibrationBefore,
                        split.calibrationBefore,
                      ],
                      [
                        split.calibrationBefore,
                        split.validationBefore,
                        split.validationBefore,
                      ],
                    ]
                  : [
                      [
                        split.trainingBefore,
                        split.validationBefore,
                        split.validationBefore,
                      ],
                    ]),
              ]
          : [[0, now + 1, now + 1]];
        for (const [from, until, confirmedBefore] of ranges) {
          const samples = await db.query(
            "SELECT s.*,l.target,l.positive,l.confirmed_at,l.source,l.evidence_ref FROM jn_samples s JOIN jn_labels l ON s.tenant_id=l.tenant_id AND s.id=l.sample_id WHERE s.tenant_id=? AND s.training_allowed=1 AND s.expires_at>? AND l.target=? AND l.disputed=0 AND s.observed_at>=? AND s.observed_at<? AND l.confirmed_at<? ORDER BY s.observed_at DESC,s.id LIMIT 501",
            [tenant.id, now, target, from, until, confirmedBefore],
          );
          sampled ||= samples.length > 500;
          rows.push(
            ...samples.slice(0, 500).map((r) => ({
              version: 1 as const,
              tenantId: String(r.tenant_id),
              sampleId: String(r.id),
              sessionReference: String(r.session_ref),
              observedAt: Number(r.observed_at),
              features: JSON.parse(String(r.features)),
              cohort: String(r.cohort) as TrainingRow["cohort"],
              trainingAllowed: true,
              target: r.target as Target,
              positive: !!Number(r.positive),
              confirmedAt: Number(r.confirmed_at),
              source: r.source as TrainingRow["source"],
              evidenceReference: String(r.evidence_ref),
              expiresAt: Number(r.expires_at),
            })),
          );
        }
      }
      if (before !== (await this.revision()))
        throw new Error("Dataset changed during export; retry");
      truncated ||= rows.length > 10000;
      return {
        rows: rows.slice(0, 10000),
        revision: before,
        truncated,
        sampled,
      };
    },
    async saveModel(model) {
      if (model.datasetRevision !== (await this.revision()))
        throw new Error("Dataset was revoked");
      await db.query(
        "INSERT INTO jn_models (id,created_at,expires_at,revision,payload,target,status,canary) VALUES (?,?,?,?,?,?,'shadow',0)",
        [
          model.id,
          model.createdAt,
          model.expiresAt,
          model.datasetRevision,
          JSON.stringify(model),
          model.target,
        ],
      );
    },
    async latestModel(now, target = "assistant") {
      const row = (
        await db.query(
          "SELECT m.* FROM jn_models m JOIN jn_meta g ON g.revision=m.revision WHERE m.expires_at>? AND m.target=? AND m.status IN ('shadow','canary') ORDER BY CASE WHEN m.status='canary' THEN 0 ELSE 1 END,m.created_at DESC LIMIT 1",
          [now, target],
        )
      )[0];
      return row
        ? {
            model: JSON.parse(String(row.payload)) as PatternModel,
            canaryPercent: Number(row.canary),
            status: row.status as "shadow" | "canary",
          }
        : undefined;
    },
    async promote(id, percent, now) {
      if (!Number.isInteger(percent) || percent < 1 || percent > 100)
        throw new Error("Canary percentage must be 1–100");
      const row = (
        await db.query("SELECT * FROM jn_models WHERE id=?", [id])
      )[0];
      if (!row) throw new Error("Unknown model");
      const model = JSON.parse(String(row.payload)) as PatternModel;
      if (
        !model.eligible ||
        !Object.values(model.gates).every((v) => v === true) ||
        model.expiresAt <= now ||
        model.datasetRevision !== (await this.revision())
      )
        throw new Error(
          "Model has not passed validation or has expired/revoked evidence",
        );
      await db.atomic([
        {
          sql: "UPDATE jn_models SET status='retired' WHERE status='canary' AND target=?",
          args: [model.target],
        },
        {
          sql: "UPDATE jn_models SET status='canary',canary=? WHERE id=? AND revision=(SELECT revision FROM jn_meta WHERE id=1)",
          args: [percent, id],
        },
      ]);
    },
    async rollback(id) {
      await db.query(
        "UPDATE jn_models SET status='retired',canary=0 WHERE id=?",
        [id],
      );
    },
    async cached(key, now) {
      const row = (
        await db.query(
          "SELECT result FROM jn_cache WHERE key=? AND expires_at>? AND result IS NOT NULL",
          [key, now],
        )
      )[0];
      return row
        ? ({
            ...JSON.parse(String(row.result)),
            cached: true,
          } as NetworkAssessment)
        : undefined;
    },
    async claim(key, lease, now) {
      return (
        (
          await db.query(
            "INSERT INTO jn_cache (key,lease,expires_at,result) VALUES (?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET lease=excluded.lease,expires_at=excluded.expires_at,result=NULL WHERE jn_cache.expires_at<=? RETURNING key",
            [key, lease, now + 10_000, now],
          )
        ).length > 0
      );
    },
    async saveAssessment(key, lease, result, expiresAt) {
      await db.query(
        "UPDATE jn_cache SET result=?,expires_at=? WHERE key=? AND lease=?",
        [JSON.stringify(result), expiresAt, key, lease],
      );
    },
    async saveClassifier(input) {
      const model = validateClassifierReport(input),
        m = model.manifest;
      if (
        m.origin !== "observed" ||
        m.expiresAt <= Date.now() ||
        m.revision !== (await this.revision())
      )
        throw new Error("Expired, synthetic or revoked evidence");
      const inserted = await db.query(
        "INSERT INTO jn_classifiers (id,created_at,expires_at,revision,target,status,canary,payload) SELECT ?,?,?,?,?,'shadow',0,? WHERE ?=(SELECT revision FROM jn_meta WHERE id=1) RETURNING id",
        [
          model.id,
          Date.now(),
          m.expiresAt,
          m.revision,
          m.split.target,
          JSON.stringify(model),
          m.revision,
        ],
      );
      if (!inserted.length)
        throw new Error("Dataset changed while staging classifier");
    },
    async latestClassifier(now, target) {
      const row = (
        await db.query(
          "SELECT c.* FROM jn_classifiers c JOIN jn_meta g ON g.revision=c.revision WHERE c.expires_at>? AND c.target=? AND c.status IN ('shadow','canary') ORDER BY CASE WHEN c.status='canary' THEN 0 ELSE 1 END,c.created_at DESC LIMIT 1",
          [now, target],
        )
      )[0];
      return row
        ? {
            model: validateClassifierReport(JSON.parse(String(row.payload))),
            status: row.status as "shadow" | "canary",
            canaryPercent: Number(row.canary),
          }
        : undefined;
    },
    async promoteClassifier(id, percent, now) {
      if (!Number.isInteger(percent) || percent < 1 || percent > 100)
        throw new Error("Invalid canary percentage");
      const row = (
        await db.query(
          "SELECT payload FROM jn_classifiers WHERE id=? AND status!='retired'",
          [id],
        )
      )[0];
      if (!row) throw new Error("Unknown classifier");
      const model = validateClassifierReport(JSON.parse(String(row.payload)));
      if (
        !model.eligible ||
        model.manifest.expiresAt <= now ||
        model.manifest.revision !== (await this.revision())
      )
        throw new Error("Classifier did not pass promotion gates");
      await db.atomic([
        {
          sql: "UPDATE jn_classifiers SET status='retired' WHERE target=? AND status='canary'",
          args: [model.manifest.split.target],
        },
        {
          sql: "UPDATE jn_classifiers SET status='canary',canary=? WHERE id=? AND revision=(SELECT revision FROM jn_meta WHERE id=1)",
          args: [percent, id],
        },
      ]);
    },
    async rollbackClassifier(id) {
      await db.query(
        "UPDATE jn_classifiers SET status='retired',canary=0 WHERE id=?",
        [id],
      );
    },
    async cachedClassifier(key, now) {
      const row = (
        await db.query(
          "SELECT result FROM jn_cache WHERE key=? AND expires_at>? AND result IS NOT NULL",
          [key, now],
        )
      )[0];
      return row
        ? classifierAssessmentSchema.parse({
            ...JSON.parse(String(row.result)),
            cached: true,
          })
        : undefined;
    },
    async saveClassification(key, lease, result, expiresAt) {
      await db.query(
        "UPDATE jn_cache SET result=?,expires_at=? WHERE key=? AND lease=?",
        [
          JSON.stringify(classifierAssessmentSchema.parse(result)),
          expiresAt,
          key,
          lease,
        ],
      );
    },
    async cleanup(now) {
      await db.atomic([
        {
          sql: "DELETE FROM jn_samples WHERE (tenant_id,id) IN (SELECT tenant_id,id FROM jn_samples WHERE expires_at<=? ORDER BY expires_at LIMIT 500)",
          args: [now],
        },
        {
          sql: "DELETE FROM jn_cache WHERE key IN (SELECT key FROM jn_cache WHERE expires_at<=? LIMIT 500)",
          args: [now],
        },
        {
          sql: "DELETE FROM jn_quotas WHERE (key,window_id) IN (SELECT key,window_id FROM jn_quotas WHERE expires_at<=? LIMIT 500)",
          args: [now],
        },
        { sql: "DELETE FROM jn_models WHERE expires_at<=?", args: [now] },
        { sql: "DELETE FROM jn_classifiers WHERE expires_at<=?", args: [now] },
      ]);
    },
  };
}
