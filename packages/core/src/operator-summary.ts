import {
  agentFamily,
  operatorLabel,
  OPERATOR_LIMITS,
  resolveOperatorThresholds,
  operatorPolicy,
} from "./operators.js";
import type {
  OperatorKind,
  OperatorWindow,
  OperatorThresholds,
} from "./operators.js";

export type OperatorProfile = {
  /** Report-local inference ID. Never use as an authenticated or analytics distinct ID. */
  id: string;
  kind: OperatorKind;
  windowIds: string[];
  browserCount: number;
  labelScore: number;
  family?: { family: string; score: number };
};
export type OperatorSummary = {
  schemaVersion: 1;
  resolutionVersion: "complete-link-v1";
  scoreKind: "uncalibrated";
  scoringPolicy: string;
  thresholds: Readonly<OperatorThresholds>;
  window: { since: number; until: number };
  complete: boolean;
  observedWindows: number;
  observedBrowserIds: number;
  evaluatedWindows: number;
  unresolvedWindows: number;
  comparedPairs: number;
  possiblePairs: number;
  modelVersions: string[];
  profiles: OperatorProfile[];
  estimates: Record<
    OperatorKind,
    {
      /** Null for truncated, unresolved or incompletely compared reports. Never verified physical operators. */
      likely: number | null;
      profiles: number;
      uncomparedPairs: number;
      thresholdSensitivity: { min: number; max: number } | null;
    }
  >;
};

/** Bounded, deterministic, reversible clustering. Every pair in a merged profile needs positive evidence.
 * Unknown pairs never acquire a positive link by transitivity. No cookie, login, family or abuse score
 * is sufficient to join operators. Threshold sensitivity is not a statistical confidence interval.
 */
