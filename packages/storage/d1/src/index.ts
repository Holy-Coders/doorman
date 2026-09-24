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
  batch(
    statements: D1Statement[],
  ): Promise<{ success: boolean; results?: Record<string, unknown>[] }[]>;
}
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
    async findCandidates(observation, limit, scope) {
      const values: unknown[] = [];
      const bind = (value: unknown) => {
        values.push(value);
        return "?";
      };
      const branches: string[] = [];
      const add = (where: string) => {
        const probe = branches.length;
        const recent = bind(cutoff());
        branches.push(
          `SELECT visitor_id, seen_at, signals_json, ${probe} AS probe FROM (SELECT visitor_id, seen_at, signals_json FROM observations WHERE ${where} AND seen_at >= ${recent} ORDER BY seen_at DESC LIMIT ${LOOKUP_LIMITS.rowsPerProbe + 1})`,
        );
      };
      const { platform, browser, timezone, screen, hardware, graphics } =
        observation;
      const base = () =>
        `platform = ${bind(platform)} AND browser = ${bind(browser)}`;
      const dimensions = () =>
        `json_extract(signals_json, '$.screen.width') = ${bind(screen!.width)} AND json_extract(signals_json, '$.screen.height') = ${bind(screen!.height)}`;
      if (platform && browser) {
        if (screen?.width && screen.height) {
          if (hardware?.hardwareConcurrency)
            add(
              `${base()} AND ${dimensions()} AND json_extract(signals_json, '$.hardware.hardwareConcurrency') = ${bind(hardware.hardwareConcurrency)}`,
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
      // D1 limits compound SELECT terms. Batch the six independent bounded probes.
      let offset = 0;
      const results = await db.batch(
        branches.map((sql) => {
          const count = (sql.match(/\?/g) ?? []).length;
          const params = values.slice(offset, offset + count);
          offset += count;
          return db.prepare(sql).bind(...params);
        }),
      );
      results.forEach(assertSuccess);
      const rows = results.flatMap((result) => result.results ?? []) as {
        visitor_id: string;
        seen_at: number;
        probe: number;
        signals_json: string;
      }[];
      return rankLookupRows(
        rows.map((row) => ({
          visitorId: String(row.visitor_id),
          seenAt: Number(row.seen_at),
          probe: Number(row.probe),
          observation: JSON.parse(row.signals_json) as NormalizedObservation,
        })),
        observation,
        boundedLimit(limit, LOOKUP_LIMITS.candidates),
      );
    },
    async getRecentObservationsBatch(visitorIds, limit) {
      const ids = [...new Set(visitorIds)].slice(0, LOOKUP_LIMITS.candidates);
      if (!ids.length) return {};
      const results = await db.batch(
        ids.map((id) =>
          db
            .prepare(
              "SELECT visitor_id, signals_json FROM observations WHERE visitor_id = ? AND seen_at >= ? ORDER BY seen_at DESC, id DESC LIMIT ?",
            )
            .bind(id, cutoff(), boundedLimit(limit, 5)),
        ),
      );
      results.forEach(assertSuccess);
      const rows = results.flatMap((result) => result.results ?? []) as {
        visitor_id: string;
        signals_json: string;
      }[];
      const histories: Record<string, NormalizedObservation[]> = {};
      for (const row of rows)
        (histories[String(row.visitor_id)] ??= []).push(
          JSON.parse(row.signals_json) as NormalizedObservation,
        );
      return histories;
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
    async cleanup(options = {}) {
      const size = boundedLimit(options.batchSize ?? 100, 1000);
      const recent = cutoff();
      // Expiration and count repair are separately bounded. The keyset cursor avoids
      // rescanning every visitor or sorting the entire observation table.
      const expired = await all(
        "DELETE FROM observations WHERE id IN (SELECT id FROM observations WHERE seen_at < ? ORDER BY seen_at LIMIT ?) RETURNING id",
        [recent, size],
      );
      const visitors = await all<{ id: string }>(
        "SELECT id FROM visitors WHERE id > ? ORDER BY id LIMIT ?",
        [options.afterVisitorId ?? "", size + 1],
      );
      const ids = visitors.slice(0, size).map((row) => String(row.id));
      if (ids.length) {
        // One JSON parameter avoids D1's 100 bound-parameter limit.
        await run(
          `DELETE FROM observations WHERE id IN (
          SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY seen_at DESC, id DESC) AS position
          FROM observations WHERE visitor_id IN (SELECT value FROM json_each(?))) WHERE position > ?)`,
          [JSON.stringify(ids), retention.maxObservationsPerVisitor],
        );
      }
      const removed = await all(
        `DELETE FROM visitors WHERE id IN (SELECT value FROM json_each(?)) AND last_seen_at < ?
        AND NOT EXISTS (SELECT 1 FROM observations WHERE visitor_id = visitors.id) RETURNING id`,
        [JSON.stringify(ids), recent],
      );
      return {
        nextVisitorId: visitors.length > size ? ids.at(-1) : undefined,
        hasMoreExpired: expired.length === size || removed.length === size,
      };
    },
  };
}

export * from "./identity.js";

export * from "./learning.js";
export { createD1ProtectionStorage } from "./protection.js";
export { createD1EvidenceStorage } from "./evidence.js";
export { createD1ActivityStorage } from "./activity.js";

export { createD1OperatorStorage } from "./operators.js";

export { createD1ContextStorage } from "./context.js";
