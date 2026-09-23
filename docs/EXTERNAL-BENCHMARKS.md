# Tests with public research datasets

We ran Janitor against three public research datasets. The results show useful behavioral evidence, and a serious limitation in recovering identity from browser signals alone.

**Cookie-loss recovery is not reliable enough to treat as verified identity.** In the historical fingerprint replay, wrong restores outnumbered correct restores. The behavioral experiments also missed many agents and sometimes flagged humans. These findings are published so you can judge the limits before using Janitor in your application.

| Experiment                 | Data evaluated                                              | Main finding                                                                  |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Returning browsers         | 15,000 FP-Stalker observations, 1,819 browser labels        | 1,258 correct restores; 2,303 wrong restores                                  |
| Human versus browser agent | 7,728 FP-Agent sessions: 546 human, 7,182 agent             | Timing helps, but detection and false positives vary by held-out agent family |
| Account-owner behavior     | 65 Balabit training recordings; 816 labeled test recordings | Aggregate behavior reaches 0.668 AUC on 799 scored test recordings            |

These research evaluations ran on September 23, 2026. The three full experiments above run locally without Jev. A separate, smaller comparison below made **103 real Jev calls** across 120 cases, reusing identical inputs from a private cache. No model was promoted to production. Neither experiment measures anonymous cross-device identification, malicious intent, or performance at millions of concurrent connections.

## New detection features: measured comparison

We reran all three datasets after adding optional movement-step and interaction-timing summaries. The baseline retains the original five numeric features. The expanded feature set adds mean movement step, large-step fraction, movement interval variation, short press-gap fraction and repeated press-gap fraction. This is a comparison of **locally trained numeric classifiers**, not a new Jev accuracy claim.

Both variants use the same groups, fitting/calibration/validation/test partitions, training procedure and validation objective: choose a cutoff with at most 2% observed validation false positives. Test false positives can exceed that objective. Feature eligibility is determined on fitting data only. All test cases remain in recall denominators, including abstentions; AUC covers only scored cases. These are previously inspected research splits, so this rerun is a development comparison, not a fresh independent validation cohort.

| Held-out agent family | AUC, baseline → expanded | Recall, baseline → expanded | Human false alerts, baseline → expanded | Expanded scored / total |
| --------------------- | -----------------------: | --------------------------: | --------------------------------------: | ----------------------: |
| Atlas Agent           |            0.997 → 0.972 |               59.9% → 45.8% |                              2 → 0 / 68 |              664 / 1062 |
| Browser Use           |            0.849 → 0.988 |               58.2% → 84.3% |                             10 → 1 / 68 |             1185 / 1207 |
| ChatGPT Agent         |            0.921 → 0.980 |               29.6% → 30.0% |                             10 → 1 / 68 |              472 / 1065 |
| Claude                |            0.964 → 1.000 |               16.7% → 42.1% |                              2 → 1 / 68 |              478 / 1070 |
| Comet                 |            0.997 → 0.999 |               35.1% → 34.3% |                              2 → 1 / 68 |              418 / 1094 |
| Manus                 |            0.972 → 0.999 |               64.1% → 68.7% |                             10 → 1 / 68 |              744 / 1063 |
| Skyvern               |            0.932 → 1.000 |              34.6% → 100.0% |                              1 → 1 / 68 |             1085 / 1097 |

The expanded models selected four interaction features: mean interval, interval variation, short-gap fraction and repeated-gap fraction. Mouse features did not meet the fitting coverage/variation requirements in these folds. **This result supports testing the extra timing inputs; it does not validate the new movement features for agent detection.** Detection improved for five families and fell for Atlas and Comet. Low recall for several families remains a material limitation.

The 68 held-out human sessions are reused across family folds; they are not 476 independent humans. Participant IDs and physical host identity are unavailable. The separate environment-proxy holdout also ran: expanded AUC ranges from 0.980 to 1.000 on scored cases, but environment configuration is not verified physical-device independence. No model was promoted to production.

On **Balabit**, the expanded numeric anomaly features raised AUC from **0.668 to 0.758**, with the same **799 of 816** test recordings scored. This compares recordings with an account owner's training behavior; it is not an AI-agent, unique-human-count or attacker-intent benchmark. The original training/test split and lack of a calibrated decision cutoff remain unchanged.

