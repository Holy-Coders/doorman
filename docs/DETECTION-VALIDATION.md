# What the expanded tests found

We tested the optional detection signals against controlled browsers, public research data and **live Jev** on September 23, 2026. Some results support collecting bounded evidence. They do **not** support claiming that Janitor can reliably identify a particular assistant, count distinct people from behavior, or detect screenshots.

The most important result: **the current Jev operator prompt did not reliably separate humans from agents on our small public-data sample.** Keep inferred operator labels experimental and keep verified account and agent identities separate.

The [full verification summary](benchmarks/full-validation-2026-09-23.json) also covers database and application checks. The [six-million-observation lookup repeat](SCALING.md) completed, while the [200,000-request burst failed twice](CAPACITY.md). Passing application tests does not establish model accuracy or production capacity.

## Live Jev: working integration, limited classification

The expanded panel covers 80 previously selected FP-Agent sessions, 18 browser fixtures, 16 single-feature or combined controls, 14 API-activity scenarios and eight lookup, candidate, cross-device and reference-method checks. Identical requests share a cached response. Across the two stages, we made **120 new provider calls**, all successful, with no automatic retries. The earlier identity/behavior pilot was also replayed from its cache.

We used Cloudflare's documented `typesafe/jev` [REST endpoint](https://developers.cloudflare.com/ai/models/typesafe/jev/), through Janitor's production Workers AI response adapter and shared typed methods. Responses reported `jev-1.13.0`. This exercises real model inference and production parsing; it is not a live test of the separate direct-TypeSafe endpoint or a deployed application's Workers binding.

The call ledger recorded 210,000 input tokens and 7,331 output tokens. Median latency was 556 ms and p95 was 2,504 ms; **20 of 120 calls exceeded 1,200 ms**. The offline experiment allowed 20 seconds at the evaluator layer and 15 seconds at the HTTP layer. Production's shorter deadline can return unavailable/zero-risk fallback instead. Token usage is measured; the provider invoice was not inspected.

### Public-data operator classification

The panel contains 40 publisher-labeled human sessions and 40 agent sessions across seven agent families. It reuses the earlier frozen test selection. Jev receives available aggregate features, without family labels, session identifiers or raw event recordings.

| Measurement                                     |     Result |
| ----------------------------------------------- | ---------: |
| Completed cases                                 |    80 / 80 |
| AUC using the higher assistant/script score     |      0.504 |
| Score range                                     |  0.11–0.31 |
| Agent detections at 0.85                        |     0 / 40 |
| Human false alerts at 0.85                      |     0 / 40 |
| Final operator labels under existing rules      | 80 unknown |
| Cases meeting the existing evidence-volume gate |    60 / 80 |

AUC near 0.5 means this score provided almost no separation in this sample. Zero false alerts is not a success when there are also zero detections. The earlier prompt scored 0.341 AUC on its five-feature input; both the prompt and inputs changed here, so their difference does not isolate a feature improvement. Neither panel establishes population accuracy.

FP-Agent does not supply Janitor's new runtime, permission, target-alignment, focus or decoy probes. Those fields remain missing. Its browser grouping is a proxy, not a verified person label. The stronger supervised behavior-classifier results in the [external-data report](EXTERNAL-BENCHMARKS.md) are a different model and evaluation; they must not be presented as Jev accuracy.

### Linked activity is promising, with false-alert concerns

These are invented server-activity fixtures, not confirmed attacks. The application supplies link confidence; this panel tests Jev's response to that evidence, not whether the link is correct.

| Fixture                                          | Automation | Suspicious |
| ------------------------------------------------ | ---------: | ---------: |
| One successful sensitive action                  |       0.19 |       0.06 |
| High successful request volume                   |       0.65 |       0.07 |
| Verified, delegated agent; successful requests   |       0.88 |       0.08 |
| Local repeated denials                           |       0.59 |       0.58 |
| Related repeated denials; link confidence 0.95   |       0.67 |       0.75 |
| Three overlapping copies of that related history |       0.69 |       0.74 |
| Related successful requests                      |       0.63 |       0.12 |
| Five related requests, two denials               |       0.37 |       0.47 |

The model distinguished authorized automation from suspicious activity and did not multiply the score when the same history appeared three times. However, two denials in five requests produced 0.47 suspicion, and changing link confidence from 0.80 to 0.95 barely changed the score. These results need independently labeled retry, shared-client and incident controls before choosing enforcement thresholds. The library still only returns evidence and scores.

### One-feature controls expose another limitation

Starting from a synthetic consistent browser, the baseline returned automation 0.09 and suspicious 0.10. A failed app-font download returned 0.09 / 0.16, a permission mismatch 0.12 / 0.16, and centered clicks 0.16 / 0.33. Missing all browser signals returned 0.12 / 0.12. These are sensitivity checks, not measured false-positive rates.

