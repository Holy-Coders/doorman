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

// Structural subset of the D1 binding; no Workers runtime dependency in consumers.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: boolean;
  }>;
  run(): Promise<{ success: boolean }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<{ success: boolean }[]>;
}
const LOOKUP_ROWS_PER_INDEX = 50;
function assertSuccess(result: { success: boolean }) {
  if (!result.success) throw new Error("D1 operation failed");
}
export function createD1Storage(
  db: D1Database,
  options: RetentionOptions = {},
): ManagedVisitorStorage {
  const retention = retentionOptions(options);
  const cutoff = () => Date.now() - retention.observationRetentionDays * DAY_MS;
  async function run(sql: string, values: unknown[]) {
    assertSuccess(
      await db
        .prepare(sql)
        .bind(...values)
        .run(),
    );
  }
  async function all<T>(sql: string, values: unknown[]): Promise<T[]> {
    const result = await db
      .prepare(sql)
      .bind(...values)
      .all<T>();
    assertSuccess(result);
    return result.results;
  }
  return {
    async findCandidates(observation, limit) {
      const values: unknown[] = [];
      const branches: string[] = [];
      const add = (where: string, parameters: unknown[]) => {
        branches.push(
          `SELECT visitor_id, seen_at FROM (SELECT visitor_id, seen_at FROM observations WHERE ${where} AND seen_at >= ? ORDER BY seen_at DESC LIMIT ${LOOKUP_ROWS_PER_INDEX})`,
        );
        values.push(...parameters, cutoff());
      };
      if (observation.platform && observation.browser)
        add("platform = ? AND browser = ?", [
          observation.platform,
          observation.browser,
        ]);
      if (observation.graphics?.webglRenderer)
        add("webgl_renderer = ?", [observation.graphics.webglRenderer]);
      if (observation.timezone && observation.browser)
        add("timezone = ? AND browser = ?", [
          observation.timezone,
          observation.browser,
        ]);
      if (!branches.length) return [];
      const rows = await all<{ visitor_id: string; last_seen_at: number }>(
        `SELECT visitor_id, MAX(seen_at) AS last_seen_at FROM (${branches.join(" UNION ALL ")}) GROUP BY visitor_id ORDER BY last_seen_at DESC, visitor_id LIMIT ?`,
        [...values, boundedLimit(limit, 10)],
      );
      return rows.map((row) => ({
        visitorId: row.visitor_id,
        lastSeenAt: Number(row.last_seen_at),
      }));
    },
    async getRecentObservations(visitorId, limit) {
      const rows = await all<{ signals_json: string }>(
        "SELECT signals_json FROM observations WHERE visitor_id = ? AND seen_at >= ? ORDER BY seen_at DESC, id DESC LIMIT ?",
        [visitorId, cutoff(), boundedLimit(limit, 5)],
      );
      return rows.map(
        (row) => JSON.parse(row.signals_json) as NormalizedObservation,
      );
    },
    async createVisitor() {
      const id = createVisitorId();
      const now = Date.now();
      await run(
        "INSERT INTO visitors (id, created_at, last_seen_at) VALUES (?, ?, ?)",
        [id, now, now],
      );
      return id;
    },
    async saveObservation(visitorId, observation) {
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO observations (visitor_id, seen_at, platform, browser, timezone, webgl_renderer, signals_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            visitorId,
            Date.now(),
            observation.platform ?? null,
            observation.browser ?? null,
            observation.timezone ?? null,
            observation.graphics?.webglRenderer ?? null,
            JSON.stringify(observation),
          ),
        db
          .prepare(
            "DELETE FROM observations WHERE visitor_id = ? AND (seen_at < ? OR id IN (SELECT id FROM observations WHERE visitor_id = ? ORDER BY seen_at DESC, id DESC LIMIT -1 OFFSET ?))",
          )
          .bind(
            visitorId,
            cutoff(),
            visitorId,
            retention.maxObservationsPerVisitor,
          ),
      ]);
      results.forEach(assertSuccess);
    },
    async touchVisitor(visitorId) {
      await run(
        "UPDATE visitors SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?",
        [Date.now(), visitorId],
      );
    },
    async deleteVisitor(visitorId) {
      await run("DELETE FROM visitors WHERE id = ?", [visitorId]);
    },
    async cleanup() {
      const results = await db.batch([
        db.prepare("DELETE FROM observations WHERE seen_at < ?").bind(cutoff()),
        db
          .prepare(
            "DELETE FROM observations WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY seen_at DESC, id DESC) AS position FROM observations) WHERE position > ?)",
          )
          .bind(retention.maxObservationsPerVisitor),
        db
          .prepare(
            "DELETE FROM visitors WHERE last_seen_at < ? AND NOT EXISTS (SELECT 1 FROM observations WHERE visitor_id = visitors.id)",
          )
          .bind(cutoff()),
      ]);
      results.forEach(assertSuccess);
    },
  };
}

export * from "./identity.js";
