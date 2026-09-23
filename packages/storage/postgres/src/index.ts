import {
  boundedLimit,
  createVisitorId,
  DAY_MS,
  retentionOptions,
} from "@janitor/core";
import type {
  ManagedVisitorStorage,
  NormalizedObservation,
  RetentionOptions,
} from "@janitor/core";

// Compatible with pg.Pool and pg.Client, without owning the connection lifecycle.
export interface PostgresDatabase {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
const LOOKUP_ROWS_PER_INDEX = 50;
export function createPostgresStorage(
  db: PostgresDatabase,
  options: RetentionOptions = {},
): ManagedVisitorStorage {
  const retention = retentionOptions(options);
  const cutoff = () => Date.now() - retention.observationRetentionDays * DAY_MS;
  return {
    async findCandidates(observation, limit) {
      const values: unknown[] = [];
      const bind = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      const recent = bind(cutoff());
      const branches: string[] = [];
      const add = (where: string) =>
        branches.push(
          `(SELECT visitor_id, seen_at FROM observations WHERE ${where} AND seen_at >= ${recent} ORDER BY seen_at DESC LIMIT ${LOOKUP_ROWS_PER_INDEX})`,
        );
      if (observation.platform && observation.browser)
        add(
          `platform = ${bind(observation.platform)} AND browser = ${bind(observation.browser)}`,
        );
      if (observation.graphics?.webglRenderer)
        add(`webgl_renderer = ${bind(observation.graphics.webglRenderer)}`);
      if (observation.timezone && observation.browser)
        add(
          `timezone = ${bind(observation.timezone)} AND browser = ${bind(observation.browser)}`,
        );
      if (!branches.length) return [];
      const result = await db.query(
        `SELECT visitor_id, MAX(seen_at) AS last_seen_at FROM (${branches.join(" UNION ALL ")}) AS plausible GROUP BY visitor_id ORDER BY last_seen_at DESC, visitor_id LIMIT ${bind(boundedLimit(limit, 10))}`,
        values,
      );
      return result.rows.map((row) => ({
        visitorId: String(row.visitor_id),
        lastSeenAt: Number(row.last_seen_at),
      }));
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
    async cleanup() {
      await db.query("DELETE FROM observations WHERE seen_at < $1", [cutoff()]);
      await db.query(
        "DELETE FROM observations WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY seen_at DESC, id DESC) AS position FROM observations) AS ranked WHERE position > $1)",
        [retention.maxObservationsPerVisitor],
      );
      await db.query(
        "DELETE FROM visitors WHERE last_seen_at < $1 AND NOT EXISTS (SELECT 1 FROM observations WHERE visitor_id = visitors.id)",
        [cutoff()],
      );
    },
  };
}

export * from "./identity.js";
