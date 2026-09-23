import type { LearningExample, LearningReport } from "./learning.js";
export type EvaluationRow = LearningReport & { deviceId: string };
export type FeedbackExport = {
  version: 1;
  datasetId: string;
  exportedAt: number;
  rows: EvaluationRow[];
  revokedSessionIds: string[];
};
/** Own this manifest wherever data is copied. Row deletion does not untrain an external model. */
export function createFeedbackExport(rows: EvaluationRow[]): FeedbackExport {
  if (rows.length > 10000) throw new Error("Export limit is 10000 rows");
  return {
    version: 1,
    datasetId: crypto.randomUUID(),
    exportedAt: Date.now(),
    rows: structuredClone(rows),
    revokedSessionIds: [],
  };
}
export function revokeFeedback(
  data: FeedbackExport,
  sessionIds: readonly string[],
): FeedbackExport {
  const revoked = new Set([...data.revokedSessionIds, ...sessionIds]);
  return {
    ...data,
    rows: data.rows.filter((row) => !revoked.has(row.sessionId)),
    revokedSessionIds: [...revoked].sort(),
  };
}
/** Chronological replay. Only already-verified examples are visible at each prediction. */
export async function evaluateLearning(
  data: FeedbackExport,
  options: {
    deviceHoldout?: boolean;
    timeoutMs?: number;
    predict: (input: {
      current: EvaluationRow["observation"];
      examples: LearningExample[];
    }) => Promise<{ subjectId?: string; score?: number }>;
  },
) {
  if (data.version !== 1 || data.rows.length > 10000)
    throw new Error("Invalid feedback export");
  const timeout = options.timeoutMs ?? 1200;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 5000)
    throw new Error("Invalid evaluation timeout");
  const rows = revokeFeedback(data, []).rows.sort(
    (a, b) =>
      a.observedAt - b.observedAt || a.sessionId.localeCompare(b.sessionId),
  );
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      !row.sessionId ||
      ids.has(row.sessionId) ||
      !row.subjectId ||
      !row.deviceId ||
      !Number.isSafeInteger(row.observedAt) ||
      !Number.isSafeInteger(row.verifiedAt) ||
      row.verifiedAt < row.observedAt
    )
      throw new Error("Invalid or duplicate verified feedback row");
    ids.add(row.sessionId);
  }
  let correct = 0,
    incorrect = 0,
    abstained = 0,
    unavailable = 0,
    known = 0,
    matchedKnown = 0,
    squaredError = 0;
  const latencies: number[] = [];
  const bins = Array.from({ length: 10 }, (_, index) => ({
    from: index / 10,
    to: (index + 1) / 10,
    count: 0,
    scoreSum: 0,
    correct: 0,
  }));
  for (const row of rows) {
    const examples = rows
      .filter(
        (r) =>
          r.sessionId !== row.sessionId &&
          r.verifiedAt < row.observedAt &&
          (!options.deviceHoldout || r.deviceId !== row.deviceId),
      )
      .sort((a, b) => b.verifiedAt - a.verifiedAt)
      .slice(0, 100)
      .map(({ sessionId, subjectId, observation, observedAt, verifiedAt }) => ({
        sessionId,
        subjectId,
        observation,
        observedAt,
        verifiedAt,
      }));
    const hasAccount = examples.some((e) => e.subjectId === row.subjectId);
    if (hasAccount) known++;
    if (!examples.length) {
      abstained++;
      continue;
    }
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const prediction = await Promise.race([
        options.predict({
          current: structuredClone(row.observation),
          examples: structuredClone(examples),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeout);
        }),
      ]);
      if (
        prediction.subjectId === undefined &&
        prediction.score === undefined
      ) {
        abstained++;
        continue;
      }
      if (
        !examples.some((e) => e.subjectId === prediction.subjectId) ||
        typeof prediction.score !== "number" ||
        !Number.isFinite(prediction.score) ||
        prediction.score < 0 ||
        prediction.score > 1
      )
        throw new Error("Invalid prediction");
      const match = prediction.subjectId === row.subjectId;
      if (match) {
        correct++;
        if (hasAccount) matchedKnown++;
      } else incorrect++;
      squaredError += (prediction.score - Number(match)) ** 2;
      const bin = bins[Math.min(9, Math.floor(prediction.score * 10))]!;
      bin.count++;
      bin.scoreSum += prediction.score;
      bin.correct += Number(match);
    } catch {
      unavailable++;
    } finally {
      clearTimeout(timer);
      latencies.push(performance.now() - started);
    }
  }
  const ratio = (n: number, d: number) => (d ? n / d : null);
  const predictions = correct + incorrect;
  latencies.sort((a, b) => a - b);
  return {
    version: 1,
    datasetId: data.datasetId,
    trials: rows.length,
    deviceHoldout: options.deviceHoldout === true,
    correct,
    incorrect,
    abstained,
    unavailable,
    knownAccountTrials: known,
    precision: ratio(correct, predictions),
    falseAssociationRate: ratio(incorrect, rows.length),
    coverage: ratio(predictions, rows.length),
    abstentionRate: ratio(abstained, rows.length),
    recallAmongKnownAccounts: ratio(matchedKnown, known),
    brierOnPredictions: ratio(squaredError, predictions),
    latencyP95Ms: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
    calibration: bins.map((b) => ({
      from: b.from,
      to: b.to,
      count: b.count,
      meanScore: ratio(b.scoreSum, b.count),
      accuracy: ratio(b.correct, b.count),
    })),
  };
}
