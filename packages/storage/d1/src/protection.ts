import type { EvaluationControl, ProtectionStorage } from "@janitor/core";
import type { D1Database } from "./index.js";

export function createD1ProtectionStorage(db: D1Database): ProtectionStorage {
  async function rows(sql: string, args: unknown[]) {
    const result = await db
      .prepare(sql)
      .bind(...args)
      .all<{ record: string; id: string }>();
    if (!result.success) throw new Error("D1 protection operation failed");
    return result.results;
  }
  return {
    async consumeQuota(id, limit, windowMs, now) {
      return (
        (
          await rows(
            `INSERT INTO protection_quotas (id,used,reset_at) VALUES (?,1,?)
        ON CONFLICT (id) DO UPDATE SET used = CASE WHEN reset_at <= ? THEN 1 ELSE used + 1 END,
        reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
        WHERE reset_at <= ? OR used < ? RETURNING id`,
            [id, now + windowMs, now, now, now, limit],
          )
        ).length === 1
      );
    },
    async getControl(id) {
      const row = (
        await rows("SELECT record FROM evaluation_controls WHERE id = ?", [id])
      )[0];
      return row ? (JSON.parse(row.record) as EvaluationControl) : undefined;
    },
    async compareControl(id, expectedVersion, next, expiresAt) {
      const result =
        expectedVersion === 0
          ? await rows(
              "INSERT INTO evaluation_controls (id,version,expires_at,record) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING RETURNING id",
              [id, next.version, expiresAt, JSON.stringify(next)],
            )
          : await rows(
              "UPDATE evaluation_controls SET version = ?, expires_at = ?, record = ? WHERE id = ? AND version = ? RETURNING id",
              [
                next.version,
                expiresAt,
                JSON.stringify(next),
                id,
                expectedVersion,
              ],
            );
      return result.length === 1;
    },
    async cleanupProtection(now, limit) {
      for (const [table, field] of [
        ["protection_quotas", "reset_at"],
        ["evaluation_controls", "expires_at"],
      ])
        await rows(
          `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${field} <= ? ORDER BY ${field} LIMIT ?) AND ${field} <= ? RETURNING id`,
          [now, Math.min(1000, Math.max(1, Math.floor(limit))), now],
        );
    },
  };
}
