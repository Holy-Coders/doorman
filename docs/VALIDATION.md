# Testing and limitations

Doorman’s tests check whether the implementation behaves as documented: matching, cookies, database queries, failure handling and the privacy boundary between browser and server. They do not tell us how accurately Jev detects bots or how often browser recovery will be correct on your traffic.

## What is verified

The current TypeScript suite passes **432 tests across 35 files**, including configurable scoring, stored operator policies, optional font/runtime/permission probes, linked API activity, the classifier, external-data projection and budgeted Jev transport checks. The offline benchmark importer/evaluator adds **eleven Python tests**, including checks that unseen labels cannot change fitting, model selection or thresholds. Strict typechecking and lint pass. Shared storage checks also passed against a real Postgres 17 server and Cloudflare's local D1 runtime. The public site has seventeen browser tests.

The current native Elixir suite passes **76 tests** against a temporary local Postgres 17 database, including the new bounded field validation and font/evaluator projection. Three browser-to-server/analytics integration tests and seventeen public-site browser tests pass. The local experimental probe harness runs Chromium, Firefox and WebKit on one Mac. It checks fixed local-font stability, target/keyboard separation, page-font failure handling, hidden-decoy accessibility-tree exclusion, cleanup and absent APIs. The earlier fifteen-capture screenshot experiment produced zero focus/visibility changes; the expanded run reproduced this across 60 captures and 193 additional controlled CDP captures. A separately launched no-CDP Chromium control also completed. Both instrumented and uninstrumented runs exposed zero of the sampled legacy marker names; timings overlap and do not establish a CDP detector. [Report and scope](EXPERIMENTAL-DETECTION.md).

The latest [expanded validation](DETECTION-VALIDATION.md) adds 120 successful live Jev requests, a new public-font audit, 128 controlled CDP phases and 18 browser-context font/permission controls. The new operator prompt scored AUC 0.504 on 80 FP-Agent cases and produced 80 unknown labels. Synthetic linked denied activity raised suspicion, but sparse retries also received elevated scores. These findings do not validate assistant attribution or attacker probabilities. No model was promoted.

