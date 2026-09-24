import type {
  BrowserAssociation,
  ContextStorage,
} from "@aarondovturkel/doorman-core";
import type { PostgresDatabase } from "./index.js";
export function createPostgresContextStorage(
  db: PostgresDatabase,
): ContextStorage {
  return {
    async remember(a) {
      await db.query(
        "INSERT INTO browser_associations (id,scope,visitor_id,subject_id,actor_id,seen_at,expires_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (id) DO UPDATE SET seen_at=EXCLUDED.seen_at,expires_at=EXCLUDED.expires_at,record=EXCLUDED.record WHERE browser_associations.seen_at <= EXCLUDED.seen_at",
        [
          a.id,
          a.scope,
          a.visitorId,
          a.subjectId,
          a.actorId,
          a.seenAt,
          a.expiresAt,
          JSON.stringify(a),
        ],
      );
    },
    async recall(scope, visitor, now, limit) {
      return (
        await db.query(
          "SELECT record FROM browser_associations WHERE scope=$1 AND visitor_id=$2 AND expires_at > $3 ORDER BY expires_at DESC,id LIMIT $4",
          [scope, visitor, now, Math.min(limit, 11)],
        )
      ).rows.map(
        (r) =>
          (typeof r.record === "string"
            ? JSON.parse(r.record)
            : r.record) as BrowserAssociation,
      );
    },
    async forget(scope, subject) {
      await db.query(
        "DELETE FROM browser_associations WHERE scope=$1 AND subject_id=$2",
        [scope, subject],
      );
    },
    async cleanupContext(scope, now) {
      await db.query(
        "DELETE FROM browser_associations WHERE id IN (SELECT id FROM browser_associations WHERE scope=$1 AND expires_at <= $2 ORDER BY expires_at LIMIT 1000)",
        [scope, now],
      );
    },
  };
}
