# Learn recurring assistant patterns

An assistant may call the same operations in the same order, pause for similar amounts of time, or produce unusually regular interactions. Doorman can look for these recurring combinations in sessions that your application has independently identified as assistant-operated.

The optional learning service turns those observations into small, readable rules and tests them on later sessions from different applications. It is a pilot for discovering useful evidence. It does not identify the human behind an account, authenticate an agent, or train Jev's weights.

## An example

Suppose confirmed assistants frequently call a telemetry operation, then a tool operation, with similar gaps between requests. Human-operated sessions sometimes call the same telemetry operation; ordinary browser polling can also have regular timing.

A useful candidate could require **both** an operation pattern and timing regularity. The learner discovers the numeric thresholds from examples. It checks whether the combination also appears in human sessions, including sessions from applications it has never trained on. A single endpoint or mouse statistic cannot become a detector by itself.

If a human or an attacker reproduces all the same observed features, this detector cannot tell them apart. New negative examples should cause the pattern to fail its validation gates. Verified credentials and delegation remain the evidence for authorization.

## What runs where

Your application keeps its visitor database, account/device links and authentication. It decides which first-party operations to observe and which independent outcomes it can confirm.

The separate learning service accepts bounded numeric summaries and returns private risk assessments. It can run on your infrastructure using Postgres or D1. An operator can provision participants in a shared deployment. Ordinary Doorman installations make no connection to that service.

There are three independent choices:

- **Remote evaluation:** send a summary for an assessment. This does not contribute it to training.
- **Contribution:** submit a sampled session summary and, later, independently confirmed feedback.
- **Training eligibility:** allow contributed samples to enter discovery. Both the application and the service operator must approve participation.

All tenant preferences start disabled. The JavaScript contribution helper also requires a local opt-in and samples 1% of sessions by default. One immutable snapshot per application session per UTC day is accepted. A later snapshot cannot overwrite the evidence that preceded a label.

See [connect your application](NETWORK-CLIENT.md) for code in the documentation's selected language.

## What the learner can see

The input schema accepts only versioned numeric features:

| Source                          | Summary                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| First-party API operations      | Counts, denied/error ratios, rounded mean handler duration and fraction of short completion gaps              |
| Configured operation categories | Share of navigation, read, write, auth, tool, telemetry and other operations                                  |
| Ordered server session          | Transition frequencies between categories, repeated-transition ratio and rounded arrival-gap mean/variability |
| Optional browser behavior       | Rounded mouse speed, turn/pause ratios and aggregate interaction interval mean/variability                    |

`extractFeatures()` converts Doorman API activity and optional browser behavior into these fields. You map your static route templates to operation categories. Raw route templates, URLs, bodies, credentials, IPs, emails, device fingerprints and account identifiers are excluded.

`createSequenceTracker()` keeps counts for at most 256 operations in one server-owned session/window. It remembers only the previous category/time and bounded running statistics. Its snapshot contains no event trail or exact timestamps. Keep it with the session owner; do not use one global tracker across users or combine unrelated worker orderings. For a distributed application, derive the same summary from its existing ordered session stream. The pilot does not create a new distributed event pipeline.

The server can observe requests received by your application. It cannot see an assistant's private outbound telemetry calls to another service. Doorman does not bypass browser restrictions or probe other applications to obtain those calls. Timing features describe observed requests and interactions; they are not measurements of an assistant's internal thinking time.

Missing or sparse browser behavior stays unknown. The collector requires at least 20 mouse movements or 10 interaction intervals before deriving those respective features. It never reads actual keys, absolute coordinates, text or form values. Browser summaries remain spoofable.

## How a session becomes a training example

1. Your server prepares and optionally contributes an immutable summary. Inspect the exact JSON locally before enabling uploads.
2. Later, it supplies an outcome for that sample ID. The service records when the feedback arrived.
3. `confirmAssistant()` accepts attribution freshly verified by Doorman on your server: a verified agent credential, verified principal and currently valid delegation. It creates an assistant label only. It does not label the session harmless.
4. Other outcomes require an independently reviewed session or confirmed incident. The protocol rejects labels whose source is a Jev prediction, CAPTCHA result or login alone.
5. Conflicting feedback marks the sample disputed and removes it from future discovery. It invalidates existing model evidence conservatively.

The shared service trusts the approved implementer's attestation about its review or credential checks. It does not independently verify that customer's credential issuer. Operator-controlled enrollment, contributor caps and cross-application holdouts reduce poisoning risk; they cannot make dishonest labels trustworthy.

