import type {
  Delegation,
  IdentityKey,
  IdentityStorage,
  IdentitySubject,
} from "@janitor/core";
import type { PostgresDatabase } from "./index.js";
export function createPostgresIdentityStorage(
  db: PostgresDatabase,
): IdentityStorage {
  async function get<T>(
    table: string,
    field: string,
    value: string,
  ): Promise<T | undefined> {
    const row = (
      await db.query(`SELECT record FROM ${table} WHERE ${field} = $1`, [value])
    ).rows[0];
    return row
      ? ((typeof row.record === "string"
          ? JSON.parse(row.record)
          : row.record) as T)
      : undefined;
  }
  return {
    async putSubject(subject) {
      const result = await db.query(
        "INSERT INTO identity_subjects (id, kind, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record WHERE identity_subjects.kind = EXCLUDED.kind RETURNING id",
        [subject.id, subject.kind, JSON.stringify(subject)],
      );
      if (!result.rows.length) throw new Error("Subject kind cannot change");
    },
    getSubject: (id) => get<IdentitySubject>("identity_subjects", "id", id),
    async deleteSubject(id) {
      await db.query("DELETE FROM identity_subjects WHERE id = $1", [id]);
    },
    async putKey(key) {
      const result = await db.query(
        "INSERT INTO identity_keys (digest, subject_id, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (digest) DO UPDATE SET record = EXCLUDED.record WHERE identity_keys.subject_id = EXCLUDED.subject_id RETURNING digest",
        [key.digest, key.subjectId, JSON.stringify(key)],
      );
      if (!result.rows.length)
        throw new Error("Identity key already belongs to another subject");
    },
    getKey: (digest) => get<IdentityKey>("identity_keys", "digest", digest),
    async deleteKey(subjectId, digest) {
      await db.query(
        "DELETE FROM identity_keys WHERE subject_id = $1 AND digest = $2",
        [subjectId, digest],
      );
    },
    async putDelegation(grant) {
      await db.query(
        "INSERT INTO identity_delegations (id, principal_id, actor_id, expires_at, record) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [
          grant.id,
          grant.principalId,
          grant.actorId,
          grant.expiresAt,
          JSON.stringify(grant),
        ],
      );
    },
    getDelegation: (id) => get<Delegation>("identity_delegations", "id", id),
    async revokeDelegation(id, now) {
      await db.query(
        "UPDATE identity_delegations SET record = jsonb_set(record, '{revokedAt}', to_jsonb($1::bigint)) WHERE id = $2",
        [now, id],
      );
    },
    async cleanupIdentity(now) {
      await db.query(
        "DELETE FROM identity_delegations WHERE expires_at <= $1",
        [now],
      );
    },
  };
}
