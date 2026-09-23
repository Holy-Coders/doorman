# Browser benchmarks

This benchmark asks whether Janitor can preserve a browser ID through controlled changes such as a reload, window resize or timezone change. It also tests where recovery fails.

The signals come from real browser engines driven by automation. They do not represent a population of real people. Use the results to reproduce behavior, then evaluate accuracy separately on independently labeled visits from your application.

## Reproduce

```sh
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm benchmark:browser
```

The generator serves the actual browser collector over loopback, launches three real browser engines, and records 30 observations from six isolated contexts. Display dimensions, locale and timezone are Playwright configurations, not measurements from six physical machines. All sessions are automated. It writes local `artifacts/benchmarks/observations.json` and `report.json`; raw observations are ignored by Git and never uploaded or sent to Jev.

Scenarios include reload, scripted mouse/keyboard/wheel interaction, resizing and a timezone change. The timezone scenario recreates a context with copied storage state; it is emulation of travel. No actual browser-version upgrade, mobile hardware, privacy-browser modification or human session is represented.

The identity replay runs the production core engine and Postgres adapter against PGlite, using the real SQL candidate lookup. Each trial starts from freshly seeded ground-truth history, so previous outcomes cannot contaminate later trials. One saved observation per profile is used. Cookies are modeled by supplying the enrolled opaque visitor ID directly to the engine; HTTP cookie handling is covered by the separate Chromium end-to-end test. AI evaluation is disabled, so this tests deterministic fallback, not Jev accuracy or calibration.

## Recorded result: September 23, 2026

Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 on one macOS host. Six logical browser profiles, 30 observations, 78 identity trials. [Machine-readable aggregate results](./benchmarks/browser-2026-09-23.json).

| Trial cohort                                                        | Trials | Correct restorations | Wrong restorations | New IDs |
| ------------------------------------------------------------------- | -----: | -------------------: | -----------------: | ------: |
| One enrolled profile, same profile returning without a cookie       |     24 |                   24 |                  0 |       0 |
| Known cookie, all profiles enrolled                                 |     24 |                   24 |                  0 |       0 |
| All profiles enrolled, identical candidates compete without cookies |     24 |                    0 |                  0 |      24 |
| Unseen profile, only an identical-looking other profile enrolled    |      6 |                    0 |                  6 |       0 |

The last row is a known false-match case under a **browser-profile** definition of identity. The profiles share the same physical host and browser build, so it is not evidence about false matches between different physical machines. It nevertheless demonstrates that equal browser signals cannot distinguish isolated profiles or prove person identity. Confidence near 1 is an algorithm score, not a measured probability of correctness. Raising the threshold cannot distinguish two exactly equal observations.

When multiple equal candidates are already stored, the ambiguity margin avoids choosing between them. When only one is stored, Janitor cannot tell whether an identical observation belongs to a new profile. Do not use this result to advertise 100% recognition. The benchmark deliberately includes this failure instead of averaging it away into one score.

Risk accuracy is **not measured**. All sessions are automated and no human ground truth is present. Risk outputs remain zero because the evaluator is disabled. Extra motion summaries do not by themselves solve identity collisions or establish intent. Cross-device person/account continuity needs [verified account linking](./EXTENSIONS.md).

## Detection-update rerun

The new aggregate collectors were exercised again in all three engines on September 23, 2026. The 78 identity trials reproduced the table above: 24 isolated returns, 24 cookie continuities, 24 ambiguous cases left unmerged, and six incorrect restores of indistinguishable profiles. The benchmark now bundles the actual client and its dependencies before serving it locally.

[Aggregate rerun report](benchmarks/browser-detection-v2-2026-09-23.json). Risk accuracy is still unmeasured in this automated-only fixture. The [expanded public-data comparison](EXTERNAL-BENCHMARKS.md#new-detection-features-measured-comparison) separately measures changes in timing-based detection and mouse-behavior anomaly scoring.

## Public research datasets

Janitor has now run FP-Stalker, FP-Agent and Balabit with its existing signals. The [public dataset report](EXTERNAL-BENCHMARKS.md) documents the projections, held-out groups, source checksums and reproducible commands. The historical cookie-loss replay produced 1,258 correct restores and 2,303 wrong restores. Agent timing features showed useful separation but incomplete coverage and substantial human false positives in some folds. A separate 120-case pilot made 103 real Jev calls: fewer false restores came with more missed restores, and behavior-only automation scores detected no agents at the preset threshold. No research model was promoted to production.

Additional datasets remain candidates:

- [CERTH Web Bot Detection Dataset](https://m4d.iti.gr/web-bot-detection-dataset/) includes human and bot sessions with mouse behavior and web logs. Its stated license is CC BY-NC-SA; check applicability before using it for a commercial benchmark. Raw paths, coordinates and logs would need to be reduced to Janitor's permitted summaries, not added to the library's collection surface.

## What a production evaluation still needs

A consented panel with independently verified browser/device/account labels across multiple days, browser updates, cookie deletion and ordinary device changes. Include different people with common identical devices, shared browsers, privacy settings, touch-only and accessibility usage. Hold out users and later time periods; do not tune thresholds on the final test set.

Report false restoration and correct restoration separately, unknown/new-visitor rejection, ambiguity/abstention rate, candidate recall, risk false-positive rates on humans, and latency/cost. Compare deterministic-only against Jev on the same held-out observations. Synthetic fixtures and AI-generated labels cannot establish real-world human/bot accuracy.
