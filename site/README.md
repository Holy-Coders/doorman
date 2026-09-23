# Doorman public website

The home, searchable docs, local examples and opt-in live playground at https://doorman.holycoders.io. Astro builds static pages. The existing `janitor-docs` Worker (its existing resource name is retained) handles `/api/playground/*` and hourly cleanup; other requests use static assets. The legacy `janitor.holycoders.io` domain redirects to the corresponding Doorman URL, preserving the path and query.

Ordinary page views and local examples collect nothing. The activated live demo uses Doorman's collectors, HTTP handler, real matching engine, D1 storage, request controls and Jev evaluator. Its session-scoped wrapper is in `worker/`. See [playground behavior and privacy](../docs/PLAYGROUND.md).

## Local development

From the repository root, with Node 22.12+ and pnpm 9:

```sh
pnpm install
pnpm build
pnpm site:dev                   # Static pages and local examples
```

For the local Worker and database:

```sh
cp site/.dev.vars.example site/.dev.vars
pnpm --filter @aarondovturkel/doorman-site migrate:local
pnpm --filter @aarondovturkel/doorman-site run dev:live --local-protocol https
```

Wrangler prints the URL. Use HTTPS because demo cookies are always Secure. The example variables disable Jev so local development makes no paid inference calls. The API works with deterministic fallback. Vitest supplies a fake AI binding while executing real D1 SQL and matching.

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm site:check
pnpm site:test
pnpm site:build
pnpm --filter @aarondovturkel/doorman-site exec wrangler deploy --dry-run
```

## Deploy

`wrangler.jsonc` uses the dedicated `janitor-playground` D1 database. Apply the nine library migrations plus `worker/schema.sql` for demo sessions, ownership, cached answers and budgets. The schema is idempotent; there is no request-time table creation.

```sh
pnpm --filter @aarondovturkel/doorman-site exec wrangler whoami
pnpm --filter @aarondovturkel/doorman-site migrate:remote
# Once, enter a dedicated random secret of at least 32 characters when prompted:
pnpm --filter @aarondovturkel/doorman-site exec wrangler secret put PLAYGROUND_SECRET
pnpm --filter @aarondovturkel/doorman-site run deploy
```

Do not rotate the secret on every deploy: it signs sessions and namespaces shared request protections. Rotation invalidates session cookies, but the independent D1 lifetime inference counter remains intact. Preserve the database and its budget table between deploys.

`JEV_ENABLED=true` attempts the documented Workers AI `typesafe/jev` binding. That model must actually be available to the account. Failures show as unavailable AI while deterministic matching continues. No alternative paid model is selected automatically.

The deployed pilot uses `JEV_ENABLED=true`. Its initial probe returned error 2021 (insufficient balance); after the owner purchased $10 of credits, live evaluations, a cache hit and cookie recovery passed on September 23, 2026. Auto-top-up was verified off. The existing D1 budget remains intact. If the balance runs out, the endpoint falls back rather than purchasing more credits.

Calls use the account's `default` gateway with per-request `collectLog: false`, `skipCache: true` and `retries.maxAttempts: 1`. These prevent storing prompts in Gateway logs/cache or amplifying one Doorman reservation into multiple provider attempts. Other applications' gateway settings are unchanged.

## Budget and emergency stop

`worker/budget.ts` owns the pilot limits: 100 total call reservations, 20 per UTC day, 24-hour cache, 16-KiB model input and a 2.5-second provider deadline. Failed attempts remain charged. The lifetime limit does not renew. Identical concurrent misses share a database claim; only the winner may call the provider.

Inspect counters without reading browser observations:

```sh
pnpm --filter @aarondovturkel/doorman-site exec wrangler d1 execute VISITORS --remote \
  --command "SELECT id,used FROM playground_budget ORDER BY id"
```

To stop model calls immediately:

```sh
pnpm --filter @aarondovturkel/doorman-site exec wrangler deploy --var JEV_ENABLED:false
```

Then set `JEV_ENABLED` to `false` in `wrangler.jsonc` so it stays off at the next regular deploy. The live endpoint continues deterministic matching. Raise `DEMO_LIMITS.totalCalls` only as a deliberate new allowance; never delete/reset `lifetime-v1` to refill it silently. There is no public admin route.

These controls cap model-call starts, not the invoice or total Cloudflare charges. Verify Cloudflare's current Jev price before authorizing a larger pilot. Model availability and pricing are separate from the Workers AI generic free allocation.

## Retention and ownership

Signed sessions last 24 hours. Candidate searches see only the session's own five browser IDs. A fuzzy match never grants access to another person's history. Erasure deletes owned visitors and observations, cached answers and the session, while retaining aggregate budgets. Hourly cleanup removes expired sessions even if nobody returns.

Numeric scores never enter browser responses or application logs. The private D1 cache stores typed answers under HMAC keys and expires with its session. Cross-device learning and analytics-provider forwarding are off on this site.

## Documentation and assets

`src/docs.json` maps docs navigation to source files. Edit those originals; generated copies and the search index are ignored by Git. Storage docs live in `content/storage.md`.

Keep `Cache-Control: no-transform` in `public/_headers`: it prevents Cloudflare's automatic Web Analytics injection. This is the [documented opt-out](https://developers.cloudflare.com/web-analytics/get-started/). Live API responses separately use `private, no-store`.

## Visual assets

The hero uses a local canvas animation of four illustrated operators entering one doorway. No input telemetry or network calls are used by this illustration. It pauses offscreen, respects reduced motion and data-saving preferences, and retains an accessible static illustration without canvas or JavaScript. Generated Doorman logo variants are shipped as small PNG icons; the full cream version is downloadable. To regenerate the social card, build and serve the site on port 4357, then run `node site/scripts/render-social.mjs`.
