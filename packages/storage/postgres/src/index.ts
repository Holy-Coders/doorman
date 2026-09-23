import {
  boundedLimit,
  LOOKUP_LIMITS,
  rankLookupRows,
  createVisitorId,
  DAY_MS,
  retentionOptions,
} from "@aarondovturkel/doorman-core";
import type {
  ManagedVisitorStorage,
  NormalizedObservation,
  RetentionOptions,
} from "@aarondovturkel/doorman-core";

// Compatible with pg.Pool and pg.Client, without owning the connection lifecycle.
export interface PostgresDatabase {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
export function createPostgresStorage(
  db: PostgresDatabase,
  options: RetentionOptions = {},
): ManagedVisitorStorage {
  const retention = retentionOptions(options);
  const cutoff = () => Date.now() - retention.observationRetentionDays * DAY_MS;
  return {
    async findCandidates(observation, limit, scope) {
      const values: unknown[] = [];
      const bind = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      const branches: string[] = [];
      const add = (where: string) => {
        const probe = branches.length;
        const recent = bind(cutoff());
        branches.push(
          `(SELECT visitor_id, seen_at, signals_json, ${probe} AS probe FROM observations WHERE ${where} AND seen_at >= ${recent} ORDER BY seen_at DESC LIMIT ${LOOKUP_LIMITS.rowsPerProbe + 1})`,
        );
      };
      const { platform, browser, timezone, screen, hardware, graphics } =
        observation;
      const base = () =>
        `platform = ${bind(platform)} AND browser = ${bind(browser)}`;
      const dimensions = () =>
        `(signals_json #>> '{screen,width}') = ${bind(String(screen!.width))} AND (signals_json #>> '{screen,height}') = ${bind(String(screen!.height))}`;
      if (platform && browser) {
        if (screen?.width && screen.height) {
          if (hardware?.hardwareConcurrency)
            add(
              `${base()} AND ${dimensions()} AND (signals_json #>> '{hardware,hardwareConcurrency}') = ${bind(String(hardware.hardwareConcurrency))}`,
            );
          if (timezone && scope?.locale !== false)
            add(
              `${base()} AND ${dimensions()} AND timezone = ${bind(timezone)}`,
            );
        }
        if (
          graphics?.webglRenderer &&
          timezone &&
          scope?.graphics !== false &&
          scope?.locale !== false
        )
          add(
            `${base()} AND webgl_renderer = ${bind(graphics.webglRenderer)} AND timezone = ${bind(timezone)}`,
          );
        add(base());
      }
      if (graphics?.webglRenderer && scope?.graphics !== false)
        add(`webgl_renderer = ${bind(graphics.webglRenderer)}`);
      if (timezone && browser && scope?.locale !== false)
        add(`timezone = ${bind(timezone)} AND browser = ${bind(browser)}`);
      if (!branches.length) return [];
      const rows = (await db.query(branches.join(" UNION ALL "), values)).rows;
      return rankLookupRows(
        rows.map((row) => ({
          visitorId: String(row.visitor_id),
          seenAt: Number(row.seen_at),
          probe: Number(row.probe),
          observation: (typeof row.signals_json === "string"
            ? JSON.parse(row.signals_json)
            : row.signals_json) as NormalizedObservation,
        })),
        observation,
        boundedLimit(limit, LOOKUP_LIMITS.candidates),
      );
    },
    async getRecentObservationsBatch(visitorIds, limit) {
      const ids = [...new Set(visitorIds)].slice(0, LOOKUP_LIMITS.candidates);
      if (!ids.length) return {};
      const rows = (
        await db.query(
          `SELECT wanted.visitor_id, h.signals_json FROM unnest($1::text[]) AS wanted(visitor_id)
         CROSS JOIN LATERAL (SELECT signals_json, seen_at, id FROM observations
           WHERE visitor_id = wanted.visitor_id AND seen_at >= $2
           ORDER BY seen_at DESC, id DESC LIMIT $3) h
         ORDER BY wanted.visitor_id, h.seen_at DESC, h.id DESC`,
          [ids, cutoff(), boundedLimit(limit, 5)],
        )
      ).rows;
      const histories: Record<string, NormalizedObservation[]> = {};
      for (const row of rows)
        (histories[String(row.visitor_id)] ??= []).push(
          (typeof row.signals_json === "string"
            ? JSON.parse(row.signals_json)
            : row.signals_json) as NormalizedObservation,
        );
      return histories;
    },
    async getRecentObservations(visitorId, limit) {
      const result = await db.query(
        "SELECT signals_json FROM observations WHERE visitor_id = $1 AND seen_at >= $2 ORDER BY seen_at DESC, id DESC LIMIT $3",
        [visitorId, cutoff(), boundedLimit(limit, 5)],
      );
      return result.rows.map(
        (row) =>
          (typeof row.signals_json === "string"
            ? JSON.parse(row.signals_json)
            : row.signals_json) as NormalizedObservation,
      );
    },
    async createVisitor() {
      const id = createVisitorId();
      const now = Date.now();
      await db.query(
        "INSERT INTO visitors (id, created_at, last_seen_at) VALUES ($1, $2, $3)",
        [id, now, now],
      );
      return id;
    },
    async saveObservation(visitorId, observation) {
      await db.query(
        "INSERT INTO observations (visitor_id, seen_at, platform, browser, timezone, webgl_renderer, signals_json) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
        [
          visitorId,
          Date.now(),
          observation.platform ?? null,
          observation.browser ?? null,
          observation.timezone ?? null,
          observation.graphics?.webglRenderer ?? null,
          JSON.stringify(observation),
        ],
      );
      // Each query is independently committed by the supplied pool. Cleanup also repairs interrupted pruning.
      await db.query(
        "DELETE FROM observations WHERE visitor_id = $1 AND (seen_at < $2 OR id IN (SELECT id FROM observations WHERE visitor_id = $1 ORDER BY seen_at DESC, id DESC OFFSET $3))",
        [visitorId, cutoff(), retention.maxObservationsPerVisitor],
      );
    },
    async touchVisitor(visitorId) {
      await db.query(
        "UPDATE visitors SET last_seen_at = GREATEST(last_seen_at, $1) WHERE id = $2",
        [Date.now(), visitorId],
      );
    },
    async deleteVisitor(visitorId) {
      await db.query("DELETE FROM visitors WHERE id = $1", [visitorId]);
    },
    async cleanup(options = {}) {
      const size = boundedLimit(options.batchSize ?? 100, 1000);
      const recent = cutoff();
      // Expiration and count repair are separately bounded. The keyset cursor avoids
      // rescanning every visitor or sorting the entire observation table.
      const expired = (
        await db.query(
          "DELETE FROM observations WHERE id IN (SELECT id FROM observations WHERE seen_at < $1 ORDER BY seen_at LIMIT $2) RETURNING id",
          [recent, size],
        )
      ).rows;
      const visitors = (
        await db.query(
          "SELECT id FROM visitors WHERE id > $1 ORDER BY id LIMIT $2",
          [options.afterVisitorId ?? "", size + 1],
        )
      ).rows;
      const ids = visitors.slice(0, size).map((row) => String(row.id));
      if (ids.length) {
        await db.query(
          `DELETE FROM observations WHERE id IN (
          SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY seen_at DESC, id DESC) AS position
          FROM observations WHERE visitor_id = ANY($1::text[])) ranked WHERE position > $2)`,
          [ids, retention.maxObservationsPerVisitor],
        );
      }
      const removed = (
        await db.query(
          `DELETE FROM visitors WHERE id = ANY($1::text[]) AND last_seen_at < $2
          AND NOT EXISTS (SELECT 1 FROM observations WHERE visitor_id = visitors.id) RETURNING id`,
          [ids, recent],
        )
      ).rows;
      return {
        nextVisitorId: visitors.length > size ? ids.at(-1) : undefined,
        hasMoreExpired: expired.length === size || removed.length === size,
      };
    },
  };
}

export * from "./identity.js";

export * from "./learning.js";
export { createPostgresProtectionStorage } from "./protection.js";
export { createPostgresEvidenceStorage } from "./evidence.js";
export { createPostgresActivityStorage } from "./activity.js";

export { createPostgresOperatorStorage } from "./operators.js";
