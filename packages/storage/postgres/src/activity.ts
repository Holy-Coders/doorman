import { API_ACTIVITY_LIMITS } from "@janitor/core";
import type {
  ApiActivityAssessment,
  ApiActivityBucket,
  ApiActivityStorage,
} from "@janitor/core";
import type { PostgresDatabase } from "./index.js";

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
export function createPostgresActivityStorage(
  db: PostgresDatabase,
): ApiActivityStorage {
  const cap = API_ACTIVITY_LIMITS.maxCount;
  return {
    async increment(i) {
      const { rows } = await db.query(
        `INSERT INTO api_activity_buckets AS b
        (owner,window_start,route,requests,denied,client_errors,server_errors,duration_total_ms,duration_max_ms,first_seen_at,last_seen_at,short_gaps,expires_at)
        VALUES ($1,$2,$3,1,$4,$5,$6,$7,$7,$8,$8,0,$9)
        ON CONFLICT (owner,window_start,route) DO UPDATE SET
        requests = LEAST(b.requests+1,${cap}), denied = LEAST(b.denied+EXCLUDED.denied,${cap}),
        client_errors = LEAST(b.client_errors+EXCLUDED.client_errors,${cap}), server_errors = LEAST(b.server_errors+EXCLUDED.server_errors,${cap}),
        duration_total_ms = LEAST(b.duration_total_ms+EXCLUDED.duration_total_ms,${cap * API_ACTIVITY_LIMITS.maxDurationMs}),
        duration_max_ms = GREATEST(b.duration_max_ms,EXCLUDED.duration_max_ms),
        short_gaps = LEAST(b.short_gaps + CASE WHEN EXCLUDED.last_seen_at >= b.last_seen_at AND EXCLUDED.last_seen_at-b.last_seen_at < ${API_ACTIVITY_LIMITS.shortGapMs} THEN 1 ELSE 0 END,${cap}),
        first_seen_at = LEAST(b.first_seen_at,EXCLUDED.first_seen_at), last_seen_at = GREATEST(b.last_seen_at,EXCLUDED.last_seen_at),
        expires_at = GREATEST(b.expires_at,EXCLUDED.expires_at) RETURNING *`,
        [
          i.key,
          i.windowStart,
          i.route,
          Number(i.status === 401 || i.status === 403),
          Number(i.status >= 400 && i.status < 500),
          Number(i.status >= 500),
          i.durationMs,
          i.now,
          i.expiresAt,
        ],
      );
      return bucket(rows[0]!);
    },
    async recent(key, since, until) {
      const { rows } = await db.query(
        "SELECT * FROM api_activity_buckets WHERE owner=$1 AND window_start >= $2 AND window_start <= $3 ORDER BY window_start DESC,route LIMIT $4",
        [key, since, until, API_ACTIVITY_LIMITS.rows + 1],
      );
      return rows.map(bucket);
    },
    async claim(key, owner, lease, now, nextAt) {
      const { rows } = await db.query(
        `INSERT INTO api_activity_assessments AS a (id,owner,lease,next_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET lease=EXCLUDED.lease,next_at=EXCLUDED.next_at,record=NULL WHERE a.next_at <= $5 RETURNING id`,
        [key, owner, lease, nextAt, now],
      );
      return rows.length === 1;
    },
    async cached(key, now) {
      const row = (
        await db.query(
          "SELECT record FROM api_activity_assessments WHERE id=$1 AND next_at>$2",
          [key, now],
        )
      ).rows[0];
      const value = row?.record;
      const result = (typeof value === "string" ? JSON.parse(value) : value) as
        ApiActivityAssessment | undefined;
      return result && result.expiresAt > now ? result : undefined;
    },
    async save(key, lease, assessment) {
      await db.query(
        "UPDATE api_activity_assessments SET record=$3::jsonb WHERE id=$1 AND lease=$2",
        [key, lease, JSON.stringify(assessment)],
      );
    },
    async deleteKey(key) {
      await db.query("DELETE FROM api_activity_buckets WHERE owner=$1", [key]);
      await db.query("DELETE FROM api_activity_assessments WHERE owner=$1", [
        key,
      ]);
    },
    async cleanup(now, limit) {
      const size = Math.min(1000, Math.max(1, Math.floor(limit)));
      await db.query(
        "DELETE FROM api_activity_buckets WHERE (owner,window_start,route) IN (SELECT owner,window_start,route FROM api_activity_buckets WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2) AND expires_at <= $1",
        [now, size],
      );
      await db.query(
        "DELETE FROM api_activity_assessments WHERE id IN (SELECT id FROM api_activity_assessments WHERE next_at <= $1 ORDER BY next_at LIMIT $2) AND next_at <= $1",
        [now, size],
      );
    },
  };
}
