import type {
  LearningStorage,
  LearningSession,
  LearningReport,
  LearningExample,
} from "@janitor/core";
import type { D1Database } from "./index.js";
function decode(row: Record<string, unknown>): LearningSession {
  return {
    id: String(row.id),
    scope: String(row.scope),
    startedAt: Number(row.started_at),
    expiresAt: Number(row.expires_at),
    observedAt: Number(row.observed_at),
    observation:
      typeof row.signals_json === "string"
        ? JSON.parse(row.signals_json)
        : row.signals_json,
    subjectId: row.subject_id == null ? undefined : String(row.subject_id),
    disputed: Number(row.disputed) === 1,
    prediction: {
      status: row.prediction_status as LearningSession["prediction"]["status"],
      ...(row.predicted_subject_id == null
        ? {}
        : { subjectId: String(row.predicted_subject_id) }),
      ...(row.prediction_score == null
        ? {}
        : { score: Number(row.prediction_score) }),
    },
  };
}
export function createD1LearningStorage(db: D1Database): LearningStorage {
  const rows = async (sql: string, values: unknown[]) => {
    const result = await db
      .prepare(sql)
      .bind(...values)
      .all();
    if (!result.success) throw new Error("D1 learning operation failed");
    return result.results;
  };
  const values = (s: LearningSession) => [
    s.scope,
    s.id,
    s.startedAt,
    s.expiresAt,
    s.observedAt,
    JSON.stringify(s.observation),
    s.prediction.status,
    s.prediction.subjectId ?? null,
    s.prediction.score ?? null,
  ];
  return {
    async findExamples(scope, current, cutoff) {
      const predicates: [string, string][] = [];
      if (current.languages?.[0])
        predicates.push([
          "json_extract(signals_json, '$.languages[0]')",
          current.languages[0],
        ]);
      if (current.timezone)
        predicates.push([
          "json_extract(signals_json, '$.timezone')",
          current.timezone,
        ]);
      const groups = await Promise.all(
        predicates.map(([column, value]) =>
          rows(
            `SELECT * FROM learning_sessions WHERE scope = ?1 AND ${column} = ?2 AND verified_at >= ?3 AND observed_at >= ?3 AND subject_id IS NOT NULL AND disputed = 0 ORDER BY verified_at DESC, id DESC LIMIT 101`,
            [scope, value, cutoff],
          ),
        ),
      );
      const unique = new Map<string, LearningExample>();
      for (const row of groups.flat()) {
        const session = decode(row);
        unique.set(session.id, {
          sessionId: session.id,
          subjectId: session.subjectId!,
          observation: session.observation,
          observedAt: session.observedAt,
          verifiedAt: Number(row.verified_at),
        });
      }
      return {
        examples: [...unique.values()]
          .sort(
            (a, b) =>
              b.verifiedAt - a.verifiedAt ||
              a.sessionId.localeCompare(b.sessionId),
          )
          .slice(0, 100),
        saturated:
          groups.some((group) => group.length > 100) || unique.size > 100,
      };
    },
    async insertSession(s) {
      await rows(
        "INSERT INTO learning_sessions (scope, id, started_at, expires_at, observed_at, signals_json, prediction_status, predicted_subject_id, prediction_score) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        values(s),
      );
    },
    async getSession(scope, id) {
      const row = (
        await rows(
          "SELECT * FROM learning_sessions WHERE scope = ?1 AND id = ?2",
          [scope, id],
        )
      )[0];
      return row ? decode(row) : undefined;
    },
    async updateSession(s, now) {
      await rows(
        "UPDATE learning_sessions SET observed_at = ?5, signals_json = ?6, prediction_status = ?7, predicted_subject_id = ?8, prediction_score = ?9 WHERE scope = ?1 AND id = ?2 AND started_at = ?3 AND expires_at = ?4 AND expires_at > ?10 AND subject_id IS NULL AND disputed = 0",
        [...values(s), now],
      );
    },
    async confirmSession(scope, id, subjectId, now) {
      await rows(
        "UPDATE learning_sessions SET disputed = CASE WHEN subject_id IS NOT NULL AND subject_id <> ?3 THEN 1 ELSE disputed END, subject_id = CASE WHEN subject_id IS NULL AND disputed = 0 THEN ?3 ELSE subject_id END, verified_at = COALESCE(verified_at, ?4) WHERE scope = ?1 AND id = ?2 AND expires_at > ?4",
        [scope, id, subjectId, now],
      );
      await rows(
        "DELETE FROM learning_sessions WHERE scope = ?1 AND subject_id = ?2 AND id IN (SELECT id FROM learning_sessions WHERE scope = ?1 AND subject_id = ?2 ORDER BY verified_at DESC, id DESC LIMIT -1 OFFSET 20)",
        [scope, subjectId],
      );
    },
    async deleteSession(scope, id) {
      await rows("DELETE FROM learning_sessions WHERE scope = ?1 AND id = ?2", [
        scope,
        id,
      ]);
    },
    async reports(scope, cutoff, limit) {
      const result = await rows(
        "SELECT * FROM learning_sessions WHERE scope = ?1 AND verified_at >= ?2 AND observed_at >= ?2 AND subject_id IS NOT NULL AND disputed = 0 ORDER BY verified_at DESC, id DESC LIMIT ?3",
        [scope, cutoff, Math.max(1, Math.min(100, limit))],
      );
      return result.map((row) => {
        const session = decode(row);
        return {
          sessionId: session.id,
          subjectId: session.subjectId!,
          observation: session.observation,
          observedAt: session.observedAt,
          verifiedAt: Number(row.verified_at),
          prediction: session.prediction,
        } as LearningReport;
      });
    },
    async cleanupLearning(scope, now, cutoff) {
      await rows(
        "DELETE FROM learning_sessions WHERE scope = ?1 AND (observed_at < ?3 OR disputed = 1 OR (subject_id IS NULL AND expires_at <= ?2))",
        [scope, now, cutoff],
      );
      await rows(
        "DELETE FROM learning_sessions WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY verified_at DESC, id DESC) AS position FROM learning_sessions WHERE scope = ?1 AND subject_id IS NOT NULL) AS ranked WHERE position > 20)",
        [scope],
      );
    },
  };
}
