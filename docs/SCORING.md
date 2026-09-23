# Tune scoring for your application

Janitor's defaults are a starting point. You can change how browser features are weighted, how much Jev contributes to matching, and how much evidence an operator label or grouping needs. Configure these on your server; a browser request cannot override them.

These options are in the current TypeScript source packages. Node, Vercel and Cloudflare share the same configuration. Native Elixir scoring has not acquired these options; Python and Go clients use the policy of the TypeScript service they call. See [installation](LANGUAGES.md) and [operator setup](OPERATOR-ATTRIBUTION.md) for source package instructions.

## Browser matching weights

```ts
const janitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  scoring: {
    similarity: {
      sameTimezone: 0.02,
      viewportSimilarity: 0,
      sameWebglRenderer: 0.16,
    },
    confidence: { deterministic: 0.6, evaluator: 0.4 },
    candidateFloor: 0.65,
    ambiguityMargin: 0.03,
  },
  restoreThreshold: 0.9,
});
```

Unspecified similarity features retain their defaults. The combined weights are normalized to sum to one. A zero weight excludes that feature from the weighted match. Confidence weights are relative too: `60` and `40` mean the same as `0.6` and `0.4`. Provide both confidence weights together.

| Feature             | Default relative weight |
| ------------------- | ----------------------: |
| Platform            |                    0.18 |
| Browser family      |                    0.12 |
| Timezone            |                    0.05 |
| Languages           |                    0.07 |
| Screen dimensions   |                    0.14 |
| Viewport dimensions |                    0.02 |
| CPU concurrency     |                    0.10 |
| Device memory       |                    0.07 |
| Touch capabilities  |                    0.05 |
| WebGL vendor        |                    0.07 |
| WebGL renderer      |                    0.13 |

The exact keys are exported as `SIMILARITY_WEIGHTS`. Advanced callers can use `calculateSimilarity(a, b, weights)` or pass `scoring` to `createVisitorEngine`. `resolveScoring` returns a frozen, normalized snapshot suitable for recording with an experiment.

The default confidence blend remains 35% deterministic similarity and 65% Jev's `sameVisitor`. If evaluation fails or is disabled, Janitor uses deterministic similarity alone, regardless of blend settings. Weights do not turn off Jev calls; omit the evaluator to disable them. Known cookies still provide continuity without a global search.

Negative, non-finite, unknown and all-zero weights are rejected at construction. `candidateFloor` accepts 0.5–1; `ambiguityMargin` must be above 0 and at most 1; `restoreThreshold` retains its 0.8–1 range.

Safety checks remain active. Contradictory devices cannot match, saturated lookup buckets cannot restore an ID, and near ties need a positive margin. Evidence coverage still uses the **default feature weights**, including the 0.55 minimum coverage floor, so concentrating all weight on timezone cannot turn a sparse observation into confident identity. Changing weights never puts automation or abuse into identity matching.

## Agent labels and account reports

```ts
const janitor = createNodeVisitor({
  db,
  identity,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  operators: {
    thresholds: {
      labelThreshold: 0.8,
      labelMargin: 0.2,
      familyThreshold: 0.9,
      familyMargin: 0.2,
      looseLinkThreshold: 0.85,
      linkThreshold: 0.95,
      strictLinkThreshold: 0.99,
    },
  },
});
```

A label needs both a minimum score and a lead over its nearest alternative. Agent-family suggestions have their own checks. Link thresholds control whether activity windows form the same inferred operator profile. Every pair within a group still needs positive comparison evidence.

Defaults are 0.75 / 0.15 for labels, 0.85 / 0.15 for families, and 0.8 / 0.9 / 0.98 for loose / selected / strict grouping. Thresholds accept 0.5–1; margins must be above 0 and at most 1. Grouping thresholds must be in ascending order. Sparse windows remain unknown even with relaxed settings.

Each new window stores its threshold snapshot. Window analytics use that stored snapshot; changing service configuration does not rewrite a past assessment. Summaries intentionally recompute grouping under the current report policy and include `thresholds` and `scoringPolicy`. PostHog, Mixpanel and warehouse events include `janitor_operator_scoring_policy`. Use a new report revision when changing settings; compare results under the same policy.

Advanced callers can pass thresholds to `operatorLabel`, `agentFamily` or `summarizeOperators`. Legacy windows without a snapshot use the defaults. Raw Jev scores remain unchanged. These settings are decision thresholds, not Jev fine-tuning or probability calibration.

## Choose settings using evidence

Start with independently labeled traffic from your application. Split by time and user/session group, choose weights and thresholds on a validation set, then measure errors on a held-out set. Include keyboard-only, accessibility, privacy-browser, mobile and remote-desktop users. Record coverage and abstentions alongside false positives and missed agents.

Do not tune on the final test set or call a higher score an accuracy improvement. The [public dataset results](EXTERNAL-BENCHMARKS.md) show why: matching can be wrong at high scores, and behavior classifiers vary by agent family. Risk policy stays application-owned; Janitor never blocks or challenges automatically.

`scoring.similarity.fontSimilarity` adds an optional relative weight for the fixed local-font set (default `0`). It does not increase minimum evidence coverage or override contradiction/ambiguity caps. For example, `0.05` adds a modest contribution when both sets are available. [Collection and limits](EXPERIMENTAL-DETECTION.md).

`activity.correlation.minConfidence` controls which server-derived links contribute related activity (default `0.8`, permitted range `0.5–1`). This is separate from browser matching and operator thresholds. Request-shape similarity alone is not abuse. [Correlation guide](LINKED-ACTIVITY.md).
