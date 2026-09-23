import { API_ACTIVITY_LIMITS } from "@aarondovturkel/doorman-core";
import type {
  ApiActivityAssessment,
  ApiActivityBucket,
  ApiActivityStorage,
} from "@aarondovturkel/doorman-core";
import type { D1Database } from "./index.js";

function bucket(row: Record<string, unknown>): ApiActivityBucket {
  return {
    windowStart: Number(row.window_start),
    route: String(row.route),
    requests: Number(row.requests),
    denied: Number(row.denied),
    clientErrors: Number(row.client_errors),
    serverErrors: Number(row.server_errors),
    durationTotalMs: Number(row.duration_total_ms),
    durationMaxMs: Number(row.duration_max_ms),
    firstSeenAt: Number(row.first_seen_at),
    lastSeenAt: Number(row.last_seen_at),
    shortGaps: Number(row.short_gaps),
  };
}
export function createD1ActivityStorage(db: D1Database): ApiActivityStorage {
  const cap = API_ACTIVITY_LIMITS.maxCount;
  async function rows(sql: string, args: unknown[]) {
    const result = await db
      .prepare(sql)
      .bind(...args)
      .all();
    if (!result.success) throw new Error("D1 activity operation failed");
    return result.results;
  }
  return {
    async increment(i) {
      const result = await rows(
        `INSERT INTO api_activity_buckets
        (owner,window_start,route,requests,denied,client_errors,server_errors,duration_total_ms,duration_max_ms,first_seen_at,last_seen_at,short_gaps,expires_at)
        VALUES (?,?,?,1,?,?,?,?,?,?,?,0,?)
        ON CONFLICT (owner,window_start,route) DO UPDATE SET
        requests = MIN(requests+1,${cap}), denied = MIN(denied+excluded.denied,${cap}),
        client_errors = MIN(client_errors+excluded.client_errors,${cap}), server_errors = MIN(server_errors+excluded.server_errors,${cap}),
        duration_total_ms = MIN(duration_total_ms+excluded.duration_total_ms,${cap * API_ACTIVITY_LIMITS.maxDurationMs}),
        duration_max_ms = MAX(duration_max_ms,excluded.duration_max_ms),
        short_gaps = MIN(short_gaps + CASE WHEN excluded.last_seen_at >= last_seen_at AND excluded.last_seen_at-last_seen_at < ${API_ACTIVITY_LIMITS.shortGapMs} THEN 1 ELSE 0 END,${cap}),
        first_seen_at = MIN(first_seen_at,excluded.first_seen_at), last_seen_at = MAX(last_seen_at,excluded.last_seen_at),
        expires_at = MAX(expires_at,excluded.expires_at) RETURNING *`,
        [
          i.key,
          i.windowStart,
          i.route,
          Number(i.status === 401 || i.status === 403),
          Number(i.status >= 400 && i.status < 500),
          Number(i.status >= 500),
          i.durationMs,
          i.durationMs,
          i.now,
          i.now,
          i.expiresAt,
        ],
      );
      return bucket(result[0]!);
    },
    async recent(key, since, until) {
      return (
        await rows(
          "SELECT * FROM api_activity_buckets WHERE owner=? AND window_start >= ? AND window_start <= ? ORDER BY window_start DESC,route LIMIT ?",
          [key, since, until, API_ACTIVITY_LIMITS.rows + 1],
        )
      ).map(bucket);
    },
    async claim(key, owner, lease, now, nextAt) {
      return (
        (
          await rows(
            `INSERT INTO api_activity_assessments (id,owner,lease,next_at) VALUES (?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET lease=excluded.lease,next_at=excluded.next_at,record=NULL WHERE next_at <= ? RETURNING id`,
            [key, owner, lease, nextAt, now],
          )
        ).length === 1
      );
    },
    async cached(key, now) {
      const row = (
        await rows(
          "SELECT record FROM api_activity_assessments WHERE id=? AND next_at>?",
          [key, now],
        )
      )[0];
      const result = row?.record
        ? (JSON.parse(String(row.record)) as ApiActivityAssessment)
        : undefined;
      return result && result.expiresAt > now ? result : undefined;
    },
    async save(key, lease, assessment) {
      await rows(
        "UPDATE api_activity_assessments SET record=? WHERE id=? AND lease=? RETURNING id",
        [JSON.stringify(assessment), key, lease],
      );
    },
    async deleteKey(key) {
      for (const table of [
        "api_activity_buckets",
        "api_activity_assessments",
      ]) {
        const result = await db
          .prepare(`DELETE FROM ${table} WHERE owner=?`)
          .bind(key)
          .run();
        if (!result.success) throw new Error("D1 activity erasure failed");
      }
    },
    async cleanup(now, limit) {
      const size = Math.min(1000, Math.max(1, Math.floor(limit)));
      await rows(
        "DELETE FROM api_activity_buckets WHERE (owner,window_start,route) IN (SELECT owner,window_start,route FROM api_activity_buckets WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) AND expires_at <= ? RETURNING owner",
        [now, size, now],
      );
      await rows(
        "DELETE FROM api_activity_assessments WHERE id IN (SELECT id FROM api_activity_assessments WHERE next_at <= ? ORDER BY next_at LIMIT ?) AND next_at <= ? RETURNING id",
        [now, size, now],
      );
    },
  };
}
