import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStorage } from "@aarondovturkel/doorman-storage-postgres";
import { createVisitorEngine } from "@aarondovturkel/doorman-core";
import { MATCHING_DEFAULTS } from "../../../packages/core/src/engine.js";
import type { IdentifyMetrics } from "../../../packages/core/src/engine.js";
import type { BrowserObservation } from "@aarondovturkel/doorman-core";
import { ndjson } from "./io.js";

export type IdentityRow = {
  id: string;
  subject: string;
  at: number;
  order: number;
  signals: BrowserObservation;
};
export async function identityBenchmark(path: string) {
  const rows: IdentityRow[] = [];
  for await (const row of ndjson<IdentityRow>(path)) rows.push(row);
  rows.sort((a, b) => a.at - b.at || a.order - b.order);
  if (!rows.length) throw new Error("Empty identity dataset");
  const db = new PGlite();
  const realNow = Date.now;
  let replayTime = rows[0]!.at;
  const owners = new Map<string, string>();
  const subjects = new Set<string>();
  const stats = {
    observations: rows.length,
    browserLabels: 0,
    firstObservations: 0,
    returningObservations: 0,
    correctRestorations: 0,
    wrongRestorations: 0,
    wrongOnFirstObservation: 0,
    wrongOnReturningObservation: 0,
    newOnFirstObservation: 0,
    newOnReturningObservation: 0,
    lookupSaturated: 0,
    maxCandidateCount: 0,
    maxObservationRowsRead: 0,
  };
  try {
    await db.exec(
      await readFile(
        new URL(
          "../../../packages/storage/postgres/migrations/0001_visitors.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    let rowsRead = 0;
    const storage = createPostgresStorage({
      async query(sql, args) {
        const result = await db.query<Record<string, unknown>>(sql, args);
        if (sql.includes("AS probe")) rowsRead = result.rows.length;
        return result;
      },
    });
    const engine = createVisitorEngine({
      storage,
      onMetrics: (m: IdentifyMetrics) => {
        stats.maxCandidateCount = Math.max(
          stats.maxCandidateCount,
          m.candidateCount,
        );
        if (m.lookupSaturated) stats.lookupSaturated++;
      },
    });
    // Dedicated offline process, sequential operations, restored in finally. Real historical
    // time preserves the production 90-day cutoff without mutating observation timestamps.
    Date.now = () => replayTime;
    for (const row of rows) {
      replayTime = row.at;
      const known = subjects.has(row.subject);
      if (known) stats.returningObservations++;
      else stats.firstObservations++;
      const identity = await engine.identify({ signals: row.signals });
      stats.maxObservationRowsRead = Math.max(
        stats.maxObservationRowsRead,
        rowsRead,
      );
      if (identity.isReturning) {
        if (owners.get(identity.visitorId) === row.subject)
          stats.correctRestorations++;
        else {
          stats.wrongRestorations++;
          if (known) stats.wrongOnReturningObservation++;
          else stats.wrongOnFirstObservation++;
        }
      } else {
        owners.set(identity.visitorId, row.subject);
        if (known) stats.newOnReturningObservation++;
        else stats.newOnFirstObservation++;
      }
      subjects.add(row.subject);
    }
    stats.browserLabels = subjects.size;
    return {
      source: "FP-Stalker",
      kind: "chronological-cookie-loss",
      evaluator: "disabled",
      storage: "production Postgres adapter on PGlite",
      defaults: MATCHING_DEFAULTS,
      observationRetentionDays: 90,
      maxObservationsPerVisitor: 10,
      from: new Date(rows[0]!.at).toISOString(),
      to: new Date(rows.at(-1)!.at).toISOString(),
      ...stats,
      restorePrecision:
        stats.correctRestorations /
        Math.max(1, stats.correctRestorations + stats.wrongRestorations),
      returningRecovery:
        stats.correctRestorations / Math.max(1, stats.returningObservations),
      distinctAssignedIds: owners.size,
      limitations: [
        "Every visit loses its cookie: a stress scenario, not normal traffic.",
        "Ground truth is the publisher's browser label, not person or verified device ownership.",
        "Online predictions update history; mistakes can propagate. Labels never repair engine state.",
        "No native language array, IANA timezone, hardware, viewport or WebDriver data in this projection.",
        "Historical selected sample; not a current browser population or cross-device benchmark.",
      ],
    };
  } finally {
    Date.now = realNow;
    await db.close();
  }
}