The follow-up fixes pass two complete [200,000-connection burst reruns](CAPACITY.md), with 4 GiB server/client caps, zero transport errors or dropped connections, and 100/100 recovery responses in each run. A separate [12-call live Jev regression](DETECTION-VALIDATION.md#identity-and-risk-isolation) verifies that automation and behavior cannot enter the identity-only request. Shared budgets count both calls in the new identity/risk pair. Classifier promotion now requires useful ranking and calibration on both validation and held-out data; no new model has been promoted.

The pilot checks opt-ins, tenant isolation, immutable uploads, independent feedback, disputed labels, bounded discovery, unseen-application holdouts, shadow/canary separation, budgets, cache leases, deadlines, erasure and credential revocation. An actual Fastify/Postgres HTTP service passed enrollment, contribution, the verified-attribution helper and deletion checks. The deployed Cloudflare service passed authentication, contribution, deduplication, erasure and revocation checks. Those smoke tests used generated data, removed it afterward and made **zero paid model calls**. Hosted evaluation and contribution preferences remain disabled for the provisioned pilot participant; no real-user data has been collected for this experiment.

`pnpm benchmark:network` runs discovery on 2,400 generated sessions. It finds a combination of timing and operation-category evidence, while a timing-only rule produces false positives. When generated human sessions mimic the combination, the learned rule fails promotion. This verifies the experiment and rejection behavior; it does not measure real-world accuracy. See [how pattern discovery works](LEARNING-NETWORK.md).

The v0.9.0 implementation passed these checks on September 23, 2026:

| Area                | Evidence                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript library  | 277 tests across sixteen files, strict typechecking and lint.                                                                                                                      |
| Native Elixir       | 66 tests against Postgres, plus two Phoenix endpoint tests.                                                                                                                        |
| Python              | Six transport tests on Python 3.12 and 3.14; wheel installation and Flask route continuity/private-response checks.                                                                |
| Go                  | Four test groups with the race detector on Go 1.26, plus a compiled HTTP example.                                                                                                  |
| Browser integration | Three Chromium tests, including installed PostHog, Mixpanel and Amplitude SDKs with analytics traffic intercepted locally.                                                         |
| Public site         | Seventeen browser tests; language navigation/search, both themes, consent controls, all documentation links/anchors, mobile layout and motion fallbacks. 127 generated HTML pages. |
| Examples            | Next.js production build, Cloudflare dry-run, native Phoenix migration/tests and Python/Go transports pass.                                                                        |
| Installation        | Seven compiled JavaScript packages, native Elixir archive, Python wheel/source archive and Go source module. Registry publication is separate.                                     |

API activity checks use real Postgres and D1 SQL. They cover bounded aggregates, private outputs, leases/cache isolation, provider budgets, deadlines, malformed answers, deletion and repeated service instances. Analytics checks cover Amplitude/RudderStack protocols, account changes, logout and warehouse field projection. Warehouse SQL is documented against official provider contracts, but has not been executed in a paid Snowflake or BigQuery project. These are implementation checks, not evidence of bot-detection accuracy or API telemetry throughput at production scale.

The database contract tests execute real SQL using embedded Postgres (PGlite) and Cloudflare’s local D1 runtime (Miniflare). Core matching is not mocked. External Jev and analytics responses are mocked or intercepted so automated tests do not make paid inference calls or send test users to analytics projects.

Earlier checks cover bounded lookup planning, ten-candidate batch matching, cold-start/ambiguity abstention, private Jev learning on both databases, shared inference budgets and asynchronous analytics logout races. The real SDK integration also exercises `createDoormanClient` events and identity transitions. External inference remains mocked; these checks establish implementation behavior, not cross-device or bot-detection accuracy.

The earlier September 23 live playground follow-up passed **243 TypeScript tests and 15 site browser tests**. New real-D1 checks cover session isolation, atomic call allowances, cache hits, erasure, billing rejection and the inference kill switch. The site produces 32 HTML pages, with navigation and internal documentation links checked in Chromium.

The deployed [live playground](PLAYGROUND.md) passed real browser cookie continuity, controlled cookie-loss recovery, private-response, mobile-layout and erasure checks. After funding Cloudflare inference, a hosted flow received fresh Jev evaluations, reused a private cached answer without another model call, and restored its visitor cookie. The live response exposed a Cloudflare `Completed` envelope absent from the model documentation example; regression tests now cover it. The documented local HTTPS Worker flow also passed with local D1 and AI disabled.

See the [latest CI runs](https://github.com/Holy-Coders/doorman/actions) and [detailed dated records](VALIDATION-HISTORY.md) for exact commands, environments and historical counts.

## What the benchmarks show

The benchmarks answer different questions. Keep their results separate:

| Benchmark                                          | What it tests                                                                                  | What it does not establish                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Controlled browser visits](BENCHMARKS.md)         | Browser signals and recovery after controlled changes.                                         | Accuracy across a representative real-user population.                                                          |
| [Public research datasets](EXTERNAL-BENCHMARKS.md) | Historical browser recovery, agent-family/configuration holdouts and aggregate owner behavior. | Reliable cookie-loss identity, participant-disjoint agent accuracy, cross-device ownership or malicious intent. |
| [Millions of stored observations](SCALING.md)      | Indexed candidate lookup and history-read latency.                                             | Sustained production throughput or correct person identity.                                                     |
| [Connection and workload tests](CAPACITY.md)       | Open connections, successful responses, overload and recovery.                                 | 200,000 simultaneous successful identifications or real Jev capacity.                                           |

The controlled browser experiment includes a false match between indistinguishable profiles. The external identity replay found 2,303 wrong restores and 1,258 correct restores; the behavioral studies have coverage gaps and false alerts. The connection experiment includes controlled `503` overload responses. Those are part of the findings, not successes hidden inside headline counts.

A separate [real Jev pilot](EXTERNAL-BENCHMARKS.md#what-real-jev-calls-added) completed 120 cases with 103 unique provider requests and seventeen cache hits. In forty cookie-recovery trials, wrong restores fell from five to two, while correct restores fell from eight to six. With only aggregate behavior as input, the raw Jev automation score detected none of forty agents at the preset 0.85 threshold and flagged no humans. Median provider latency was 520 ms, p95 was 633 ms, and one request exceeded the ordinary timeout. This is a small quality experiment with a longer offline deadline, not proof of deployment accuracy or load capacity.

The [detection-update comparison](EXTERNAL-BENCHMARKS.md#new-detection-features-measured-comparison) reran FP-Stalker, FP-Agent and Balabit with baseline and expanded feature sets. Native Python and production TypeScript predictions agreed in 216,384 checks per FP-Agent variant. The richer timing models reduced false alerts across the family folds, but recall regressed for two families. Balabit anomaly AUC increased from 0.668 to 0.758. The Jev replay used cached provider answers and zero fresh calls; it does not evaluate the new `operators-v2` prompt. That earlier report covered the smaller site and previous prompt. The expanded validation now evaluates `operators-v3` with real inference; its results are reported separately above.

## What still needs real-world testing

Before using a score to trigger extra verification, test with independently labeled traffic from your application. Include ordinary browser updates, common identical device profiles, privacy browsers, accessibility tools, touch-only users, authorized agents and actual automation.

Measure at least:

- **False matches:** distinct browsers incorrectly assigned the same ID.
- **Missed matches:** a returning browser assigned a new ID.
- **False risk alerts:** ordinary activity flagged by your chosen threshold.
- **Abstention and availability:** how often Doorman cannot make a useful match or risk assessment.
- **Latency and cost:** the complete request path, including your database and actual AI provider.

Compare built-in matching with AI-assisted matching on the same held-out visits. Do not use Doorman’s own guessed IDs as the truth labels. Anonymous cross-device prediction needs a separate evaluation; see [testing a learning model](EVALUATION.md).

## Run the checks yourself

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm exec playwright install chromium
pnpm test:e2e
pnpm site:check
pnpm site:test
```

The [Elixir guide](../packages/elixir/README.md) explains its Postgres test setup. Each framework example has its own build and run instructions.

## What is published

Doorman v0.13.0 is published as eight `@aarondovturkel/doorman-*` packages on npm and [`doorman_identity`](https://hex.pm/packages/doorman_identity/0.13.0) on Hex, with [HexDocs](https://hexdocs.pm/doorman_identity/0.13.0/). The repository is [Holy-Coders/doorman](https://github.com/Holy-Coders/doorman).

A clean consumer installed all eight 0.13.0 packages from npm and imported all 21 public ESM entrypoints. A separate clean Mix project fetched 0.13.0 from Hex and compiled it. Both registry installations passed automatic table setup, authenticated and remembered account context, private browser responses and user deletion against Postgres 17. The npm release files match the prepared archive checksums.

The release passed 432 TypeScript tests, 76 native Elixir tests, two Phoenix endpoint tests, three browser/analytics integration tests and 17 site browser tests, plus strict typechecking and lint. These packaging and behavior checks do not improve or validate the experimental model's accuracy. Follow the [installation instructions](LANGUAGES.md).
