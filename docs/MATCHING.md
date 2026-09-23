# Matching and calibration

The experiment is whether a small history plus deterministic evidence and a narrow classifier can recover useful browser continuity without a fingerprinting platform. This repository implements the mechanism and tests its invariants. It does not establish real-world accuracy, unique device identification, or bot-detection quality.

## Normalization

Whitespace-only strings become absent. Browser user agents are classified into Chrome, Firefox, Safari, Edge and Opera families, leaving unknown families absent. Raw user agent is retained in normalized JSON but omitted from evaluator state. Browser patch/minor changes do not change family. Platform aliases normalize to iOS, Android, macOS, Windows and Linux (lowercase values); Android/iOS tokens already exposed in the user agent take precedence over generic platform strings. No hidden value is reconstructed. Languages are lowercased, deduplicated and sorted. Timezone spelling is preserved. Graphics strings are trimmed and lowercased. Screen width/height are ordered short-to-long. Viewport comparison also tolerates rotation. Zero/invalid display dimensions and CPU/memory measurements are treated as absent; zero touch points remains a valid capability. Inputs are not mutated.

## Similarity

Missing pairs are excluded from the denominator; they are not mismatches. An empty observation scores zero. Compared weight must total at least `0.55` before a perfect score is possible, and the same coverage cap is applied after evaluator blending.

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

Dimensions use the mean ratio of corresponding short and long sides. Other features compare exact normalized values. Color depth and pixel ratio go to the evaluator but are not separate deterministic weights. Automation is exposed in the feature explanation and evaluator state but never weighted for identity. Behavioral counts and optional motion/timing summaries are not identity features.

All weights live in `SIMILARITY_WEIGHTS`; confidence constants live in `MATCHING_DEFAULTS`. These values are heuristics requiring calibration.

## Retrieval and decisions

1. A cookie is accepted only if its opaque ID has retained observations. Unknown/expired cookies fall through to lookup.
2. Cookie hits load at most five recent observations and preserve ID regardless of drift. No global search runs. Risk is freshly evaluated and the observation is saved.
3. Without a usable cookie, up to six indexed branches each return at most 101 retained rows: three selective combinations of platform/browser with screen/hardware, screen/timezone or graphics/timezone, plus the three coarse fallbacks. The 101st row detects saturation. Rank this bounded pool by deterministic score, deduplicate visitor IDs, then keep ten. No usable keys means no search.
4. Load at most five observations per candidate, in one Postgres query / one D1 batch when supported. Compare the current observation to each; retain the strongest non-contradictory snapshot score. Historical variability is then judged across the entire compact history by Jev.
5. Remove candidates below `0.65` or with no non-contradictory history. Select at most three by score, then recency and ID for deterministic ties. Evaluate these concurrently, with bounded timeouts.
6. Blend `0.35 * deterministic + 0.65 * sameVisitor`. On per-candidate evaluator failure, use deterministic similarity alone. Apply evidence caps to either result.
7. Restore only if the selected visitor appeared in at least one unsaturated retrieval bucket, the highest score is at least `0.90` and exceeds the next candidate by at least `0.03`. All competing candidates also participate in ambiguity checking using their deterministic scores, so a low AI rating cannot erase an identical deterministic competitor. Otherwise create a new 192-bit opaque ID.
8. Save the observation and touch activity. Risk is taken from the best evaluated candidate's current-only risk judgment; with no plausible candidates, a single history-free evaluation obtains first-visit risk. Failure of that evaluation yields zero risk. No risk score enters identity decisions.

A different normalized platform is treated as a contradiction. A screen similarity below `0.55` together with different touch capabilities or graphics vendor is also contradictory. Such pairs cannot reach restore confidence (`0.5` maximum) and are filtered before identity evaluation. A driver/vendor change alone is not sufficient for rejection. Cookie continuity remains authoritative even when these signals differ.

`confidence: 1` for cookie continuity, a match score for inferred restoration, and `0` for a newly assigned ID have deliberately distinct meanings. Do not read a new ID's zero as high risk. No-match confidence does not claim certainty that the browser has never visited.

## Practical limits

Generic WebGL strings, shared screen sizes and identical browser configurations reduce distinguishability. Two people can use the same browser; one person can use several browsers. A guessed or copied visitor cookie can impersonate continuity. Client measurements and aggregate counts can be forged. Never authorize accounts, recover passwords, or move private data based on visitor ID or risk alone.

The lookup window deliberately trades recall for bounded database work. A matching older device outside every indexed bucket's 101-row window may still be missed. Selective probes improve recall, but this is bounded retrieval rather than an exhaustive nearest-neighbor search. Saturation abstention favors false-merge avoidance. See [scale evidence](SCALING.md). Five snapshots cannot represent every change. Expired history is intentionally unusable. Simultaneous requests across tabs may race to create different IDs; no distributed lock is included.

The three candidates cause at most three model calls per request, including cookie requests (one) and first visits without candidates (one). A Workers AI timeout stops waiting but the binding does not expose a cancellation mechanism here; the upstream inference may finish or incur usage. Direct fetch uses an abort signal, including during response body consumption. Retries are intentionally absent from the request path. Applications should apply their existing endpoint rate limits and operational budgets.

## Evaluate the experiment

Use consented, independently labeled returning-browser visits with deliberate cookie deletion, browser/OS updates, resizing, timezone drift and privacy settings. Include distinct browsers with the same common configuration. Compare deterministic-only against AI-assisted operation on the same held-out visits. Measure false merges, missed restorations, ambiguity frequency, latency, evaluator failure rates and calls per visit. For risk, label actual automation and ordinary humans, including mobile/touch, keyboard-only and privacy-focused usage. Measure false positives before choosing any CAPTCHA threshold.

Do not use this library's inferred IDs as its own ground-truth labels. Tune weights/thresholds using held-out data and favor avoiding false merges. The repository's synthetic/mocked tests cannot validate Jev's actual probability calibration or risk accuracy.
