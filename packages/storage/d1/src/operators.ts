import type { OperatorStorage, OperatorWindow } from "@janitor/core";
import { OPERATOR_LIMITS } from "@janitor/core";
import type { D1Database } from "./index.js";
export function createD1OperatorStorage(db: D1Database): OperatorStorage {
  async function rows(sql: string, args: unknown[]) {
    const result = await db
      .prepare(sql)
      .bind(...args)
      .all();
    if (!result.success) throw new Error("D1 operator operation failed");
    return result.results;
  }
  const decode = (row: Record<string, unknown>) =>
    JSON.parse(String(row.record)) as OperatorWindow;
  async function erase(
    account: string,
    field: "browser_key" | "session_key",
    value: string,
  ) {
    const lease = crypto.randomUUID();
    const result = await db.batch([
      db
        .prepare(
          `UPDATE operator_windows SET lease=?,
        record=json_set(CASE WHEN json_type(record,'$.evaluation')='object' THEN json_set(record,'$.evaluation.links',json('[]')) ELSE record END,
          '$.lease',?, '$.status', CASE WHEN status='pending' THEN 'unavailable' ELSE status END),
        status=CASE WHEN status='pending' THEN 'unavailable' ELSE status END
        WHERE account_key=? AND ${field} IS NOT ?`,
        )
        .bind(lease, lease, account, value),
      db
        .prepare(
          `DELETE FROM operator_windows WHERE account_key=? AND ${field}=?`,
        )
        .bind(account, value),
    ]);
    if (result.some((r) => !r.success))
      throw new Error("D1 operator erasure failed");
  }
  return {
    async get(account, id) {
      const row = (
        await rows(
          "SELECT record FROM operator_windows WHERE account_key=? AND id=?",
          [account, id],
        )
      )[0];
      return row ? decode(row) : undefined;
    },
    async claim(w) {
      return (
        (
          await rows(
            "INSERT INTO operator_windows (account_key,id,browser_key,session_key,started_at,ended_at,expires_at,status,lease,record) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (account_key,id) DO NOTHING RETURNING id",
            [
              w.accountKey,
              w.id,
              w.browserKey ?? null,
              w.sessionKey,
              w.startedAt,
              w.endedAt,
              w.expiresAt,
              w.status,
              w.lease,
              JSON.stringify(w),
            ],
          )
        ).length === 1
      );
    },
    async finish(w) {
      return (
        (
          await rows(
            "UPDATE operator_windows SET status=?,record=? WHERE account_key=? AND id=? AND status='pending' AND lease=? RETURNING id",
            [w.status, JSON.stringify(w), w.accountKey, w.id, w.lease],
          )
        ).length === 1
      );
    },
    async recent(account, since, until, limit) {
      return (
        await rows(
          "SELECT record FROM operator_windows WHERE account_key=? AND started_at >= ? AND ended_at <= ? AND started_at < ? ORDER BY started_at DESC,id LIMIT ?",
          [
            account,
            since,
            until,
            until,
            Math.min(
              OPERATOR_LIMITS.summaryWindows + 1,
              Math.max(1, Math.floor(limit)),
            ),
          ],
        )
      ).map(decode);
    },
    async deleteAccount(account) {
      await rows(
        "DELETE FROM operator_windows WHERE account_key=? RETURNING id",
        [account],
      );
    },
    deleteBrowser: (account, browser) => erase(account, "browser_key", browser),
    deleteSession: (account, session) => erase(account, "session_key", session),
    async cleanup(now, limit) {
      await rows(
        "DELETE FROM operator_windows WHERE (account_key,id) IN (SELECT account_key,id FROM operator_windows WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) AND expires_at <= ? RETURNING id",
        [now, Math.min(1000, Math.max(1, Math.floor(limit))), now],
      );
    },
  };
}