The full **FP-Stalker** replay reproduced the earlier result: **1,258 correct and 2,303 wrong restores**. Default identity weights stayed unchanged, and behavior never participates in browser identity. Configurability is not evidence that tuning those weights fixes false matches.

The **120-case Jev pilot replay** reused the original provider responses and made **zero new requests**. It reproduced the earlier identity and automation results below. Its frozen five-feature inputs and old questions do not evaluate the new movement/timing fields or the `operators-v2` prompt. A fresh, budgeted provider experiment on separate labeled cases is still needed before claiming those additions improve Jev.

[Download the aggregate comparison, provenance and source hashes](benchmarks/detection-v2-2026-09-23.json). Raw sessions, identifiers, recordings and fitted research weights are not published.

To reproduce after the local datasets and Python environment are prepared:

```sh
pnpm benchmark:external
pnpm benchmark:external fpagent --extended
pnpm benchmark:external balabit --extended
pnpm benchmark:jev # cache only; fails on a missing cached response
pnpm benchmark:compare
```

The expanded run writes separate `*-extended-*` artifacts, preserving baseline reports. `benchmark:compare` checks cohort sizes and fold partitions before producing the public aggregate. Scores remain experimental and private by default. See [agent classification](AGENT-CLASSIFICATION.md) and [adjustable scoring](SCORING.md).

## Browser identity: what failed

