import type { EvaluationControl, ProtectionStorage } from "@janitor/core";
import type { PostgresDatabase } from "./index.js";

export function createPostgresProtectionStorage(
  db: PostgresDatabase,
): ProtectionStorage {
  return {
    async consumeQuota(id, limit, windowMs, now) {
      const { rows } = await db.query(
        `INSERT INTO protection_quotas AS q (id,used,reset_at) VALUES ($1,1,$2)
        ON CONFLICT (id) DO UPDATE SET used = CASE WHEN q.reset_at <= $3 THEN 1 ELSE q.used + 1 END,
        reset_at = CASE WHEN q.reset_at <= $3 THEN $2 ELSE q.reset_at END
        WHERE q.reset_at <= $3 OR q.used < $4 RETURNING id`,
        [id, now + windowMs, now, limit],
      );
      return rows.length === 1;
    },
    async getControl(id) {
      const row = (
        await db.query("SELECT record FROM evaluation_controls WHERE id = $1", [
          id,
        ])
      ).rows[0];
      return row
        ? ((typeof row.record === "string"
            ? JSON.parse(row.record)
            : row.record) as EvaluationControl)
        : undefined;
    },
    async compareControl(id, expectedVersion, next, expiresAt) {
      const { rows } =
        expectedVersion === 0
          ? await db.query(
              "INSERT INTO evaluation_controls (id,version,expires_at,record) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id",
              [id, next.version, expiresAt, JSON.stringify(next)],
            )
          : await db.query(
              "UPDATE evaluation_controls SET version = $2, expires_at = $3, record = $4::jsonb WHERE id = $1 AND version = $5 RETURNING id",
              [
                id,
                next.version,
                expiresAt,
                JSON.stringify(next),
                expectedVersion,
              ],
            );
      return rows.length === 1;
    },
    async cleanupProtection(now, limit) {
      for (const [table, field] of [
        ["protection_quotas", "reset_at"],
        ["evaluation_controls", "expires_at"],
      ])
        await db.query(
          `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${field} <= $1 ORDER BY ${field} LIMIT $2) AND ${field} <= $1`,
          [now, Math.min(1000, Math.max(1, Math.floor(limit)))],
        );
    },
  };
}