Assistant and abuse labels are separate. An authorized assistant can perform an abusive action; an attacker can operate a browser manually. Labels can be linked to your PostHog/Mixpanel events or warehouse outcomes, but only after your server maps a trusted outcome to a retained sample ID. No analytics provider is scraped and no analytics event name automatically becomes ground truth.

## Automatic discovery

The learner searches a fixed, bounded feature vocabulary. It tries thresholds learned from training values, then pairs of conditions from different feature groups. It ranks candidates on a later validation period and freezes the best three before testing them on unseen applications.

The three partitions are:

| Partition  | Which sessions it sees                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Training   | Earlier sessions from participating training applications, with feedback already available before the cutoff |
| Validation | Later sessions from those applications, also with feedback available before their cutoff                     |
| Holdout    | Still later sessions from applications excluded from both preceding partitions                               |

Choose holdout applications before inspecting results. Retrying variants against the same test set is not fresh independent validation. A model records its cutoffs, holdout list, dataset revision/digest, sample counts, cohort results and expiry.

The initial gates require at least three training applications and three unseen applications, at least 100 positive and 300 negative examples in each partition, held-out precision's Wilson lower bound of 0.90, and false-positive rate's Wilson upper bound of 0.02. The learner also checks each unseen application's negatives. Browser-based patterns additionally require privacy and accessibility evaluation cohorts. These are experimental screening thresholds, not production accuracy guarantees.

Retrieval is bounded to ten approved participants and at most 500 examples per participant per time partition, with a total maximum of 10,000 rows. Sampling is reported. Exceeding the participant limit prevents promotion until an operator prepares an appropriate pilot dataset. These caps govern the pilot learning job, not the capacity of the visitor identity database.

The Cloudflare example can run discovery daily after an operator sets `DISCOVERY_HOLDOUT_TENANTS`. With no holdout manifest configured, scheduled work only performs bounded cleanup. Discovery does not call Jev or incur model inference costs.

## From a candidate to production evidence

Every discovered model begins in **shadow mode**. Its matches are visible privately, but Jev's production questions receive no shadow patterns. Failed models cannot be promoted.

An operator explicitly promotes a passing model to a canary percentage, initially 1%. Stable request feature buckets select canary participation. This is suitable for comparing assessments; it is not a person-level randomized experiment. Promotion changes the evidence supplied to Jev, not your application's policy or authentication state.

The service sends validated rules and their held-out statistics alongside the current numeric summary. Jev evaluates automation and suspicious activity separately with typed `noul` questions. No trained rule supplies an account ID or grants a permission. The reported match precision describes the sampled test data; it is not a calibrated probability for the current request.

Roll a model back immediately if reviewed outcomes show harmful false positives. Turning off training or deleting contributed training samples invalidates the pilot's current model revision conservatively. Models also expire within seven days or when their source data expires, whichever happens first. Rebuild after revocation. Exported datasets and separately trained external models need their own deletion/unlearning process.

## Cost and failure behavior

The service authenticates every data request, accepts at most 16 KiB, and limits requests per tenant. Private evaluations use a one-minute cache, shared SQL leases, daily tenant/global call limits and a persistent lifetime limit. Model failure or timeout returns zero risk with `riskStatus: "unavailable"`; disabled evaluation returns `"disabled"`. Neither means verified safe. There are no automatic retries.

The deployment examples start with model spending disabled. An operator must configure a provider and explicit budgets before inference can run. The public playground's budget and collection policy are separate and unchanged.

## Run and inspect the pilot

- [Postgres service](../examples/learning-service/README.md)
- [Cloudflare D1 service and daily discovery](../examples/learning-worker/README.md)
- [Versioned HTTP schemas](../protocol/network.schema.json)
- [Reviewed research catalog](NETWORK-RESEARCH.md)

Run `pnpm benchmark:network` for a synthetic discovery experiment. It compares a timing-only rule with a discovered pair and deliberately introduces human sessions that mimic the assistant pattern. The expected result is that the mimicked pattern fails promotion. These are generated fixtures, not evidence of real-world bot-detection accuracy.

The first real evaluation should include multiple independently operated applications, confirmed assistants, reviewed human sessions, privacy/accessibility cohorts and enough negative traffic to measure false positives. The pilot has not established those production accuracy results yet.

## Train a supervised classifier

The learning service also supports an offline classifier pipeline. Compare telemetry-only logistic/boosted-tree models with optional Jev features, using independently confirmed outcomes and a separate calibration window. Private `network.classify(features)` results describe assistant and abuse targets; they do not replace authentication or the existing risk result. Follow [Train a Doorman classifier](CLASSIFIER.md) for setup, validation, budgets and rollback.
