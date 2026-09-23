# Validation record

## Unreleased analytics lifecycle and actor reports — 2026-09-23

- Browser `createIdentityAnalytics` coordinates existing PostHog/Mixpanel identify, profile update, account-switch and logout/reset calls without accepting private scores. It preserves the initial anonymous transition and emits the event needed for Mixpanel Simplified ID Merge.
- Server TypeScript and native Elixir exports now include optional account/workspace context and opaque verified subject/actor IDs. Groups are opt-in and attached per event. Server agents can export credential attribution without browser/risk fields. Unknown actors are never converted to humans from a low risk score.
- **204 TypeScript tests across twelve files** and **51 native Elixir tests against local Postgres** pass. Typecheck and lint pass. The real `posthog-js` 1.434.10 and `mixpanel-browser` 2.83.0 SDKs run in Chromium with all analytics traffic intercepted locally: anonymous identity links, second-device login, two users sharing a browser, duplicate auth callbacks, logout and private-score exclusion are checked. Native HTTP export/group/profile payloads use mocked transport. These SDKs are test dependencies only.
- The [integration guide](ANALYTICS.md) includes Phoenix code, browser lifecycle/UX, distinct-actor report definitions, PostHog SQL, Mixpanel report steps and prompts for analytics assistants. Live provider ingestion, profile merging and dashboard queries have not been validated, and Open Calls has not been integrated. Publishing/deployment remain deferred.

## Unreleased capacity work — 2026-09-23

- Local real-SQL evidence/protection benchmarks completed with one million synthetic events; raw before/after results and index plans are in the [capacity report](CAPACITY.md).
- An eight-process Node HTTP tier sustained 200,000 warmed keep-alive connections through active identity requests, a simultaneous burst and recovery without dropped connections. Overload responses are counted separately from successful identities. Higher-rate repeats expose overload and generator jitter; no production SLA is claimed.
- Added bounded per-handler admission (no request queue), optional sharded global quotas with the same Elixir contract, and type-only activity projections. TypeScript: **196 tests across eleven files**. Native Elixir: **46 tests against Postgres**, including sharded quota invariants and shared HMAC vectors. Typecheck and lint pass.
- The new benchmark sources are included in strict TypeScript checks. Publication, production deployment, paid inference and Open Calls integration remain separate.
- The complete local launcher was also exercised with a reduced 10,000-event dataset and 1,000 initial connections, followed by its full 10,000-connection rate sweep; automatic cleanup removed its containers, network and database volume. Cloudflare's example dry-run build passed. The repeat's overload counts are recorded alongside the initial results.

## Previous unreleased abuse controls and evidence — 2026-09-23

The current checkout adds the [shared protection and trusted evidence APIs](HARDENING.md). These changes have not been published or integrated into Open Calls. Validation is local and uses mocked external inference.

- `pnpm typecheck`, `pnpm test` and `pnpm lint` pass: **191 TypeScript tests across ten files**, including 20 shared-protection and 19 trusted-evidence cases on real Postgres SQL (PGlite) and D1 (Miniflare).
- Native Elixir: **45 tests pass against fresh Postgres 17**, including concurrent quotas, shared inference budgets, one recovery probe, timeout fallback, cookie-history protection, event idempotency, provenance/revocation and cross-language HMAC vectors. `mix format --check-formatted` passes.
- Phoenix: fresh migrations, the idempotent security upgrade and **one endpoint test pass**. New migrations use indexed foreign keys for erasure and namespace-scoped event/link cleanup. No production database was migrated.
- Browser integration: **one Chromium test passes** through Fastify/Postgres, covering first visit, cookie continuity, cookie removal and viewport drift.
- Next.js production build and Cloudflare `deploy --dry-run` pass; no deployment occurs. Website checks pass with **seven Chromium tests**, 27 primary pages at mobile/desktop widths and 28 generated HTML pages including 404.
- Regressions exercise provider timeout bookkeeping before the response, stale completions, duplicate event races, proof reuse across accounts, shared devices, forged browser/forwarded evidence, bounded retention, erasure and the public Node/Vercel/Cloudflare factory composition. New evidence remains private even with public score opt-in.

These are implementation and trust-boundary checks, not a penetration test or fraud-accuracy benchmark. New event queries and database-shared controls have not been measured at production-scale throughput. Compatible fabricated fingerprints and credential theft still require independent authentication and application policy. Current package versions remain unchanged pending the separate release step.

## v0.6 baseline validation

The following records the earlier v0.6 validation on 2026-09-23; the checks rerun for the unreleased checkout are listed above. Node v23.7.0, pnpm 9.12.0, TypeScript 5.9.3. The repository targets Node 22.12+; CI is configured for Node 22.

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

`pnpm site:check` reports zero errors or warnings. `pnpm site:test` passes seven Chromium tests: actual synthetic matching, local documentation search, keyboard code tabs and copy controls, all 28 primary pages at mobile and desktop widths, navigation/static assets, live actor/delegation scenarios, and pause/reduced-motion behavior. The current checkout produces 29 HTML pages including the 404 page, a sitemap, and an `llms.txt` index. The new hardening and capacity pages are local and not deployed yet. The site makes no third-party browser requests or fingerprint-collection calls.

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
