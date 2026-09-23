import type {
  ApplicationEvent,
  DeviceLink,
  EvidenceStorage,
} from "@janitor/core";
import type { PostgresDatabase } from "./index.js";

export function createPostgresEvidenceStorage(
  db: PostgresDatabase,
): EvidenceStorage {
  const record = <T>(row?: Record<string, unknown>): T | undefined =>
    row
      ? ((typeof row.record === "string"
          ? JSON.parse(row.record)
          : row.record) as T)
      : undefined;
  return {
    async putEvent(e) {
      const result = await db.query(
        "INSERT INTO application_events (id,scope,digest,subject_id,session_id,actor_id,visitor_id,action,occurred_at,expires_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id",
        [
          e.id,
          e.scope,
          e.digest,
          e.subjectId ?? null,
          e.sessionId ?? null,
          e.actorId ?? null,
          e.visitorId ?? null,
          e.action ?? null,
          e.occurredAt,
          e.expiresAt,
          JSON.stringify(e),
        ],
      );
      if (result.rows.length) return true;
      const existing = (
        await db.query(
          "SELECT digest FROM application_events WHERE id=$1 AND scope=$2",
          [e.id, e.scope],
        )
      ).rows[0];
      if (existing?.digest !== e.digest)
        throw new Error("Event idempotency conflict");
      return false;
    },
    async recentEvents(q) {
      const field = {
        subject: "subject_id",
        session: "session_id",
        actor: "actor_id",
      }[q.kind];
      const values: unknown[] = [
        q.scope,
        q.id,
        q.since,
        q.until,
        Math.min(q.limit, 1001),
      ];
      if (q.action) values.push(q.action);
      return (
        await db.query(
          `SELECT record FROM application_events WHERE scope=$1 AND ${field}=$2 AND occurred_at >= $3 AND occurred_at <= $4 AND expires_at > $4 ${q.action ? "AND action=$6" : ""} ORDER BY occurred_at DESC,id DESC LIMIT $5`,
          values,
        )
      ).rows.map((r) => record<ApplicationEvent>(r)!);
    },
    async putDeviceLink(link) {
      const rows = (
        await db.query(
          "INSERT INTO device_links (id,scope,digest,subject_id,visitor_id,created_at,retire_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (id) DO NOTHING RETURNING record",
          [
            link.id,
            link.scope,
            link.digest,
            link.subjectId,
            link.visitorId,
            link.createdAt,
            link.expiresAt,
            JSON.stringify(link),
          ],
        )
      ).rows;
      if (rows[0]) return record<DeviceLink>(rows[0])!;
      const existing = record<DeviceLink>(
        (
          await db.query(
            "SELECT record FROM device_links WHERE id=$1 AND scope=$2",
            [link.id, link.scope],
          )
        ).rows[0],
      );
      if (!existing || existing.digest !== link.digest)
        throw new Error(
          "Device verification already used for another association",
        );
      return existing;
    },
    async getDeviceLink(scope, id) {
      return record<DeviceLink>(
        (
          await db.query(
            "SELECT record FROM device_links WHERE id=$1 AND scope=$2",
            [id, scope],
          )
        ).rows[0],
      );
    },
    async listDeviceLinks(scope, id, limit) {
      return (
        await db.query(
          "SELECT record FROM device_links WHERE scope=$1 AND subject_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3",
          [scope, id, Math.min(limit, 100)],
        )
      ).rows.map((r) => record<DeviceLink>(r)!);
    },
    async revokeDeviceLink(scope, id, revocation) {
      await db.query(
        "UPDATE device_links SET record=jsonb_set(record,'{revocation}',$1::jsonb),retire_at=LEAST(retire_at,$2) WHERE id=$3 AND scope=$4 AND NOT (record ? 'revocation')",
        [JSON.stringify(revocation), revocation.revokedAt, id, scope],
      );
    },
    async deleteEvents(scope, kind, id) {
      await db.query(
        `DELETE FROM application_events WHERE scope=$1 AND (${kind === "subject" ? "subject_id=$2 OR actor_id=$2" : "session_id=$2"})`,
        [scope, id],
      );
    },
    async cleanupEvidence(scope, now, cutoff, limit) {
      await db.query(
        "DELETE FROM application_events WHERE id IN (SELECT id FROM application_events WHERE scope=$3 AND expires_at <= $1 ORDER BY expires_at LIMIT $2)",
        [now, Math.min(limit, 1000), scope],
      );
      await db.query(
        "DELETE FROM device_links WHERE id IN (SELECT id FROM device_links WHERE scope=$3 AND retire_at <= $1 ORDER BY retire_at LIMIT $2)",
        [cutoff, Math.min(limit, 1000), scope],
      );
    },
  };
}
