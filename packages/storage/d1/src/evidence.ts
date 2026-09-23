import type {
  ApplicationEvent,
  DeviceLink,
  EvidenceStorage,
} from "@janitor/core";
import type { D1Database } from "./index.js";

export function createD1EvidenceStorage(db: D1Database): EvidenceStorage {
  async function rows(sql: string, args: unknown[]) {
    const result = await db
      .prepare(sql)
      .bind(...args)
      .all<{ record: string; digest: string; id: string }>();
    if (!result.success) throw new Error("D1 evidence operation failed");
    return result.results;
  }
  const record = <T>(row?: { record: string }): T | undefined =>
    row ? (JSON.parse(row.record) as T) : undefined;
  return {
    async putEvent(e) {
      const result = await rows(
        "INSERT INTO application_events (id,scope,digest,subject_id,session_id,actor_id,visitor_id,action,occurred_at,expires_at,record) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING RETURNING id",
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
      if (result.length) return true;
      const existing = (
        await rows(
          "SELECT digest FROM application_events WHERE id=? AND scope=?",
          [e.id, e.scope],
        )
      )[0];
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
      const values: unknown[] = [q.scope, q.id, q.since, q.until, q.until];
      if (q.action) values.push(q.action);
      values.push(Math.min(q.limit, 1001));
      return (
        await rows(
          `SELECT record FROM application_events WHERE scope=? AND ${field}=? AND occurred_at >= ? AND occurred_at <= ? AND expires_at > ? ${q.action ? "AND action=?" : ""} ORDER BY occurred_at DESC,id DESC LIMIT ?`,
          values,
        )
      ).map((r) => record<ApplicationEvent>(r)!);
    },
    async putDeviceLink(link) {
      const result = await rows(
        "INSERT INTO device_links (id,scope,digest,subject_id,visitor_id,created_at,retire_at,record) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING RETURNING record",
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
      );
      if (result[0]) return record<DeviceLink>(result[0])!;
      const existing = record<DeviceLink>(
        (
          await rows("SELECT record FROM device_links WHERE id=? AND scope=?", [
            link.id,
            link.scope,
          ])
        )[0],
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
          await rows("SELECT record FROM device_links WHERE id=? AND scope=?", [
            id,
            scope,
          ])
        )[0],
      );
    },
    async listDeviceLinks(scope, id, limit) {
      return (
        await rows(
          "SELECT record FROM device_links WHERE scope=? AND subject_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
          [scope, id, Math.min(limit, 100)],
        )
      ).map((r) => record<DeviceLink>(r)!);
    },
    async revokeDeviceLink(scope, id, revocation) {
      await rows(
        "UPDATE device_links SET record=json_set(record,'$.revocation',json(?)),retire_at=MIN(retire_at,?) WHERE id=? AND scope=? AND json_extract(record,'$.revocation') IS NULL RETURNING id",
        [JSON.stringify(revocation), revocation.revokedAt, id, scope],
      );
    },
    async deleteEvents(scope, kind, id) {
      await rows(
        `DELETE FROM application_events WHERE scope=? AND (${kind === "subject" ? "subject_id=? OR actor_id=?" : "session_id=?"}) RETURNING id`,
        kind === "subject" ? [scope, id, id] : [scope, id],
      );
    },
    async cleanupEvidence(scope, now, cutoff, limit) {
      await rows(
        "DELETE FROM application_events WHERE id IN (SELECT id FROM application_events WHERE scope=? AND expires_at <= ? ORDER BY expires_at LIMIT ?) RETURNING id",
        [scope, now, Math.min(limit, 1000)],
      );
      await rows(
        "DELETE FROM device_links WHERE id IN (SELECT id FROM device_links WHERE scope=? AND retire_at <= ? ORDER BY retire_at LIMIT ?) RETURNING id",
        [scope, cutoff, Math.min(limit, 1000)],
      );
    },
  };
}
