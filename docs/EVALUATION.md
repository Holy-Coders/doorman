# Test a learning model

If you enable [login feedback](LEARNING.md), you can test a predictor against visits whose users later signed in. The goal is to find out how often it guesses correctly, how often it links the wrong user, and how often it declines to guess.

The evaluation runs locally on an export from your database. It only calls an external AI service if your predictor does. Start with Janitor’s built-in similarity baseline so you have something to compare another model against.

## Prepare labeled examples

A useful cross-device test needs an independently verified device label for each session, such as a label from device enrollment or a consented pilot. Do not use Janitor’s own guessed visitor identity as the answer you are testing against.

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

## Keep the test honest

For each visit in the test, the predictor can see only examples **verified before** that visit. With `deviceHoldout: true`, it also cannot see earlier examples from the same physical device. This tests whether it can recognize a known user on a different device rather than remember the browser it just saw. Duplicate sessions, invalid chronology and missing device labels are rejected. At most 100 recent examples reach a prediction; up to 10,000 trials may be loaded. Prior prediction fields and account labels for the current trial never enter predictor input. Input data is cloned so a predictor cannot mutate the dataset. Cold starts abstain; invalid/out-of-cohort predictions and timeout count as unavailable.

## Read the report

The report includes:

- **Precision:** how often a returned prediction was correct.
- **False associations:** how often a visit was linked to the wrong user.
- **Coverage and abstention:** how often the predictor answered or declined.
- **Recall:** how often it found the user when that user appeared among the available examples.
- **Calibration:** how reported confidence compares with observed correctness, including a Brier score for answered predictions.
- **p95 latency:** the duration below which 95% of predictor calls completed.
  Null rates mean no denominator. The Brier score covers non-abstained predictions only and must be read with coverage. Latency excludes cold-start trials and includes failures/timeouts. This runner measures no provider billing; record actual provider usage separately.

## Command-line deterministic baseline

Save a version-1 export as `feedback.json`, then:

```sh
pnpm evaluate:learning feedback.json report.json
```

The command enables device holdout, uses a 0.90 similarity threshold and 0.03 account-margin abstention, and writes only an aggregate JSON report. It does not write observations to the report. This baseline often abstains across distinct devices; it is a comparison, not a trained cross-device classifier. To compare Jev fairly, use `evaluateLearning` with `createJevEvaluator(...).predictIdentity!` (or a separately approved predictor) and exactly the same immutable holdout export. Freeze thresholds before final testing. Keep a development dataset separate from your final pilot evaluation.

## Revocable exports

`createFeedbackExport` assigns a random dataset ID and export timestamp. Preserve this manifest wherever copied. `revokeFeedback(dataset, sessionIds)` removes those rows and retains their IDs in `revokedSessionIds`; it returns a new export and leaves the original object untouched. The evaluator always excludes revoked rows, including accidentally re-added copies.

When an account/session is erased, propagate its session IDs to every retained export, evaluate only the updated manifest, and delete unauthorized copies. This is a local lineage helper, not an automatic distributed deletion service. It cannot untrain a separately trained classifier. Track model/dataset versions in your own experiment records and retrain or retire affected models according to policy.

Synthetic fixtures exercise leakage, metrics, revocation, abstention and malformed predictions. They do not establish real-user accuracy. Login-only feedback is selection-biased and does not label bots, malicious intent or the physical person before login. Use verified longitudinal, shared-device, privacy-browser and unknown-account cohorts before treating any risk threshold as useful policy.
