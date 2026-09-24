import type {
  BrowserAssociation,
  ContextStorage,
} from "@aarondovturkel/doorman-core";
import type { D1Database } from "./index.js";
export function createD1ContextStorage(db: D1Database): ContextStorage {
  const check = <T extends { success: boolean }>(result: T): T => {
    if (!result.success) throw new Error("D1 operation failed");
    return result;
  };
  return {
    async remember(a) {
      check(
        await db
          .prepare(
            "INSERT INTO browser_associations (id,scope,visitor_id,subject_id,actor_id,seen_at,expires_at,record) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET seen_at=excluded.seen_at,expires_at=excluded.expires_at,record=excluded.record WHERE browser_associations.seen_at <= excluded.seen_at",
          )
          .bind(
            a.id,
            a.scope,
            a.visitorId,
            a.subjectId,
            a.actorId,
            a.seenAt,
            a.expiresAt,
            JSON.stringify(a),
          )
          .run(),
      );
    },
    async recall(scope, visitor, now, limit) {
      return check(
        await db
          .prepare(
            "SELECT record FROM browser_associations WHERE scope=? AND visitor_id=? AND expires_at > ? ORDER BY expires_at DESC,id LIMIT ?",
          )
          .bind(scope, visitor, now, Math.min(limit, 11))
          .all<{ record: string }>(),
      ).results.map((r) => JSON.parse(r.record) as BrowserAssociation);
    },
    async forget(scope, subject) {
      check(
        await db
          .prepare(
            "DELETE FROM browser_associations WHERE scope=? AND subject_id=?",
          )
          .bind(scope, subject)
          .run(),
      );
    },
    async cleanupContext(scope, now) {
      check(
        await db
          .prepare(
            "DELETE FROM browser_associations WHERE id IN (SELECT id FROM browser_associations WHERE scope=? AND expires_at <= ? ORDER BY expires_at LIMIT 1000)",
          )
          .bind(scope, now)
          .run(),
      );
    },
  };
}
