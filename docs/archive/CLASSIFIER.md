# Train a Doorman classifier

> **Historical research / advanced API archive.** This is not a setup guide for Doorman 0.13. It may describe retired configuration, separate experiments, or manual migrations. Start with the [current documentation](https://doorman.holycoders.io/docs/introduction/).

For experimental activity labels, agent-family suggestions and account-scoped operator estimates, see [operator attribution](OPERATOR-ATTRIBUTION.md). These inferences are separate from verified identities and require their own validation.

Doorman can learn which combinations of session measurements tend to accompany confirmed assistants or confirmed abuse. This is an optional training pipeline for operators of the learning service. Your existing visitor identity and analytics integrations keep working independently.

**This trains a Doorman model, not Jev's weights.** TypeSafe does not offer customer fine-tuning or LoRA for Jev. We use Jev's typed answers as optional numeric features, then train a small supervised classifier. See [the research and design decisions](CLASSIFIER-RESEARCH.md).

The pipeline is implemented and tested on generated sessions. No real-world detection accuracy has been established. You need independently labeled, opted-in sessions before training a deployable model. Buying inference credits does not supply those labels.

## What gets learned

Train one target at a time:

- **Assistant:** whether activity resembles sessions independently confirmed as assistant-operated. This does not cover every form of automation and does not verify delegation.
- **Abuse:** whether activity resembles sessions independently reviewed as abusive. An assistant can be authorized and harmless; assistant labels are never substituted for abuse labels.

The trainer compares logistic regression and shallow boosted trees. If you supply a complete Jev feature cache, it compares four candidates: the two telemetry models and the same two with Jev features. Jev judges regular timing, repeated workflows, mechanical input and affirmative abuse evidence. It receives numeric summaries only, with no outcome labels, session references, account IDs or training metadata.

The selected model runs as bounded numeric JSON in TypeScript. Production needs no Python process or ML server. A cheaper model wins when its validation Brier score is within 0.002 of the best qualifying candidate. These initial settings need calibration with real evidence.

## How we check the scores

The model fits on training sessions, then a separate chronological calibration set fits its sigmoid calibrator. Validation selects the model and threshold; later sessions from entirely separate applications provide the final test. We never fit on the final test labels.

Promotion now requires **both validation and final test** to have ROC-AUC at least 0.75, calibration error at most 0.10, and Brier loss better than the constant training-prevalence baseline, in addition to the existing precision, false-positive, coverage and cohort gates. Tied scores receive half credit in AUC; unscored sessions remain abstentions and reduce coverage. These are initial experimental gates, not universal accuracy guarantees. Older reports without AUC must be regenerated and checked before promotion.

Calibration cannot manufacture useful ranking from near-chance predictions. The [live Jev operator panel](DETECTION-VALIDATION.md) had AUC about 0.50; we have not turned that result into a production model or lowered thresholds to make it pass. Independently confirmed labels and representative benign sessions remain necessary. See scikit-learn's [calibration guidance](https://scikit-learn.org/stable/modules/calibration.html) for why fitting and calibration data must be separate and why Brier loss alone is not a calibration test.

## Try the complete pipeline without paid calls

Use Python 3.12 or newer. From the repository root:

```sh
pnpm install
python3.12 -m venv tools/classifier/.venv
tools/classifier/.venv/bin/python -m pip install -r tools/classifier/requirements.txt
pnpm classifier demo
```

With Bun, use `bunx tsx scripts/classifier.ts demo` after installing the workspace dependencies. You can set `CLASSIFIER_PYTHON` to another Python executable with the pinned dependencies installed.

This generates 3,000 labeled **synthetic** sessions across six imaginary applications, simulates Jev features from measurements, trains all four candidates, checks native Python/TypeScript score agreement, and writes `dataset.json`, `features.json` and `model.json` under `artifacts/classifier/`. The report includes held-out metrics, coverage and failed promotion gates. Files are private and ignored by Git. Synthetic artifacts cannot be staged or promoted by the service. This demo makes **zero external model calls**; its metrics measure a generated scenario, not real people or attackers.

## Collect independently confirmed outcomes

First follow [Connect to the learning service](NETWORK-CLIENT.md). Registration, remote evaluation, contribution and training are separate controls. The operator must approve training participation, the application must opt in, and each sample must be marked training-eligible.

A verified delegation can support a positive assistant label. A reviewed incident can support a positive abuse label. Reviewed sessions can support either outcome. **An unreviewed session is unknown, not a negative.** Login, a passed CAPTCHA, Jev's guesses and previous classifier scores are not human/abuse ground truth.

Review both positive and negative samples using a documented sampling process. Record the evidence reference through the client; raw investigation notes stay in your application. Repeated evidence is deduplicated, conflicting evidence is excluded, and disputed or revoked samples are excluded. Enrollment limits who can submit training data; it cannot prove that every contributor is honest.

Reserve at least three applications for the final test before examining their outcomes. Use at least three other applications for fitting, calibration and validation. Each partition needs at least 100 positives and 300 negatives to pass the initial promotion gates. Reviewed negatives should include benign API clients, polling, accessibility software, privacy browsers and sessions that mimic the suspected pattern.

## Export a versioned dataset

Apply both learning-service migrations. Cloudflare uses `pnpm migrate:remote` in `examples/learning-worker`; Postgres uses `pnpm migrate` in `examples/learning-service`. The Postgres runner safely recognizes the original pilot migration and tracks subsequent migrations.

Create a private `split.json` with your **preselected** cutoffs in Unix milliseconds and actual tenant IDs:

```json
{
  "target": "assistant",
  "trainingBefore": 1790000000000,
  "calibrationBefore": 1790400000000,
  "validationBefore": 1790800000000,
  "holdoutTenants": ["tenant_REPLACE_1", "tenant_REPLACE_2", "tenant_REPLACE_3"]
}
```

These illustrative IDs must be replaced with the opaque IDs issued by your service. Use cutoffs inside your retention period; for a 30-day pilot, 21, 14 and 7 days ago are a starting point.

Set `DOORMAN_NETWORK_ENDPOINT` and `DOORMAN_OPERATOR_TOKEN` in your secret-managed shell. Alternatively, `--config /private/operator.json` reads `{ "endpoint": "https://your-service", "operatorToken": "..." }`; keep that file outside the repository with mode 0600. Never use the operator credential in a browser or participant application.

```sh
pnpm classifier export --split /private/split.json --out artifacts/pilot
```

The operator endpoint exports at most 10,000 rows, with at most 500 per application per partition. It includes only unexpired, training-eligible, independently labeled samples. Fitting precedes calibration, which precedes validation; the final test contains later sessions from entirely separate applications. Feedback must have existed before its partition's cutoff.

The manifest records the split, counts, sampling/truncation, SHA-256 digest, dataset revision and expiry. The server seals it with an operator HMAC. Truncated or capped retrieval cannot qualify for promotion; narrow the pilot's collection window or retention rather than presenting a biased capped export as a representative benchmark. Daily rotating session references do not eliminate every repeated-person dependency across time or applications.

## Optionally compute Jev features with a budget

Telemetry-only training makes no Jev calls:

```sh
pnpm classifier train --dataset artifacts/pilot/dataset.json --out artifacts/pilot
```

For the Jev comparison, configure `JEV_API_KEY` locally. The default enrichment budget is zero. A paid run requires both `--live` and an explicit **cumulative** call cap:

```sh
pnpm classifier enrich --dataset artifacts/pilot/dataset.json --out artifacts/pilot
# Only after approving your own inference spend:
pnpm classifier enrich --dataset artifacts/pilot/dataset.json --out artifacts/pilot --live --max-calls 500
```

This uses `POST https://api.typesafe.ai/v1/systemone` with `{model:"jev-1.13.0", state:{features}, questions}`. The four questions use Jev's `noul` bounded numeric output. Every answer must report the exact pinned model version. No account, label or evidence reference goes to Jev.

A local ledger reserves attempts **before** each call. Failures consume reservations; restarting does not refund them. Completed rows and identical feature vectors are reused. An exclusive directory lock prevents concurrent writers. A failed call stops the run, so inspect the error before retrying with a larger cumulative cap. After a crash, remove a stale `.lock` directory only after confirming no enrichment process is running. Treat the cache and ledger as one unit: copying/deleting the ledger defeats this local budget safeguard. Calls are capped, not dollars; check current provider prices before approving a cap.

Complete the cache before comparing telemetry and Jev candidates; the tool never silently drops failed rows to improve the comparison. Then:

```sh
pnpm classifier train --dataset artifacts/pilot/dataset.json --features artifacts/pilot/features.json --out artifacts/pilot
```

Feature selection, missing-value means and scaling use fitting rows only. Calibration uses its own window. Validation chooses the family and threshold; only then is the final test measured. The trainer checks all exported native predictions against the TypeScript predictor within `1e-7`. Changing the Jev questions or model pin requires a new cache and retraining.

## Review, shadow, canary and rollback

Inspect `model.json`. It contains per-partition, per-application and per-cohort metrics: precision/false-positive confidence bounds, recall, coverage, Brier score, log loss and reliability bins. These scores describe the labeled pilot distribution. Incident-enriched datasets and changing base rates can make them poorly calibrated for live traffic.

```sh
pnpm classifier stage --dataset artifacts/pilot/dataset.json --model artifacts/pilot/model.json
pnpm classifier promote --model artifacts/pilot/model.json --percent 1
pnpm classifier rollback --model artifacts/pilot/model.json
```

Staging requires the original sealed export, matching revision and unexpired observed data. It starts in **shadow** mode even if gates fail. Promotion requires every gate to pass, including future held-out application performance, minimum label counts, coverage, calibration, and benign cohort checks when browser inputs are used. Review shadow outcomes before promotion; no job promotes itself. A canary percentage selects a stable tenant/feature bucket. Only one current model per target is served, preferring a canary over a newly staged shadow. Rollback retires that artifact; another unexpired shadow may then be served as shadow.

Model reports are operator-owned. The importer validates their structure, internal metrics, gates and sealed dataset manifest; it trusts the operator to run the documented trainer. The seal proves export integrity, not that arbitrary external training software told the truth. Do not accept participant-supplied trained models through an operator credential.

## Use the scores on your server

```ts
const result = await network.classify(features);
for (const prediction of result.predictions) {
  if (prediction.mode === "shadow" || prediction.score === null) continue;
  // Attach a private, separately named analytics property or review signal.
  // Do not use this as proof of account identity or delegated authorization.
  await recordPrivateAssessment({
    target: prediction.target,
    score: prediction.score,
    modelId: prediction.modelId,
  });
}
```

Every language can use `POST /v1/classify` with a participant bearer key and `{ "version": 1, "features": {...} }`. Remote evaluation must be enabled for that participant. The response is:

```json
{
  "version": 1,
  "status": "evaluated",
  "cached": false,
  "predictions": [
    {
      "target": "assistant",
      "modelId": "classifier_...",
      "mode": "shadow",
      "score": 0.82,
      "aboveThreshold": false,
      "reason": "scored"
    }
  ]
}
```

The TypeScript client is published in `@aarondovturkel/doorman-network` v0.12.0. Install it with npm, pnpm or Bun. Other language SDKs can call the HTTP protocol today; no new native `classify` method is implied. See [the machine-readable contract](../../protocol/classifier.schema.json).

Without a current model, `status` is `unavailable` and predictions are empty. Insufficient measurements produce `score:null` and `missing-evidence`. Failed, malformed, absent or version-mismatched Jev features produce `jev-unavailable`; expiry produces `expired` for a locally loaded model. Unknown is not a zero-risk judgment. This endpoint never blocks, challenges, merges identities or changes authorization.

The hosted Worker uses `AI.run("typesafe/jev", {state:{features}, questions})`, validates either the direct response or Cloudflare's `Completed/result` envelope, and checks the returned model pin. If Workers AI moves to a different model, Jev-assisted classification abstains until a reviewed retraining updates the pin. The remote risk and classifier endpoints share daily/lifetime call budgets and in-flight limits. The shipped learning-worker configuration keeps AI disabled and both global caps at zero.

## Retention and the next training cycle

Artifacts expire within seven days or at their earliest source-data expiry. Erasing training data, disabling training or revoking a participant invalidates the shared dataset revision, so cached and stored classifiers from it stop serving. Local files cannot be remotely erased: delete or rebuild every export, enrichment cache and artifact derived from withdrawn data. A locally loaded predictor cannot check central revocation; use `/v1/classify` when that guarantee is required.

After reviewing fresh outcomes, create a new versioned dataset and repeat the comparison. Keep the old report for an approved, limited audit period, not raw session data indefinitely. Reusing one test set for repeated prompt/model tuning overfits the test; reserve fresh applications or a later untouched test cohort. This version does not schedule training or automatically rewrite questions. That restraint lets us measure whether the added Jev features actually help before building a larger learning system.

## Configurable scoring and activity features

See [scoring configuration](../SCORING.md) for server-side identity weights and operator thresholds, and [agent classification](../AGENT-CLASSIFICATION.md) for optional aggregate movement/timing evidence. These are current TypeScript source features; defaults and private-score behavior are retained.
