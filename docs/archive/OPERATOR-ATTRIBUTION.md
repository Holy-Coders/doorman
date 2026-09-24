# Understand who operates an account

> **Historical research / advanced API archive.** This is not a setup guide for Doorman 0.13. It may describe retired configuration, separate experiments, or manual migrations. Start with the [current documentation](https://doorman.holycoders.io/docs/introduction/).

An account can be used by a person, an assistant, a scheduled script, or several of them. Doorman can now attach scored labels to short stretches of activity and compare those stretches within your account. Your server can send the results to PostHog, Mixpanel or a warehouse.

This is an **experimental, server-only feature**. Its scores have not been calibrated for operator identity. The implementation is tested; reliable human headcounts and agent-brand recognition are not yet demonstrated. It does not change login identities, merge analytics profiles, authorize actions, or block anyone.

## What you get

A completed activity window has independent `human`, `assistant`, `automation` and `abuse` scores. Here, `automation` means a conventional script. An assistant can score highly as an assistant and low on abuse. A sparse or ambiguous window stays unknown.

A report groups windows into inferred operator profiles. A profile can span browser IDs when there is supporting comparison evidence. Different labels on the same browser can describe a human-to-agent handoff. Four observed browser IDs still means four identifiers, not four guaranteed physical devices.

The report includes:

- Browser IDs and activity windows actually observed.
- Inferred human, assistant and conventional automation profiles.
- Optional agent-family suggestions backed by configured reference examples.
- Unresolved windows, evaluated coverage and comparison coverage.
- The model versions, reporting window and resolution algorithm.
- A count at the default matching threshold and its sensitivity to stricter/looser thresholds, when evidence is complete enough.

The sensitivity range is **not a confidence interval**. Scores are independent evidence scores; they do not add to one. `likely` is a provisional threshold-based count, not a statistically estimated mode. A missing count is not zero.

## Enable the private service

Install the adapter and your storage package. For Node with Postgres:

```sh
npm install @aarondovturkel/doorman-adapters @aarondovturkel/doorman-storage-postgres pg
```

You can use `pnpm add` or `bun add` with the same package names. The examples below use the v0.12.0 API.

Apply migration `0009_operators.sql` from your storage package after the earlier migrations. Then enable `operators` on your existing Node, Vercel or Cloudflare adapter. It uses the same database, identity namespace and evaluator. Explicit `protection` configuration shares the evaluator budget across identity, API activity and operator assessment.

```ts
import { createNodeVisitor } from "@aarondovturkel/doorman-adapters/node";

const doorman = createNodeVisitor({
  db,
  identity: {
    secret: process.env.DOORMAN_IDENTITY_SECRET!, // stable, at least 32 characters
    namespace: "my-app-production",
  },
  evaluator: { apiKey: process.env.JEV_API_KEY!, model: "jev-1.13.0" },
  operators: { retentionDays: 30 },
});
```

For Cloudflare, use `createCloudflareVisitor({ db: env.VISITORS, ai: env.AI, identity, operators: {} })`. Vercel uses `createVercelVisitor` with the Node options. No API route is automatically exposed. The feature is currently available in the TypeScript service; Phoenix, Python and Go applications can feed a private application-owned TypeScript service. Their existing native APIs have not acquired an `operators` method. The language-neutral input shapes are in [the protocol schema](../../protocol/operators.schema.json).

## Close an activity window

Use your existing session owner or request aggregation to close a non-overlapping window, usually one to five minutes. Supply account/session references only after your application authorizes them. Use a new session reference when the authenticated account changes. Keep one stable window ID for retries.

```ts
const result = await doorman.operators!.observe({
  accountId: authorizedAccount.id,
  sessionId: serverSession.id,
  windowId: closedWindow.id,
  browserId: identity.visitorId, // optional browser continuity ID
  startedAt: closedWindow.startedAt,
  endedAt: closedWindow.endedAt,
  evidence: {
    source: "server",
    features: {
      api_request_count: closedWindow.requestCount,
      api_gap_cv: closedWindow.requestGapCv,
      api_sequence_repeat_ratio: closedWindow.repeatedTransitionRatio,
    },
  },
});
```

These example `closedWindow` fields come from your application's measurements. Do not fabricate them. The service derives observation duration from the closed window's times. Windows must be at most 15 minutes, within retention, and already ended. Browser evidence remains spoofable; mark it `browser`, server measurements `server`, or a combined summary `mixed`.

`extractFeatures` and `createSequenceTracker` from `@aarondovturkel/doorman-network` produce compatible feature names. The extractor now retains rounded observation duration and supporting mouse/interaction sample counts. Feed it **window-local aggregates**: repeatedly submitting a lifetime page snapshot as new windows would duplicate evidence. The library does not install another browser event recorder for this feature.

`recorded` contains a completed window, which can have `evaluated`, `unavailable`, `disabled` or `insufficient-evidence` status. A repeated identical submission returns `cached`; a competing insertion can return `pending`. Reusing an ID with different data returns `conflict`. Overload or quotas return `limited`; infrastructure failures return `unavailable`. Caller validation errors throw. Reporting errors, capacity limits and deadlines also throw; these are private measurement failures, not application access decisions.

One immutable database insert wins the evaluation race. Failed provider calls are not retried automatically. An interrupted pending window remains unresolved until retention cleanup or authorized erasure. A retry does not reserve another model call. Application requests keep their own policy regardless of the measurement result.

## Recognize known agent families

There are no built-in claims that a particular timing pattern identifies ChatGPT or Claude. Build reference examples from controlled runs in which an independent harness records which product operated the browser. Keep product/runtime labels distinct from the underlying language model.

```ts
import { buildAgentFamilyReferences } from "@aarondovturkel/doorman-network/operators";

const fitted = buildAgentFamilyReferences(controlledRuns, {
  version: "agent-study-2026-09",
  fittedAt: trainingCutoff,
  expiresAt: trainingCutoff + 30 * 86_400_000,
});

// Pass fitted.families in operators: { families: fitted.families }.
```

Each run contains `runId`, `task`, `split: "train" | "holdout"`, `observedAt`, `labelSource: "controlled-run"`, `trainingAllowed`, `kind`, an optional `family`, and numeric `evidence`. The builder only uses eligible training rows at or before the cutoff. It rejects duplicate run IDs, requires at least three measured runs and two tasks per family, and selects at most five diverse examples for each of six families. Expired references are ignored.

This fits examples for Jev's context; it does not train Jev's weights or prove a family classifier works. Keep complete operators, devices, tasks and future product versions out of training for evaluation. Diverse examples are useful, but the minimum counts are engineering limits, not statistically sufficient training recommendations. Confirmed labels must come from the harness or independent review, never Doorman's own predictions, a user-agent string, login, or passing a CAPTCHA.

Both direct Jev and Workers AI evaluate narrow typed `noul` questions in one bounded request. The model sees numerical evidence and anonymous reference positions. Account IDs, session IDs, browser IDs and family names stay local. The provider's actual model version and prompt version are recorded; stored windows also retain the reference versions used. A custom evaluator can replace `evaluateOperator` without changing the service or analytics API.

TypeSafe currently supports contextual customization and downstream classifiers, not customer fine-tuning. See [the official model documentation](https://docs.typesafe.ai/models#customizing-jev) and [the Workers AI invocation](https://developers.cloudflare.com/ai/models/typesafe/jev/).

## Report on an account

```ts
const report = await doorman.operators!.summarize(authorizedAccount.id, {
  since: periodStart,
  until: periodEnd,
});

report.observedBrowserIds;
report.estimates.assistant.likely; // number or null
report.estimates.human.likely;
report.profiles; // report-local inferred operators and optional family scores
```

Ranges are half-open and use fully contained windows. Keep the entire period within configured retention. A report reads at most 201 rows and resolves at most 200. `complete: false` means it is truncated; totals are withheld. Counts are also withheld when a window is unresolved or same-kind windows have missing comparisons. `profiles` remains the grouping of the available evidence, not a substitute account-wide headcount.

Candidate retrieval reads at most 200 earlier windows in that account and selects ten by numerical similarity and recency. Retrieval similarity is never sufficient to join operators. Complete-link grouping requires positive comparison evidence between **every pair** in a merged profile. An A–B match and B–C match cannot silently merge A and C. A model's abuse score never determines linkage.

This conservative first version can split one recurring operator or leave totals unresolved, especially beyond ten comparison candidates. It does not yet provide a calibrated count distribution or a scalable long-term operator graph. Use the smaller period your evidence can support; do not add overlapping-window or daily unique counts to manufacture a monthly total. Model/reference changes affect later windows; existing assessments remain historical. Profile IDs can change with the report's period or evidence and must not become login IDs or analytics `distinct_id` values.

## PostHog, Mixpanel and warehouses

The existing server analytics bridge now supports three explicit events:

```ts
import { createAnalyticsBridge } from "@aarondovturkel/doorman-adapters/analytics";
const bridge = createAnalyticsBridge({ provider: "posthog", client: posthog });
// Or: { provider: "mixpanel", client: mixpanel }

if (result.window && result.status === "recorded") {
  await bridge.captureOperatorWindow(result.window, authenticatedUser.id, {
    accountId: authorizedAccount.id,
  });
}

const context = {
  accountId: authorizedAccount.id,
  revisionId: reportJob.id, // stable for retries; new for a recomputed report
};
await bridge.captureOperatorSummary(report, authenticatedUser.id, context);
for (const profile of report.profiles) {
  await bridge.captureOperatorProfile(
    profile,
    report,
    authenticatedUser.id,
    context,
  );
}
```

The event names are `doorman operator assessed`, `doorman operators summarized`, and `doorman operator profile`. Properties use separate `doorman_operator_*`, `doorman_inferred_operator_id`, `doorman_estimated_*_profiles`, and `doorman_resolution_revision` fields. The bridge never calls `identify` or merges profiles for these events. Existing verified actor fields remain unchanged. Provider SDKs still own transport and flushing; delivery is not exactly-once.

For account reporting, select the latest resolution revision for the **same account and exact period**, then use its summary counts. For family breakdowns, use only profile rows from that revision. Do not distinct-count inferred profile IDs across revisions or add snapshot totals. Exclude truncated/unresolved reports when asking for a complete headcount. Keep verified credential counts as a separate metric.

`warehouseOperatorReport(report, authenticatedId, { accountId, revisionId, eventId, occurredAt })` produces one summary row and its profile rows. `warehouseOperatorWindow` produces a window row. Pass them through `warehouseJSONL` to your customer-owned Snowflake, BigQuery or other sink. Dedupe by your stable event IDs and retain revision/period fields. No raw measurement vectors, session keys, debug records or fingerprints enter analytics or warehouse projections.

## Retention, budgets and privacy

This is opt-in per implementer and runs in their database. It does not send telemetry to a Doorman-operated collector. Using Jev sends the bounded numerical evidence and configured reference examples to the chosen inference provider. Browser measurements are still potentially identifying data even without coordinates or names; use your application's disclosure and permission policy.

Defaults: 30-day window retention, 16 simultaneous observations/reports per reusable service instance, a four-second service deadline, and the existing shared evaluator protection. If no protection is configured, adapters create a guard shared by operator assessment and API activity, allowing at most 60 evaluator calls per minute with four concurrent calls. Configure `protection` explicitly to cover browser identity evaluation too. These are technical limits, not permission to incur charges. `observe` is explicit; enabling the option does not start background collection or paid calls. Existing evaluator deadlines still apply, and a timed-out provider may keep running upstream.

Call `doorman.cleanup()` periodically. Erase with `operators.deleteAccount(accountId)`, `deleteSession(accountId, sessionId)` or `deleteBrowser(accountId, browserId)`. Stop collection/in-flight submissions first. Completing an already claimed row cannot recreate it after deletion or overwrite a later claim. Selective session/browser erasure clears the remaining account links and invalidates pending evaluations, so retained windows cannot keep references to erased windows; subsequent reports may become unresolved. Account/session/browser references are hashed with the configured namespace and secret before persistence. These records are separate from browser history and the identity directory; deleting either does not automatically erase this account-scoped history. Delete exported analytics data through the destination's own lifecycle.

## What we will measure next

The automated tests cover account isolation, retries, concurrent inserts, retention, failure behavior, label ambiguity, transitive-merge protection, mocked Jev transports, analytics projections and synthetic mixed-operator accounts. They do not establish real-world headcount or family-attribution accuracy.

The next validation dataset must contain independently known humans and agent instances sharing accounts and browsers. Measure per-label calibration, unknown-family rejection, false operator merges/splits, count error, and interval coverage. Only then replace the sensitivity range with a calibrated estimate. Compare numeric-only models with Jev-assisted models on the same unseen runs. The [existing public-data results](EXTERNAL-BENCHMARKS.md) measure different tasks and do not validate this feature.

Additional runtime, cursor, focus and decoy ideas are tracked in the [detection research backlog](DETECTION-RESEARCH-BACKLOG.md). They are not enabled detectors.

## Configurable scoring and activity features

See [scoring configuration](../SCORING.md) for server-side identity weights and operator thresholds, and [agent classification](../AGENT-CLASSIFICATION.md) for optional aggregate movement/timing evidence. These are current TypeScript source features; defaults and private-score behavior are retained.
