# How browser matching works

Doorman remembers a browser with a cookie and a small history of observations. An observation is a snapshot of the signals the browser makes available, such as its browser family, language and screen size.

## A normal return visit

If a request contains a valid `__visitor` cookie and its history is still retained, Doorman uses that visitor ID immediately. It loads up to five recent observations, assesses current risk if Jev is enabled, and saves the visit. It does not search other visitors.

The result has `isReturning: true` and `confidence: 1`. That confidence means the cookie identifies an existing visitor record. It is not proof of the person using it.

## When the cookie is missing

Doorman looks up a small number of plausible visitors, compares their recent observations, and optionally asks Jev whether the current visit fits each history. The recommended `createDoorman` API always creates a fresh browser ID without a usable cookie. A strong, unambiguous match becomes private `browserMatch` evidence; it never silently merges user analytics.

For example, rotating a phone keeps the same physical screen dimensions. Resizing a window has little effect on matching. A completely different platform is much stronger evidence against a match. Missing WebGL information is treated as missing data rather than a mismatch.

The rest of this page explains how a possible match is scored. The lower-level engine can also restore a browser ID when explicitly configured; the synthetic playground demonstrates that mode. They are deliberately inspectable and still need calibration against independently labeled visits from your application.

## Make observations comparable

Normalization makes ordinary formatting differences comparable. It does not reconstruct values that a browser hides.

Whitespace-only strings become absent. Browser user agents are classified into Chrome, Firefox, Safari, Edge and Opera families, leaving unknown families absent. Raw user agent is retained in normalized JSON but omitted from evaluator state. Browser patch/minor changes do not change family. Platform aliases normalize to iOS, Android, macOS, Windows and Linux (lowercase values); Android/iOS tokens already exposed in the user agent take precedence over generic platform strings. No hidden value is reconstructed. Languages are lowercased, deduplicated and sorted. Timezone spelling is preserved. Graphics strings are trimmed and lowercased. Screen width/height are ordered short-to-long. Viewport comparison also tolerates rotation. Zero/invalid display dimensions and CPU/memory measurements are treated as absent; zero touch points remains a valid capability. Inputs are not mutated.

## Compare available signals

Doorman gives each comparable feature a weight, then averages the results. If either observation is missing a feature, that pair is left out of the comparison. An empty observation scores zero. Compared weight must total at least `0.55` before a perfect score is possible, and the same coverage cap is applied after evaluator blending.

| Feature                    | Weight |
| -------------------------- | -----: |
| Platform                   |   0.18 |
| Browser family             |   0.12 |
| Timezone                   |   0.05 |
| Language set               |   0.07 |
| Physical screen dimensions |   0.14 |
| Viewport dimensions        |   0.02 |
| Hardware concurrency       |   0.10 |
| Device memory              |   0.07 |
| Touch points               |   0.05 |
| WebGL vendor               |   0.07 |
| WebGL renderer             |   0.13 |

Dimensions use the mean ratio of corresponding short and long sides. Other features compare exact normalized values. Color depth and pixel ratio go to the evaluator but are not separate deterministic weights. Automation flags and behavioral summaries belong to the separate risk request; they are excluded from identity evaluation and deterministic matching weights.

All weights live in `SIMILARITY_WEIGHTS`; confidence constants live in `MATCHING_DEFAULTS`. These values are heuristics requiring calibration.

## Look up candidates and choose a match