export function summarizeOperators(
  input: readonly OperatorWindow[],
  range: { since: number; until: number },
  options?: Partial<OperatorThresholds>,
): OperatorSummary {
  const thresholds = resolveOperatorThresholds(options);
  if (
    !Number.isSafeInteger(range.since) ||
    !Number.isSafeInteger(range.until) ||
    range.since >= range.until
  )
    throw new Error("Invalid operator summary range");
  if (input.length > OPERATOR_LIMITS.summaryWindows + 1)
    throw new Error("Operator summary input exceeds limit");
  const accounts = new Set(input.map((w) => w.accountKey));
  if (
    accounts.size > 1 ||
    new Set(input.map((w) => w.id)).size !== input.length
  )
    throw new Error(
      "Operator summary must contain unique windows from one account",
    );
  // Half-open, fully contained windows. The caller also enforces retention at read time.
  const all = input
    .filter(
      (w) =>
        w.startedAt >= range.since &&
        w.endedAt <= range.until &&
        w.startedAt < range.until,
    )
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const complete = all.length <= OPERATOR_LIMITS.summaryWindows;
  const windows = all.slice(-OPERATOR_LIMITS.summaryWindows);
  const byId = new Map(windows.map((w) => [w.id, w]));
  const pair = (a: string, b: string) => JSON.stringify([a, b].sort());
  const edges = new Map<string, number>();
  for (const w of windows)
    if (w.status === "evaluated") {
      for (const link of w.evaluation?.links ?? []) {
        if (!byId.has(link.windowId) || link.windowId === w.id) continue;
        const key = pair(w.id, link.windowId);
        // Conflicting judgments retain the weaker evidence.
        edges.set(key, Math.min(edges.get(key) ?? 1, link.score));
      }
    }
  const labeled = windows.filter(
    (w) =>
      w.status === "evaluated" &&
      operatorLabel(w.evaluation, thresholds) !== "unknown",
  );
  const n = labeled.length;
  const kinds = labeled.map((w) => operatorLabel(w.evaluation, thresholds));
  const distances = new Float64Array(n * n).fill(-1);
  const missingByKind: Record<OperatorKind, number> = {
    human: 0,
    assistant: 0,
    automation: 0,
  };
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      if (kinds[a] !== kinds[b]) continue;
      const score = edges.get(pair(labeled[a]!.id, labeled[b]!.id));
      if (score === undefined) missingByKind[kinds[a] as OperatorKind]++;
      else distances[a * n + b] = distances[b * n + a] = score;
    }
  function clusters(threshold: number): OperatorWindow[][] {
    const groups = labeled.map((w) => [w]);
    const scores = distances.slice(),
      active = new Uint8Array(n).fill(1);
    // Complete-link update: merged similarity to each remaining group is the smaller of the two.
    // This avoids repeatedly walking every pair of windows inside candidate groups.
    for (;;) {
      let left = -1,
        right = -1,
        best = threshold;
      for (let a = 0; a < n; a++)
        if (active[a])
          for (let b = a + 1; b < n; b++)
            if (active[b]) {
              const score = scores[a * n + b]!;
              if (score >= threshold && (left < 0 || score > best)) {
                left = a;
                right = b;
                best = score;
              }
            }
      if (left < 0) break;
      groups[left]!.push(...groups[right]!);
      active[right] = 0;
      for (let k = 0; k < n; k++)
        if (active[k] && k !== left) {
          scores[left * n + k] = scores[k * n + left] = Math.min(
            scores[left * n + k]!,
            scores[right * n + k]!,
          );
        }
    }
    return groups.filter((_, i) => active[i]);
  }
  const groups = clusters(thresholds.linkThreshold);
  const alternatives = [
    clusters(thresholds.looseLinkThreshold),
    groups,
    clusters(thresholds.strictLinkThreshold),
  ];
  const count = (rows: OperatorWindow[][], kind: OperatorKind) =>
    rows.filter((g) => operatorLabel(g[0]!.evaluation, thresholds) === kind)
      .length;
  const missingPairs = (kind: OperatorKind) => missingByKind[kind];
  const reportable = (kind: OperatorKind) =>
    complete &&
    labeled.length > 0 &&
    labeled.length === windows.length &&
    missingPairs(kind) === 0;
  return {
    schemaVersion: 1,
    resolutionVersion: "complete-link-v1",
    scoreKind: "uncalibrated",
    scoringPolicy: operatorPolicy(thresholds),
    thresholds,
    window: range,
    complete,
    observedWindows: windows.length,
    observedBrowserIds: new Set(
      windows.flatMap((w) => (w.browserKey ? [w.browserKey] : [])),
    ).size,
    evaluatedWindows: windows.filter((w) => w.status === "evaluated").length,
    unresolvedWindows: windows.length - labeled.length,
    comparedPairs: edges.size,
    possiblePairs: (windows.length * (windows.length - 1)) / 2,
    modelVersions: [
      ...new Set(
        windows.flatMap((w) =>
          w.evaluation ? [w.evaluation.modelVersion] : [],
        ),
      ),
    ].sort(),
    profiles: groups.map((g) => {
      const kind = operatorLabel(g[0]!.evaluation, thresholds) as OperatorKind;
      const families = g.map((w) => agentFamily(w.evaluation, thresholds));
      const family = families[0];
      return {
        id: `op_${g.map((w) => w.id).sort()[0]}`,
        kind,
        windowIds: g.map((w) => w.id).sort(),
        browserCount: new Set(
          g.flatMap((w) => (w.browserKey ? [w.browserKey] : [])),
        ).size,
        labelScore: Math.min(...g.map((w) => w.evaluation!.scores[kind])),
        ...(family && families.every((f) => f?.family === family.family)
          ? {
              family: {
                family: family.family,
                score: Math.min(...families.map((f) => f!.score)),
              },
            }
          : {}),
      };
    }),
    estimates: Object.fromEntries(
      (["human", "assistant", "automation"] as const).map((kind) => [
        kind,
        {
          profiles: count(groups, kind),
          uncomparedPairs: missingPairs(kind),
          likely: reportable(kind) ? count(groups, kind) : null,
          thresholdSensitivity: reportable(kind)
            ? {
                min: Math.min(...alternatives.map((a) => count(a, kind))),
                max: Math.max(...alternatives.map((a) => count(a, kind))),
              }
            : null,
        },
      ]),
    ) as OperatorSummary["estimates"],
  };
}