Setting `webdriver` alone raised automation to 0.86, as expected, but also raised suspicion to 0.46 and lowered the model's same-browser answer from 0.94 to 0.78 despite unchanged deterministic similarity. Combining experimental probes produced suspicion 0.51. That is evidence of unwanted coupling in the model's judgments. Janitor's deterministic matching and final risk fields are separate, but the evaluator itself is **not demonstrated to keep those concepts independent**. A future evaluator revision needs a separately evaluated identity-only input and stronger benign-automation controls. We did not tune prompts or thresholds to make this panel pass.

## Browser experiments

### CDP and screenshots

Eight fresh Chromium processes, half headed and half headless, ran 128 counterbalanced phases. Each process retained the same launch flags and profile while the CDP client was detached, attached idle, evaluating JavaScript or capturing screenshots. Each condition ran with and without a bounded CPU-load control, twice.

The fixed runtime-marker probe reported **zero markers in every phase**. The screenshot phases captured **193 screenshots with zero focus or visibility changes**. A separate Chromium/Firefox/WebKit fixture captured another 60 screenshots, also with zero focus or visibility changes. This contradicts the claim that ordinary browser screenshots necessarily blink focus.

Descriptor/prototype-loop timings and timer delays are included in the raw report. They are environment-sensitive measurements, not a fitted detector. The detached phase still has a listening debugging port; the older harness additionally launches a browser without CDP. None of these scripted processes is a real-human control. No OS-level screenshot tool, personal browser profile or WhatsApp session was accessed.

### Fonts and permissions

Eighteen fresh contexts across Chromium, Firefox and WebKit varied locale, timezone and viewport. Each engine returned one identical local-font mask across its six contexts. Downloading the fixture's application font increased the loaded-font count without changing the local-font mask, in all 18 contexts. No collector request left the local fixture server.

This demonstrates same-host stability and separation of application fonts from fixed local probes. It does not demonstrate uniqueness: fresh profiles on the same host collide. More devices, operating systems and longitudinal observations are needed before assigning a nonzero default font weight.

Notification permission grants and resets worked as test controls. WebKit reported `Notification.permission = "default"` while its Permissions API reported `"granted"` after an ordinary Playwright permission override. The mismatch therefore cannot establish abuse or a particular assistant.

### Public font data

We also audit FP-Agent's existing FingerprintJS font component. Its font list and DOM measurement method differ from Janitor's fixed local `FontFace` probe. The audit reports session-level collisions and repeated-capture stability, without publishing font names or identifiers. A missing font result remains unknown; an empty measured set is counted separately. Fingerprint-derived grouping cannot serve as independent ground truth for a font-identity test.

Across 7,728 sessions, the 546 human sessions contained only **26 distinct font sets**; 267 shared the most common set. The human session-pair collision rate was 25.46%, including repeat visitors. Every one of the 994 Atlas sessions shared its font set with at least one human session. Some other families had distinctive sets in this dataset, but that can reflect their test machines. It is not a durable brand signature or independent-person accuracy result. There were no repeated within-session font captures for the human group, so the audit cannot establish human longitudinal stability.

## Reproduce

Install dependencies and all three Playwright engines, and prepare the pinned external datasets using the [research instructions](EXTERNAL-BENCHMARKS.md). Then run:

The runtime experiment includes headed Chromium, so it needs a desktop session or an Xvfb display on Linux. All browser pages are isolated local fixtures.

```sh
pnpm benchmark:detection:full
pnpm benchmark:external
pnpm benchmark:external fpagent --extended
pnpm benchmark:external balabit --extended
pnpm benchmark:fonts
pnpm benchmark:jev            # earlier pilot; cache only
pnpm benchmark:jev:full       # expanded panel; cache only
pnpm benchmark:compare
pnpm benchmark:capacity      # isolated local Docker resources
```

To authorize paid expanded-panel calls, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` locally, then run `pnpm benchmark:jev:full --live --max-calls 120`. The private persistent ledger reserves requests before sending, caps them cumulatively at 120, and prevents concurrent writers. A missing cached answer fails closed for the benchmark. Do not delete its ledger to bypass the allowance. The production playground has its own unchanged budget.

The public [expanded Jev report](benchmarks/jev-expanded-2026-09-23.json), [runtime controls](benchmarks/runtime-validation-2026-09-23.json), [font controls](benchmarks/font-validation-2026-09-23.json) and [public-data font audit](benchmarks/font-audit-2026-09-23.json) contain aggregates and limitations. Raw research data, browser captures, credentials and response caches stay untracked. No model was fine-tuned or promoted by this validation.