1. A cookie is accepted only if its opaque ID has retained observations. Unknown/expired cookies fall through to lookup.
2. Cookie hits load at most five recent observations and preserve ID regardless of drift. No global search runs. Risk is freshly evaluated and the observation is saved.
3. Up to six deterministic indexed lookups each return at most 101 retained rows: three selective combinations of platform/browser with screen/hardware, screen/timezone or graphics/timezone, plus three coarse fallbacks. The extra row detects a crowded bucket. Rank the bounded pool by similarity, deduplicate visitor IDs, then keep ten. No usable keys means no search. The recommended API does not use AI lookup planning.
4. Load at most five observations per candidate, in one Postgres query / one D1 batch when supported. Compare the current observation to each; retain the strongest non-contradictory snapshot score. Historical variability is then judged across the entire compact history by Jev.
5. Remove candidates below `0.65` or with no non-contradictory history. Select up to ten by score, then recency and ID for deterministic ties. Jev evaluates them in one batched request with a bounded timeout. A custom evaluator without the batch method retains three individual evaluations.
6. Blend `0.35 * deterministic + 0.65 * sameVisitor`. On evaluator failure, use deterministic similarity alone. Apply evidence caps to either result.
7. Accept a private match only if the selected visitor appeared in at least one unsaturated retrieval bucket, the highest score is at least `0.90` and exceeds the next candidate by at least `0.03`. All competing candidates also participate in ambiguity checking using their deterministic scores, so a low AI rating cannot erase an identical deterministic competitor. The recommended API still creates a new 192-bit opaque ID and keeps the match private.
8. Save the observation and touch activity. Risk is taken from the best evaluated candidate's current-only risk judgment; with no plausible candidates, a single history-free evaluation obtains first-visit risk. Failure of that evaluation yields zero risk. No risk score enters identity decisions.

A different normalized platform is treated as a contradiction. A screen similarity below `0.55` together with different touch capabilities or graphics vendor is also contradictory. Such pairs cannot reach restore confidence (`0.5` maximum) and are filtered before identity evaluation. A driver/vendor change alone is not sufficient for rejection. Cookie continuity remains authoritative even when these signals differ.

`confidence: 1` for cookie continuity and `0` for a newly assigned ID have deliberately distinct meanings. Possible historical matches carry a separate private `browserMatch.score`. Do not read a new ID's zero as high risk. No-match confidence does not claim certainty that the browser has never visited.

## Practical limits

Generic WebGL strings, shared screen sizes and identical browser configurations reduce distinguishability. Two people can use the same browser; one person can use several browsers. A guessed or copied visitor cookie can impersonate continuity. Client measurements and aggregate counts can be forged. Never authorize accounts, recover passwords, or move private data based on visitor ID or risk alone.

The lookup window deliberately trades recall for bounded database work. A matching older device outside every indexed bucket's 101-row window may still be missed. Selective probes improve recall, but this is bounded retrieval rather than an exhaustive nearest-neighbor search. Saturation abstention favors false-merge avoidance. See [scale evidence](SCALING.md). Five snapshots cannot represent every change. Expired history is intentionally unusable. Simultaneous requests across tabs may race to create different IDs; no distributed lock is included.

A missing-cookie Jev request uses an identity batch and a separate current-only risk call. A cookie request uses the identity/risk pair. Automation, behavior and runtime probes never enter the identity request. Optional learning can add one cross-device call. A Workers AI timeout stops waiting but the binding does not expose cancellation; upstream inference may finish and incur usage. Direct fetch uses an abort signal, including during response-body consumption. Failed batches do not trigger individual retries. All stages use the configured shared inference budget.

## Test matching on your traffic

Use consented, independently labeled returning-browser visits with deliberate cookie deletion, browser/OS updates, resizing, timezone drift and privacy settings. Include distinct browsers with the same common configuration. Compare deterministic-only against AI-assisted operation on the same held-out visits. Measure false candidate links, missed matches, ambiguity frequency, latency, evaluator failure rates and calls per visit. For risk, label actual automation and ordinary humans, including mobile/touch, keyboard-only and privacy-focused usage. Measure false positives before choosing any CAPTCHA threshold.

Do not use this library's inferred IDs as its own ground-truth labels. Tune weights/thresholds using held-out data and favor avoiding false merges. The repository's synthetic/mocked tests cannot validate Jev's actual probability calibration or risk accuracy.

## Configurable scoring and activity features

See [scoring configuration](SCORING.md) for server-side identity weights and operator thresholds, and [agent classification](AGENT-CLASSIFICATION.md) for optional aggregate movement/timing evidence. These are current TypeScript source features; defaults and private-score behavior are retained.
