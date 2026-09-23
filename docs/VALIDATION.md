# Validation record

Validated locally on 2026-09-23. Node v23.7.0, pnpm 9.12.0, TypeScript 5.9.3. The repository targets Node 22.12+; CI is configured for Node 22.

| Check                         | Result                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                  | All seven packages compile to ESM and declarations                                                                                                              |
| `pnpm typecheck`              | Packages, test sources and all three example applications pass                                                                                                  |
| `pnpm test`                   | 73 tests pass across five files                                                                                                                                 |
| `pnpm lint`                   | Passes                                                                                                                                                          |
| `pnpm test:e2e`               | Chromium browser integration passes                                                                                                                             |
| Next.js production build      | Passes on Next.js 16.3.6; page and API route produced                                                                                                           |
| Cloudflare build              | Wrangler 4.136.3 `deploy --dry-run` succeeds; no deployment                                                                                                     |
| Local D1 migration            | Applied successfully using Wrangler                                                                                                                             |
| Postgres migration            | Applied against a local Docker Postgres 17 server; second application succeeds without duplication                                                              |
| All three live local examples | Browser identifies, uses HttpOnly cookie, then restores ID after cookies are cleared                                                                            |
| Packed installation           | All seven packages install in an isolated consumer with local pnpm overrides; nine factory exports, SSR-safe browser import and both migration exports verified |

Unit/integration coverage: 27 core cases, 6 browser cases, 14 evaluator cases, 16 HTTP/high-level adapter cases, 10 shared SQL storage contract cases. These include the 24 requested behaviors plus ambiguity, sparse/zero-valued evidence, privacy protections, client lifecycle, response validation, request size/origin bounds, independent risk/identity and late evaluator completion.

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

`pnpm site:check` reports zero errors or warnings. `pnpm site:test` passes five Chromium tests: actual synthetic matching, local documentation search, keyboard code tabs and copy controls, all twelve primary pages at mobile and desktop widths, and navigation/static assets. The site produces thirteen HTML pages, a sitemap, and an `llms.txt` index. It makes no third-party browser requests or fingerprint-collection calls.
