# Historical validation records

## v0.9.0 API activity, integrations and language support — 2026-09-23

- Optional API activity middleware for Web/Node and Phoenix; atomic bounded aggregates, private Jev evaluation, cached results, shared budgets and explicit erasure. Migration 0008 adds two small tables.
- Added browser/server Amplitude and RudderStack bridges, native Elixir exports, and scalar JSONL warehouse exports with Snowflake/BigQuery loading guides. New provider SDKs are test dependencies only.
- Added stateless Python and Go HTTP clients, real transport tests, Flask and Go examples. Native matching remains TypeScript/Elixir; clients never forward private scores to the browser.
- Validation: 277 TypeScript tests, 66 Elixir tests, two Phoenix tests, six Python tests plus Flask smoke checks, four Go test groups with race detection, three end-to-end browser tests and seventeen site tests. Next.js and Cloudflare example builds pass.
- The website now uses the short OG headline, keeps the agentic-era message lower on the page, supports light/dark palettes and matching icons, and flavors setup/API docs through a global language selector. All four documentation link/anchor sets are checked.
- All new external inference and analytics checks use mocks or intercepted transports. No customer data was exported, no new paid Jev call was made, and no warehouse ingestion was run. The shared learning service is a proposal, not an active collector.

## v0.8.1 live playground and Cloudflare transport — 2026-09-23

- The public site now hosts an explicit opt-in endpoint backed by the actual Janitor collectors, core, HTTP handler and a dedicated Cloudflare D1 database. Ordinary page views and the original synthetic examples remain local and do not collect browser data.
- Sixteen new real-D1 tests cover ownership, caching, competing budget claims, timeouts, billing rejection, the kill switch, retention, private responses and erasure. Four evaluator regressions cover the live Cloudflare envelope. The TypeScript suite passed 243 tests; fifteen site browser tests and strict typechecking/lint passed. The static build produces 32 HTML pages.
- Hosted Chromium verified first visits, cookie continuity, recovery after removing the visitor cookie, private scores, mobile layout and erasure. Database counts confirmed the smoke sessions, observations and cached rows were erased while aggregate spending counters remained. The separate signed ownership cookie stays during the recovery experiment; this does not establish recovery after all cookies disappear.
- The documented local migrations and HTTPS Wrangler boot command also passed the browser smoke flow with local D1 and inference disabled.
- All seven v0.8.1 archives passed isolated npm, pnpm and Bun installations, factory imports and a wrapped Jev evaluation. The native Hex-format archive builds. Package versions advance together; the Elixir implementation is unchanged in this patch. Registry publication remains separate.
- Cloudflare initially rejected inference with error 2021 (insufficient balance). The owner then purchased $10 of credits, verified as a paid $10.50 invoice with auto-top-up off. A fixed synthetic probe exposed the `{ state: "Completed", result: { answers, usage, model } }` transport envelope; the adapter and cache now validate its contents while rejecting pending or failed envelopes.
- A subsequent hosted browser flow returned evaluation sources `jev`, `jev`, `cache`, `jev`; cookie recovery and erasure passed. This establishes real provider integration and an actual cache hit. Competing budget-claim tests still use mocked inference against real D1 SQL.
- The pilot has a persistent ceiling of 100 model-call reservations and 20 per UTC day, counting failures. This is a call allowance, not a dollar-denominated cap on Cloudflare's invoice. Nine reservations had been consumed after the successful hosted flow, including failed and fixed diagnostic probes. No real-user accuracy or throughput claim follows from this demo.

## v0.8.0 Jev intelligence and unified identity — 2026-09-23

