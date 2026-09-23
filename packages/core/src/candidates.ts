import { MATCHING_DEFAULTS } from "./engine.js";
import { calculateSimilarity, hasContradiction } from "./similarity.js";
import type { NormalizedObservation, VisitorCandidate } from "./types.js";

// Six index probes at most. The extra row detects a truncated bucket.
export const LOOKUP_LIMITS = { rowsPerProbe: 100, candidates: 10 } as const;
export type LookupRow = {
  visitorId: string;
  seenAt: number;
  probe: number;
  observation: NormalizedObservation;
};

/** Rank a bounded retrieval pool before loading histories or invoking an evaluator. */
export function rankLookupRows(
  rows: LookupRow[],
  current: NormalizedObservation,
  limit: number,
): VisitorCandidate[] {
  const counts = new Map<number, number>();
  for (const row of rows)
    counts.set(row.probe, (counts.get(row.probe) ?? 0) + 1);
  const candidates = new Map<string, VisitorCandidate & { score: number }>();
  for (const row of rows) {
    if (hasContradiction(row.observation, current)) continue;
    const score = calculateSimilarity(row.observation, current).score;
    if (score < MATCHING_DEFAULTS.candidateFloor) continue;
    const saturated = counts.get(row.probe)! > LOOKUP_LIMITS.rowsPerProbe;
    const previous = candidates.get(row.visitorId);
    candidates.set(row.visitorId, {
      visitorId: row.visitorId,
      lastSeenAt: Math.max(previous?.lastSeenAt ?? 0, row.seenAt),
      score: Math.max(previous?.score ?? 0, score),
      // Require at least one complete retrieval bucket containing this visitor.
      lookupSaturated: saturated && (previous?.lookupSaturated ?? true),
    });
  }
  return [...candidates.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.lastSeenAt - a.lastSeenAt ||
        a.visitorId.localeCompare(b.visitorId),
    )
    .slice(0, limit)
    .map(({ visitorId, lastSeenAt, lookupSaturated }) => ({
      visitorId,
      lastSeenAt,
      lookupSaturated,
    }));
}
