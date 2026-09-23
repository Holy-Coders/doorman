import type {
  Delegation,
  IdentityKey,
  IdentityStorage,
  IdentitySubject,
} from "@aarondovturkel/doorman-core";
import type { D1Database } from "./index.js";
export function createD1IdentityStorage(db: D1Database): IdentityStorage {
  async function run(sql: string, values: unknown[]) {
    const result = await db
      .prepare(sql)
      .bind(...values)
      .run();
    if (!result.success) throw new Error("D1 identity operation failed");
  }
  async function rows(sql: string, values: unknown[]) {
    const result = await db
      .prepare(sql)
      .bind(...values)
      .all<{ record: string }>();
    if (!result.success) throw new Error("D1 identity operation failed");
    return result.results;
  }
  async function get<T>(
    table: string,
    field: string,
    value: string,
  ): Promise<T | undefined> {
    const row = (
      await rows(`SELECT record FROM ${table} WHERE ${field} = ?`, [value])
    )[0];
    return row ? (JSON.parse(row.record) as T) : undefined;
  }
  return {
    async putSubject(subject) {
      const result = await rows(
        "INSERT INTO identity_subjects (id, kind, record) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET record = excluded.record WHERE identity_subjects.kind = excluded.kind RETURNING record",
        [subject.id, subject.kind, JSON.stringify(subject)],
      );
      if (!result.length) throw new Error("Subject kind cannot change");
    },
    getSubject: (id) => get<IdentitySubject>("identity_subjects", "id", id),
    async deleteSubject(id) {
      await run("DELETE FROM identity_subjects WHERE id = ?", [id]);
    },
    async putKey(key) {
      const result = await rows(
        "INSERT INTO identity_keys (digest, subject_id, record) VALUES (?, ?, ?) ON CONFLICT (digest) DO UPDATE SET record = excluded.record WHERE identity_keys.subject_id = excluded.subject_id RETURNING record",
        [key.digest, key.subjectId, JSON.stringify(key)],
      );
      if (!result.length)
        throw new Error("Identity key already belongs to another subject");
    },
    getKey: (digest) => get<IdentityKey>("identity_keys", "digest", digest),
    async deleteKey(subjectId, digest) {
      await run(
        "DELETE FROM identity_keys WHERE subject_id = ? AND digest = ?",
        [subjectId, digest],
      );
    },
    async putDelegation(grant) {
      await run(
        "INSERT INTO identity_delegations (id, principal_id, actor_id, expires_at, record) VALUES (?, ?, ?, ?, ?)",
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
      await run(
        "UPDATE identity_delegations SET record = json_set(record, '$.revokedAt', ?) WHERE id = ?",
        [now, id],
      );
    },
    async cleanupIdentity(now) {
      await run("DELETE FROM identity_delegations WHERE expires_at <= ?", [
        now,
      ]);
    },
  };
}
