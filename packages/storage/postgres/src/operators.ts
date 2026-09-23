import type { OperatorStorage, OperatorWindow } from "@janitor/core";
import { OPERATOR_LIMITS } from "@janitor/core";
import type { PostgresDatabase } from "./index.js";
const decode = (row: Record<string, unknown>) =>
  (typeof row.record === "string"
    ? JSON.parse(row.record)
    : row.record) as OperatorWindow;
export function createPostgresOperatorStorage(
  db: PostgresDatabase,
): OperatorStorage {
  async function erase(
    account: string,
    field: "browser_key" | "session_key",
    value: string,
  ) {
    // Remove references in retained records, and invalidate pending completions before they can restore old links.
    await db.query(
      `WITH cleared AS (
      UPDATE operator_windows SET lease=$3,
        status=CASE WHEN status='pending' THEN 'unavailable' ELSE status END,
        record=jsonb_set(jsonb_set(
          CASE WHEN record ? 'evaluation' THEN jsonb_set(record,'{evaluation,links}','[]'::jsonb) ELSE record END,
          '{lease}',to_jsonb($3::text)), '{status}', to_jsonb(CASE WHEN status='pending' THEN 'unavailable' ELSE status END))
      WHERE account_key=$1 AND ${field} IS DISTINCT FROM $2
    ) DELETE FROM operator_windows WHERE account_key=$1 AND ${field}=$2`,
      [account, value, crypto.randomUUID()],
    );
  }
  return {
    async get(account, id) {
      const row = (
        await db.query(
          "SELECT record FROM operator_windows WHERE account_key=$1 AND id=$2",
          [account, id],
        )
      ).rows[0];
      return row ? decode(row) : undefined;
    },
    async claim(w) {
      const result = await db.query(
        "INSERT INTO operator_windows (account_key,id,browser_key,session_key,started_at,ended_at,expires_at,status,lease,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (account_key,id) DO NOTHING RETURNING id",
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
      );
      return result.rows.length === 1;
    },
    async finish(w) {
      return (
        (
          await db.query(
            "UPDATE operator_windows SET status=$3,record=$4::jsonb WHERE account_key=$1 AND id=$2 AND status='pending' AND lease=$5 RETURNING id",
            [w.accountKey, w.id, w.status, JSON.stringify(w), w.lease],
          )
        ).rows.length === 1
      );
    },
    async recent(account, since, until, limit) {
      return (
        await db.query(
          "SELECT record FROM operator_windows WHERE account_key=$1 AND started_at >= $2 AND ended_at <= $3 AND started_at < $3 ORDER BY started_at DESC,id LIMIT $4",
          [
            account,
            since,
            until,
            Math.min(
              OPERATOR_LIMITS.summaryWindows + 1,
              Math.max(1, Math.floor(limit)),
            ),
          ],
        )
      ).rows.map(decode);
    },
    async deleteAccount(account) {
      await db.query("DELETE FROM operator_windows WHERE account_key=$1", [
        account,
      ]);
    },
    deleteBrowser: (account, browser) => erase(account, "browser_key", browser),
    deleteSession: (account, session) => erase(account, "session_key", session),
    async cleanup(now, limit) {
      await db.query(
        "DELETE FROM operator_windows WHERE (account_key,id) IN (SELECT account_key,id FROM operator_windows WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2) AND expires_at <= $1",
        [now, Math.min(1000, Math.max(1, Math.floor(limit)))],
      );
    },
  };
}
