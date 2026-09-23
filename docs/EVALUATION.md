# Evaluate verified feedback

The offline evaluation runner consumes an implementer-owned export. It runs locally, creates no dashboard, and makes no remote inference calls unless your supplied predictor does. Janitor ships a deterministic baseline and allows a Jev/custom predictor for a separately budgeted experiment.

```ts
import {
  createFeedbackExport,
  evaluateLearning,
  revokeFeedback,
} from "@janitor/core";

const reports = await visitor.learning!.reports(100);
const rows = reports.map((row) => ({
  ...row,
  deviceId: lookupIndependentlyVerifiedDevice(row.sessionId),
}));
const dataset = createFeedbackExport(rows);
const report = await evaluateLearning(dataset, {
  deviceHoldout: true,
  timeoutMs: 1200,
  predict: async ({ current, examples }) => myPredictor(current, examples),
});
```

`lookupIndependentlyVerifiedDevice` and `myPredictor` are your application functions. Device IDs must come from verified pilot labels or explicit device enrollment, not Janitor's own fuzzy browser prediction. Do not invent labels for unverified people. Native Elixir `Janitor.Learning.reports/2` returns the same wire keys, so a privileged export can use this evaluator without running a TypeScript identity server.

Each replay trial exposes only examples **verified before** its observation timestamp. Device holdout additionally excludes the current physical device from those examples. Duplicate sessions, invalid chronology and missing device labels are rejected. At most 100 recent examples reach a prediction; up to 10,000 trials may be loaded. Prior prediction fields and account labels for the current trial never enter predictor input. Input data is cloned so a predictor cannot mutate the dataset. Cold starts abstain; invalid/out-of-cohort predictions and timeout count as unavailable.

The report contains counts, precision, false associations per trial, coverage, abstention, recall among trials with the account in the available cohort, conditional Brier score, calibration bins and p95 callback latency. Null rates mean no denominator. The Brier score covers non-abstained predictions only and must be read with coverage. Latency excludes cold-start trials and includes failures/timeouts. This runner measures no provider billing; record actual provider usage separately.

## Command-line deterministic baseline

Save a version-1 export as `feedback.json`, then:

```sh
pnpm evaluate:learning feedback.json report.json
```

The command enables device holdout, uses a 0.90 similarity threshold and 0.03 account-margin abstention, and writes only an aggregate JSON report. It does not write observations to the report. This baseline often abstains across distinct devices; it is a comparison, not a trained cross-device classifier. To compare Jev fairly, use `evaluateLearning` with a separately approved predictor and exactly the same immutable holdout export. Freeze thresholds before final testing. Keep a development dataset separate from your final pilot evaluation.

## Revocable exports

`createFeedbackExport` assigns a random dataset ID and export timestamp. Preserve this manifest wherever copied. `revokeFeedback(dataset, sessionIds)` removes those rows and retains their IDs in `revokedSessionIds`; it returns a new export and leaves the original object untouched. The evaluator always excludes revoked rows, including accidentally re-added copies.

When an account/session is erased, propagate its session IDs to every retained export, evaluate only the updated manifest, and delete unauthorized copies. This is a local lineage helper, not an automatic distributed deletion service. It cannot untrain a separately trained classifier. Track model/dataset versions in your own experiment records and retrain or retire affected models according to policy.

Synthetic fixtures exercise leakage, metrics, revocation, abstention and malformed predictions. They do not establish real-user accuracy. Login-only feedback is selection-biased and does not label bots, malicious intent or the physical person before login. Use verified longitudinal, shared-device, privacy-browser and unknown-account cohorts before treating any risk threshold as useful policy.