- TypeScript strict typechecking, lint and 223 tests in thirteen files pass. Real SQL covers D1/Postgres learning defaults, namespace isolation and inference quotas across all Jev methods.
- Native Elixir: 52 Postgres-backed tests pass, including automatic Jev learning and private Plug assigns. The migration adds language/timezone learning indexes; Hex-format packaging includes the shared questions and browser module.
- Two Chromium integration tests pass with real PostHog/Mixpanel SDKs and intercepted local delivery, including the unified Janitor client. Thirteen site browser tests and Astro checks pass.
- Fresh npm, pnpm and Bun consumers install all seven v0.8.0 tarballs and import the new client, three evaluator capabilities and migration 0007.
- No paid provider inference or live analytics ingestion was used. Prediction accuracy and production performance of the additional stages remain unmeasured. Earlier capacity benchmarks below describe their original versions.

## v0.7.0 release verification — 2026-09-23

- The functional changes and site redesign passed [GitHub CI](https://github.com/Holy-Coders/janitor/actions/runs/35842422160), including TypeScript, native Elixir/Postgres, Phoenix, browser integration, example builds and website tests.
- Local release checks passed: 204 TypeScript tests, typecheck, lint, 11 website browser tests and Astro diagnostics with no errors or warnings. The site builds 29 HTML pages.
- All seven v0.7.0 JavaScript archives installed in isolated npm, pnpm and Bun consumers. Ten public factory/helper exports and the analytics identify/reset lifecycle passed in each. The native v0.7.0 Hex-format archive builds successfully. SHA256 checksums accompany the GitHub assets.
- All ten public GitHub release assets were downloaded successfully; the nine archives match the published SHA256 manifest. The release commit also passed [CI](https://github.com/Holy-Coders/janitor/actions/runs/35842788097).
- The redesigned site is deployed at [janitor.holycoders.io](https://janitor.holycoders.io). Live Chromium checks pass for desktop/mobile rendering, video playback/pause, reduced motion, documentation search, synthetic cookie restoration and agent delegation, with no browser errors, cookies or third-party requests. The site's `no-transform` response header prevents Cloudflare's automatic analytics injection.
- npm publication was attempted and rejected with `EOTP` (authenticator verification required). Hex reports no authenticated account. GitHub archives and the versioned Elixir Git dependency are the installation paths until registry authentication is completed.
- Publication does not imply a production identity endpoint, live analytics ingestion, Open Calls integration, paid inference validation or real-user accuracy calibration.

## v0.7.0 analytics lifecycle and actor reports — 2026-09-23

- Browser `createIdentityAnalytics` coordinates existing PostHog/Mixpanel identify, profile update, account-switch and logout/reset calls without accepting private scores. It preserves the initial anonymous transition and emits the event needed for Mixpanel Simplified ID Merge.
- Server TypeScript and native Elixir exports now include optional account/workspace context and opaque verified subject/actor IDs. Groups are opt-in and attached per event. Server agents can export credential attribution without browser/risk fields. Unknown actors are never converted to humans from a low risk score.
- **204 TypeScript tests across twelve files** and **51 native Elixir tests against local Postgres** pass. Typecheck and lint pass. The real `posthog-js` 1.434.10 and `mixpanel-browser` 2.83.0 SDKs run in Chromium with all analytics traffic intercepted locally: anonymous identity links, second-device login, two users sharing a browser, duplicate auth callbacks, logout and private-score exclusion are checked. Native HTTP export/group/profile payloads use mocked transport. These SDKs are test dependencies only.
- The [integration guide](ANALYTICS.md) includes Phoenix code, browser lifecycle/UX, distinct-actor report definitions, PostHog SQL, Mixpanel report steps and prompts for analytics assistants. Live provider ingestion, profile merging and dashboard queries have not been validated, and Open Calls has not been integrated. The v0.7.0 GitHub release packages these changes; registry publication and application integration are tracked separately.

## v0.7.0 capacity work — 2026-09-23

- Local real-SQL evidence/protection benchmarks completed with one million synthetic events; raw before/after results and index plans are in the [capacity report](CAPACITY.md).
- An eight-process Node HTTP tier sustained 200,000 warmed keep-alive connections through active identity requests, a simultaneous burst and recovery without dropped connections. Overload responses are counted separately from successful identities. Higher-rate repeats expose overload and generator jitter; no production SLA is claimed.
- Added bounded per-handler admission (no request queue), optional sharded global quotas with the same Elixir contract, and type-only activity projections. TypeScript: **196 tests across eleven files**. Native Elixir: **46 tests against Postgres**, including sharded quota invariants and shared HMAC vectors. Typecheck and lint pass.
- The new benchmark sources are included in strict TypeScript checks. Publication, production deployment, paid inference and Open Calls integration remain separate.
- The complete local launcher was also exercised with a reduced 10,000-event dataset and 1,000 initial connections, followed by its full 10,000-connection rate sweep; automatic cleanup removed its containers, network and database volume. Cloudflare's example dry-run build passed. The repeat's overload counts are recorded alongside the initial results.

## Earlier v0.7.0 abuse controls and evidence — 2026-09-23

The current checkout adds the [shared protection and trusted evidence APIs](HARDENING.md). These changes ship in v0.7.0 GitHub artifacts and have not been integrated into Open Calls. Validation is local and uses mocked external inference.

- `pnpm typecheck`, `pnpm test` and `pnpm lint` pass: **191 TypeScript tests across ten files**, including 20 shared-protection and 19 trusted-evidence cases on real Postgres SQL (PGlite) and D1 (Miniflare).
- Native Elixir: **45 tests pass against fresh Postgres 17**, including concurrent quotas, shared inference budgets, one recovery probe, timeout fallback, cookie-history protection, event idempotency, provenance/revocation and cross-language HMAC vectors. `mix format --check-formatted` passes.
- Phoenix: fresh migrations, the idempotent security upgrade and **one endpoint test pass**. New migrations use indexed foreign keys for erasure and namespace-scoped event/link cleanup. No production database was migrated.
- Browser integration: **one Chromium test passes** through Fastify/Postgres, covering first visit, cookie continuity, cookie removal and viewport drift.
- Next.js production build and Cloudflare `deploy --dry-run` pass; no deployment occurs. Website checks pass with **seven Chromium tests**, 27 primary pages at mobile/desktop widths and 28 generated HTML pages including 404.
- Regressions exercise provider timeout bookkeeping before the response, stale completions, duplicate event races, proof reuse across accounts, shared devices, forged browser/forwarded evidence, bounded retention, erasure and the public Node/Vercel/Cloudflare factory composition. New evidence remains private even with public score opt-in.

These are implementation and trust-boundary checks, not a penetration test or fraud-accuracy benchmark. New event queries and database-shared controls have not been measured at production-scale throughput. Compatible fabricated fingerprints and credential theft still require independent authentication and application policy. The release version for these changes is v0.7.0.

## v0.6 baseline validation

The following records the earlier v0.6 validation on 2026-09-23; the checks for v0.7.0 are listed above. Node v23.7.0, pnpm 9.12.0, TypeScript 5.9.3. The repository targets Node 22.12+; CI is configured for Node 22.

| Check                         | Result                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                  | All seven packages compile to ESM and declarations                                                                                                              |
| `pnpm typecheck`              | Packages, test sources and all three example applications pass                                                                                                  |
| `pnpm test`                   | 152 tests pass across eight files                                                                                                                               |
| `pnpm lint`                   | Passes                                                                                                                                                          |
| `pnpm test:e2e`               | Chromium browser integration passes                                                                                                                             |
| Next.js production build      | Passes on Next.js 16.3.6; page and API route produced                                                                                                           |
| Cloudflare build              | Wrangler 4.136.3 `deploy --dry-run` succeeds; no deployment                                                                                                     |
| Local D1 migration            | Applied successfully using Wrangler                                                                                                                             |
| Postgres migration            | Applied against a local Docker Postgres 17 server; second application succeeds without duplication                                                              |
| All three live local examples | Browser identifies, uses HttpOnly cookie, then restores ID after cookies are cleared                                                                            |
| Packed installation           | All seven packages install in an isolated consumer with local pnpm overrides; nine factory exports, SSR-safe browser import and both migration exports verified |

Baseline unit/integration coverage: 30 core cases, 12 browser cases, 15 evaluator cases, 24 HTTP/high-level adapter cases, 16 shared SQL storage contract cases, 18 identity directory/delegation cases, 28 opt-in learning cases across both databases, and 9 credential/receipt/analytics cases. These include the 24 requested behaviors plus ambiguity, sparse/zero-valued evidence, privacy protections, client lifecycle, response validation, request size/origin bounds, independent risk/identity and late evaluator completion.

Storage contract tests execute real SQL using PGlite (embedded Postgres) and Miniflare D1. Core matching is not mocked. Evaluator network calls are mocked against the current official Jev/Workers AI contracts, including 500/429/529 errors, malformed outputs and timeouts.

The automated Chromium case uses the actual browser bundle, Fastify example bridge, core engine, and Postgres adapter with PGlite. It verifies first-visit creation, inaccessible-to-JavaScript HttpOnly cookies, cookie continuity, cookie removal and viewport resizing. Separate manual scripted Chromium checks ran against the local Wrangler Worker, the Next.js production server and Fastify with a real local Postgres server. The two Postgres examples share one local database, so cross-example history is intentionally shared in this check; production applications should isolate their databases/schemas.

The default Cloudflare local command uses `wrangler dev --local` and leaves `JEV_ENABLED=false`, disabling remote evaluation. All tests and example smoke checks use deterministic-only mode or mocked evaluation. No paid direct Jev/Workers AI inference, deployed identity endpoint, npm publication, real-user accuracy benchmark or calibrated bot-detection claim is included. Those require separate credentials, budgets and consented evaluation data. The public documentation site is a separate static deployment; its playground uses synthetic data and no AI calls.

Reproduce the routine checks with:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm exec playwright install chromium
pnpm test:e2e
pnpm --filter @janitor/example-nextjs build
pnpm --filter @janitor/example-cloudflare build
pnpm pack:all
```

Example boot commands and environment variables are in each example's README and the root README.

## v0.6 security and scale validation

- Default HTTP responses contain only `visitorId` and `isReturning`. Regression tests cover private assessments, concurrent request isolation, explicit disclosure, debug gating, malformed browser responses and native Phoenix assigns.
- Result receipts use authenticated JWE encryption. Tests reject tampering, wrong keys, legacy readable JWTs, expired tokens, action/operation mismatches and replay; plaintext scores do not appear in decoded token segments.
- Both SQL backends retrieve older strong candidates through crowded coarse buckets, load bounded histories in a batch, and abstain when all matching probes are saturated. The core also abstains when an evaluator tries to erase an identical deterministic competitor.
- Native Elixir passes 31 tests against Postgres; Phoenix passes its endpoint test. New expression indexes apply on fresh databases and through an idempotent upgrade migration. Cleanup tests exercise bounded pages and expiry.
- A separate local benchmark completed with 2 million visitors / 2 million observations and again with 2 million visitors / 6 million observations. The latter candidate lookup p95 was 6.46 ms. Its deliberately older target was retrieved in 100/100 probes, but the engine abstained on the selected ambiguous example. This is query-scale evidence, **not identity accuracy or a production throughput SLA**. A 10-million-observation attempt exhausted the Docker disk allocation and is not counted as a pass. See [methodology, raw results and plans](SCALING.md).
- No production database was migrated. Cloudflare can now compose the same Postgres storage with Workers AI, and the adapter is tested locally with mocked AI. Real inference, network reputation and account-takeover detection remain unmeasured.
- The public v0.6 bundle installs in fresh consumers using pnpm, npm and Bun. Imports pass in all three; migration exports and an encrypted-receipt round trip pass in the pnpm consumer. The downloaded GitHub bundle matches the tested local SHA256. Registry publication is separate from these artifact installation checks.

## Public website checks

`pnpm site:check` reports zero errors or warnings. The v0.7.0 site passes eleven Chromium tests, including video playback, offscreen pausing, reduced-motion and data-saving no-download behavior, unavailable media and no-JavaScript fallbacks, plus the existing checks: actual synthetic matching, local documentation search, keyboard code tabs and copy controls, all 28 primary pages at mobile and desktop widths, navigation/static assets, live actor/delegation scenarios, and pause/reduced-motion behavior. The current checkout produces 29 HTML pages including the 404 page, a sitemap, and an `llms.txt` index. The v0.7.0 website update includes the hardening and capacity pages. The site makes no third-party browser requests or fingerprint-collection calls.

## Controlled browser dataset

The v0.2 run generated 30 real-browser observations and replayed 78 identity trials using Chromium, Firefox, WebKit and the production Postgres adapter. It measured both successful continuity and a known identical-profile false-match case. See [the complete methodology and results](./BENCHMARKS.md). These historical measurements are separate from the current unit/integration and browser tests; no risk accuracy or Jev inference is claimed.

## Identity directory and delegation

The v0.3 preview adds 18 real-SQL cases, executed against both Postgres (PGlite) and D1 (Miniflare). They cover stable principal registration, immutable kinds, hashed key lookup, concurrent cross-account key conflicts, key removal, unknown actor attribution, person and agent delegation, actor/account/audience/scope mismatches, revocation, expiry before cleanup, cascading erasure, management input limits, and client claims rejected at the HTTP boundary. Browser response validation also covers valid and malformed attribution.

These are functional and trust-boundary tests. They do not establish that a credential is being operated by its physical owner, measure account-takeover detection, or benchmark Jev on human/agent attribution. The application supplies verified credentials and enforces access policy.

## Opt-in learning and review fixes

The v0.4 preview adds 26 real-SQL learning cases across D1 and Postgres: explicit configuration and server permission, strict rejection of client consent claims, pre-login snapshots, frozen verified labels, separation from fuzzy browser restoration, unknown/family/agent exclusions, conflicting account confirmations, consent withdrawal, application scopes, shadow-only outputs, cold starts, malformed/unknown predictions, timeouts, bounded retention and cascading erasure. Risk availability and slow-body deadline coverage are included in the core/browser/HTTP cases above.

These tests use synthetic sessions and verified-context fixtures. No anonymous cross-device accuracy, physical-user identity, real bot detection or automatic Jev training has been measured. The [learning guide](LEARNING.md) describes the evaluation still needed; the [review](REVIEW.md) records the remaining gaps and comparison sources.

## v0.5 native Elixir and integration validation

- Native Elixir: 28 ExUnit tests against Postgres 17, including shared normalization/similarity/HMAC/Jev vectors, restoration, retention, policy choices, verified keys/delegation, shadow-only learning and bounded provider failures.
- Phoenix: endpoint test covers static client/page and CSRF rejection; a real Chromium browser round trip verifies CSRF-bearing POST, cookie continuity and JSON output. The example runs directly on Phoenix/Bandit with Ecto, without a Node identity service.
- TypeScript additions: collection lifecycle, application policy on both SQL backends, provider body bounds, three analytics SDK bridges, JWT agent verification, action/operation receipt integrity and replay, chronological/device holdouts and export revocation.
- Seven documentation UI tests cover the expanded 24-page site at mobile/desktop widths, search, copy, keyboard navigation, labs and reduced motion. The Fastify browser integration also passes.
- Native PostHog/Mixpanel and Jev transport calls are mocked. No real analytics project, Open Calls deployment, paid inference, new native Python/Go/Ruby/PHP engine or real-user accuracy claim is implied by these results.