[FP-Stalker](https://github.com/Spirals-Team/FPStalker) publishes an unfiltered sample of historical observations. We used its browser labels as evaluation truth and replayed all 15,000 observations in timestamp order, from October 2015 through August 2016.

Each observation goes through Janitor's actual normalization, matching engine and Postgres storage adapter, backed by PGlite. Every request has its cookie removed. The normal ten-candidate limit, five-observation matching history, 90-day retention window, ambiguity check and 0.90 restore threshold remain in place. The clock advances through the original timestamps.

The evaluator is disabled. Ground-truth labels stay outside the matcher. The engine saves its own predictions, so a wrong match can affect later observations, just as it can in a running application.

| Outcome                                   |  Count |
| ----------------------------------------- | -----: |
| First observations of a browser label     |  1,819 |
| Subsequent observations                   | 13,181 |
| Correct restores                          |  1,258 |
| Wrong restores on first observations      |    362 |
| Wrong restores on subsequent observations |  1,941 |
| New IDs on first observations             |  1,457 |
| New IDs on subsequent observations        |  9,982 |

Only **35.3% of attempted restores were correct**. Correct restores covered **9.5% of returning observations**. Lookup never returned more than ten candidates; it reported saturation on 8,548 requests. Bounded lookup worked, but that does not establish matching accuracy.

The projection uses the published HTTP user-agent string as a proxy for the browser user agent, JavaScript platform, screen dimensions/depth, and available WebGL vendor/renderer. The old sample lacks several signals Janitor can collect today. We do not convert a timezone offset into a guessed IANA timezone, turn an HTTP language header into `navigator.languages`, or invent hardware values. Flash, plugins, canvas hashes, network addresses and the author's derived browser classifications are excluded.

This is an intentionally difficult all-cookies-missing scenario on selected, old data. It is not the FP-Stalker paper's original filtered experiment and is not a modern population estimate. It still exposes false matches that a similarity threshold cannot resolve. A high matching score is not a calibrated probability of identity. Use authenticated account links for account identity; never use a recovered visitor ID to authorize access.

[Download the aggregate identity report](benchmarks/external-fpstalker-2026-09-23.json).

## What real Jev calls added

We tested `jev-1.13.0` through Cloudflare's `typesafe/jev` endpoint. This was actual provider inference, not mocked responses. The pilot reused Janitor's existing questions without changing prompts or thresholds after seeing answers. Source labels and identifiers stayed local; Jev received only the projected measurements needed for each question.

### Cookie recovery on the same stored history

Forty cases were selected by a fixed hash rule from the last 30% of FP-Stalker's chronology: twenty returning browser labels and twenty first observations. Each had platform, screen and renderer data. Earlier observations were stored under their published browser labels, representing reliable previous cookie visits. Each case then ran without a cookie through the actual engine twice, once without an evaluator and once with Jev. SQL transactions rolled each attempt back so both saw exactly the same history.

| Outcome across 40 cases | Without Jev | With Jev |
| ----------------------- | ----------: | -------: |
| Correct restores        |           8 |        6 |
| Wrong restores          |           5 |        2 |
| New IDs / no restore    |          27 |       32 |

Jev reduced false restores but also missed two additional returning browsers. All wrong restores in this small sample were first observations incorrectly attached to another browser. Jev did not make recovery reliable enough for account identity.

This is a **single-visit recovery test with known prior history**. It differs from the full chronological replay above, where every cookie is missing and earlier mistakes change later history. These forty results must not be extrapolated to all 15,000 observations. Lookup planning was disabled; the test exercised Jev's candidate-batch evaluation and ordinary first-visit risk path, with all identity sanity checks retained.

### Automation from aggregate behavior

Eighty cases came from the existing FP-Agent test folds: forty human sessions and forty agent sessions balanced across the seven families. Selection was fixed before any Jev answers. The local classifier used its previously selected validation threshold; Jev used the example automation threshold of 0.85.

| Measure             | Local classifier | Raw Jev automation score |
| ------------------- | ---------------: | -----------------------: |
| Cases scored        |          55 / 80 |                  80 / 80 |
| Agents detected     |          17 / 40 |                   0 / 40 |
| Human false alerts  |           3 / 40 |                   0 / 40 |
| AUC on scored cases |            0.907 |                    0.341 |

The local classifier abstains when its required feature coverage is missing. Jev returns a number even for sparse inputs, so the AUC columns cover different subsets. Both detection and false-alert counts include all forty cases of each class.

Jev's automation answers ranged from 0.16 to 0.25, with a median of 0.20 for both classes. Zero false alerts here came with zero detections. These inputs contain only the five numeric behavior summaries; they do not include webdriver, browser/device observations, server request patterns or authenticated agent credentials. The existing prompt treats behavior alone as weak evidence. This result does not validate raw Jev automation scoring for this input, and it does not evaluate the richer production input or a trained combination of Jev features and numeric features.

The same requests also collected the four existing atomic Jev feature judgments. Those answers remain in the private cache for inspection; no downstream classifier was fitted or selected on these eighty test cases. The next experiment should develop that combination on a separate training set and reserve fresh cases for final testing.

### Budget, latency and reproduction

The 120 cases required **103 unique requests**, with seventeen local cache hits and no provider failures or retries. Responses reported 267,602 input tokens and 14,542 output tokens. At [TypeSafe's published input price](https://docs.typesafe.ai/models), the input-token estimate is about **$0.0112**; this is a rate-based estimate, not a reconciled Cloudflare charge.

Measured provider round-trip latency was **520 ms median**, **633 ms p95**, and **2,830 ms maximum**. One request exceeded both the Cloudflare evaluator's normal 1,000 ms timeout and the engine's 1,200 ms deadline. This quality experiment deliberately allowed 20 seconds at the engine and 15 seconds at the transport. It does not measure normal-deadline availability, full application latency or concurrent capacity.

The transport uses the [documented Cloudflare request](https://developers.cloudflare.com/ai/models/typesafe/jev/): `POST /accounts/{accountId}/ai/run` with `{ model: "typesafe/jev", input: { state, questions } }`. It validates the returned model version and bounded typed answers. Per-request headers disable gateway logging, payload logging, provider caching and automatic retries. Provider data-handling terms still apply.

After running the two underlying benchmarks, `pnpm benchmark:jev` replays only cached answers and fails on any cache miss. To explicitly permit new requests, configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, then run:

```sh
pnpm benchmark:jev --live --max-calls 120
```

The allowance is cumulative in the local ledger, capped at 120 attempts, and failures consume an attempt. Exclusive ledger ownership prevents competing processes; request bodies are capped at 32 KiB. Keep the ledger when restarting. The ordinary test suite mocks this transport and cannot spend credits. The research pilot has its own allowance and does not change the playground or learning-service budgets.

[Download the aggregate Jev report](benchmarks/external-jev-2026-09-23.json).

## Agents: useful timing, incomplete coverage

[FP-Agent](https://github.com/ethanbwang/fp-agent) provides recordings of humans and seven browsing-agent families performing controlled website tasks. We evaluated the raw release linked by the authors. Its 7,728 sessions differ slightly from the separately published, precomputed feature-vector file; we do not mix the two releases.

We discard request headers, IP information, typed content, key values, selectors and URLs from the projected data. Pointer positions are converted locally into movement deltas, then passed through Janitor's production aggregate collector and feature extraction. Only five existing numeric features are eligible: mouse speed, turn ratio, pause ratio, mean interaction interval and interval variation.

This is a replay approximation: the source records absolute cursor positions instead of native `movementX`/`movementY`, and a study task can span pages. The importer resets transient motion/timing state on recorded clock resets. It does not invent server API timing from client telemetry batches. No new browser signals were added to Janitor for this benchmark.

We compare logistic regression and small boosted trees using the shared offline trainer, then check their predictions against Janitor's TypeScript scorer. Features and scaling are chosen using fitting data only. Separate groups are used for calibration, model/threshold selection and final testing. Sessions with insufficient evidence remain in the test denominators as abstentions.

For the first experiment, each agent family is held out completely in turn. Linked human browser identifiers stay together; other agent sessions are grouped by their published source run. The final test contains the held-out agent and the same 68 human sessions in each fold.

| Held-out agent | Agent sessions scored | Agents detected, including abstentions | Human false alerts | AUC on scored sessions |
| -------------- | --------------------: | -------------------------------------: | -----------------: | ---------------------: |
| Atlas          |                 61.2% |                                  59.9% |             2 / 68 |                  0.997 |
| Browser Use    |                 99.1% |                                  58.2% |            10 / 68 |                  0.849 |
| ChatGPT Agent  |                 41.7% |                                  29.6% |            10 / 68 |                  0.921 |
| Claude         |                 42.1% |                                  16.7% |             2 / 68 |                  0.964 |
| Comet          |                 35.3% |                                  35.1% |             2 / 68 |                  0.997 |
| Manus          |                 69.1% |                                  64.1% |            10 / 68 |                  0.972 |
| Skyvern        |                  100% |                                  34.6% |             1 / 68 |                  0.932 |

All selected models use the two interaction-timing features. Mouse features lack sufficient coverage across agent families to pass the preset training coverage rule. That is a finding about this dataset and collection, not proof that mouse behavior is useless.

AUC measures how well scores rank the two classes; 0.5 is chance. It is calculated only for scored sessions here. Detection rate includes unscored agent sessions, while the false-alert denominator includes all test humans. Thresholds targeted at most 2% human false alerts on validation data did **not** consistently achieve that on the held-out humans: observed rates range from 1.5% to 14.7%.

Do not interpret high precision from this agent-heavy sample as precision on ordinary application traffic. The human sample is small, and the same humans are reused across folds. Those seven results are not seven independent human populations.

### A separate environment check

The second experiment joins sessions connected by a browser identifier, source run or reported browser configuration. Seven folds each hold out one component containing agents. There is no overlap of those groups or reported configurations between fitting, calibration, validation and test.

Across these folds, agent detection ranges from **29.4% to 90.2%**, with **0–5.1% observed human false alerts** and scored-session AUC of **0.921–0.993**. The report includes every fold and its denominators. Zero observed alerts in a small sample does not establish a zero false-positive rate.

This is configuration separation, not verified physical-device separation. The release provides browser identifiers rather than independently verified human participant IDs. The importer finds 60 linked human browser groups; that is not a count of people. We cannot claim participant-disjoint or physical-host-disjoint evaluation from these labels. Agent-family and environment holdouts are separate experiments, not a simultaneous guarantee.

[Download the aggregate agent report](benchmarks/external-fpagent-2026-09-23.json).

## Mouse behavior: supporting evidence

The [Balabit Mouse Dynamics Challenge](https://github.com/balabit/Mouse-Dynamics-Challenge) contains real remote-desktop mouse recordings for ten owners. Its simulated impostor sessions are recordings from other legitimate users assigned to an account. They are not recordings of actual account takeovers or malicious behavior.

We derive Janitor's five aggregate behavior features using the recorded client clock. Each owner's training recordings establish a median and standard deviation. Test recordings receive an anomaly score based on their standardized distance from that owner's baseline. This is a research baseline, not a deployed Janitor ownership classifier.

The 816 labeled test recordings contain 405 simulated impostors and 411 owner sessions. Of those, 799 contain enough evidence to score. The pooled AUC is **0.668**, indicating modest separation. There are only five to seven training recordings per owner, so we do not claim a reliable calibrated detection threshold.

This supports testing behavior as one input alongside authenticated history and server evidence. It does not justify silently merging people, identifying a family member, or declaring an account hacked.

[Download the aggregate behavior report](benchmarks/external-balabit-2026-09-23.json).

## Reproduce the evaluations

Use Node 22.12+, pnpm and Python 3.12. The Python dependencies are confined to an offline training environment.

```sh
pnpm install --frozen-lockfile
python3.12 -m venv tools/classifier/.venv
tools/classifier/.venv/bin/python -m pip install -r tools/classifier/requirements.txt

# About 4.45 GB of downloads. Allow at least 7 GB of free space.
pnpm benchmark:external:download all
pnpm benchmark:external all
```

Replace `all` with `fpstalker`, `fpagent` or `balabit` for a single source. Set `CLASSIFIER_PYTHON` to use another compatible Python interpreter. After activating the virtual environment, `pnpm test:external` runs the importer and evaluation tests without downloading data.

The downloader pins author URLs, repository revisions, sizes and SHA-256 checksums. It refuses changed files. Inputs and intermediate files stay in the Git-ignored `artifacts/external/` directory. The importer parses SQL as data; it never executes the research dump or loads the authors' model files. Python model predictions must agree with the production TypeScript scorer within `1e-7` before the agent report is accepted.

Only aggregate reports are published. Row identifiers, raw datasets, event recordings and fitted model parameters remain local. Downloaded research files include personal or potentially identifying fields even though the projection excludes them; treat the directory accordingly and delete it when no longer needed. The recorded source revision in each report identifies the benchmark implementation used.

## What this changes for Janitor

Keep useful behavioral collection optional and aggregate: movement dynamics, interaction intervals and server-owned API summaries. Combine it with explicit agent credentials and authenticated actions. An endpoint name, regular timing, absence of mouse movement, or a model score alone cannot prove authorization or malicious intent.

The next evaluation needs an independently labeled panel with verified participants, devices, accessibility usage, touch input and authorized agents, followed over time. Revisit recovery rules using a separate development set, then test once against a fresh held-out population. These published test sets must not quietly become the tuning target.

The Jev comparison above is a small research pilot, not production model training. Its explicit live command transfers compact projected measurements to the provider; raw recordings and evaluation labels remain local. The separate budgeted Jev training path is for opted-in, independently labeled application sessions. Public research records are not fabricated into tenant contributions. Review source terms and provider handling before reproducing external inference or reusing data for commercial training.

The source repositories' availability is not a blanket commercial training license. FP-Stalker's repository uses AGPL-3.0; we found no separate data license. FP-Agent links an author-shared OSF download without an explicit reusable license in the inspected metadata. Balabit invites research benchmarking and requests attribution but has no explicit license in the inspected repository. No third-party datasets or trained weights are redistributed here. Balabit attribution: Fülöp, Á., Kovács, L., Kurics, T., and Windhager-Pokol, E. (2016), _Balabit Mouse Dynamics Challenge data set_.

## Experimental probe follow-up

The September 23 font/runtime/linked-activity update reran the same public-data pipelines and cache-only Jev pilot (zero new calls). These datasets do not measure local-font probes, notification states, target alignment, trusted JA4 or correlated denied-operation groups, so the replay does not establish their accuracy. [Separate real-browser experiments](EXPERIMENTAL-DETECTION.md) report functional controls, including a separately launched no-CDP Chromium comparison. No detector or classifier was promoted from these results.

## Expanded live Jev and font validation

A separate [expanded validation report](DETECTION-VALIDATION.md) covers the current operator prompt, live API-activity judgments, one-feature controls, controlled browser probes and an audit of FP-Agent font collisions. The current operator prompt did not achieve useful separation in the 80-case panel. The earlier cached pilot and trained-classifier results above remain separate experiments.
