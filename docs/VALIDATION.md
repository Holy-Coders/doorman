# Validation record

Validated locally on 2026-09-23. Node v23.7.0, pnpm 9.12.0, TypeScript 5.9.3. The repository targets Node 22.12+; CI is configured for Node 22.

| Check                         | Result                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                  | All seven packages compile to ESM and declarations                                                                                                              |
| `pnpm typecheck`              | Packages, test sources and all three example applications pass                                                                                                  |
| `pnpm test`                   | 139 tests pass across eight files                                                                                                                               |
| `pnpm lint`                   | Passes                                                                                                                                                          |
| `pnpm test:e2e`               | Chromium browser integration passes                                                                                                                             |
| Next.js production build      | Passes on Next.js 16.3.6; page and API route produced                                                                                                           |
| Cloudflare build              | Wrangler 4.136.3 `deploy --dry-run` succeeds; no deployment                                                                                                     |
| Local D1 migration            | Applied successfully using Wrangler                                                                                                                             |
| Postgres migration            | Applied against a local Docker Postgres 17 server; second application succeeds without duplication                                                              |
| All three live local examples | Browser identifies, uses HttpOnly cookie, then restores ID after cookies are cleared                                                                            |
| Packed installation           | All seven packages install in an isolated consumer with local pnpm overrides; nine factory exports, SSR-safe browser import and both migration exports verified |

Unit/integration coverage: 28 core cases, 9 browser cases, 14 evaluator cases, 21 HTTP/high-level adapter cases, 10 shared SQL storage contract cases, 18 identity directory/delegation cases, and 26 opt-in learning cases across both databases. These include the 24 requested behaviors plus ambiguity, sparse/zero-valued evidence, privacy protections, client lifecycle, response validation, request size/origin bounds, independent risk/identity and late evaluator completion.

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

## Public website checks

`pnpm site:check` reports zero errors or warnings. `pnpm site:test` passes seven Chromium tests: actual synthetic matching, local documentation search, keyboard code tabs and copy controls, all seventeen primary pages at mobile and desktop widths, navigation/static assets, live actor/delegation scenarios, and pause/reduced-motion behavior. The site produces eighteen HTML pages, a sitemap, and an `llms.txt` index. It makes no third-party browser requests or fingerprint-collection calls.

## Controlled browser dataset

The v0.2 run generated 30 real-browser observations and replayed 78 identity trials using Chromium, Firefox, WebKit and the production Postgres adapter. It measured both successful continuity and a known identical-profile false-match case. See [the complete methodology and results](./BENCHMARKS.md). This is separate from the 139 TypeScript unit/integration and eight browser UI/integration tests; no risk accuracy or Jev inference is claimed.

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
