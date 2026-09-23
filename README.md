# Janitor

<img src="https://janitor.holycoders.io/janitor-logo.png" alt="Janitor pixel-sweep J logo" width="128" />

Durable first-party visitor identity from browser history, with optional Jev-assisted matching and risk scoring.

[Documentation](https://janitor.holycoders.io/docs/getting-started/) · [Interactive playground](https://janitor.holycoders.io/playground/) · [Releases](https://github.com/Holy-Coders/janitor/releases)

Prelaunch developer preview. The API is still evolving.

```ts
import { createVisitorClient } from "@janitor/browser";

const visitor = createVisitorClient({ endpoint: "/api/visitor" });
const identity = await visitor.identify();

// { visitorId: "vis_…", isReturning: true }
// Scores stay on your server by default.

// Remove event listeners when a component unmounts or collection stops.
visitor.destroy();
```

Use the server adapter's `assess(request)` to obtain the full result privately. Return its `response` to the browser; use its `identity` in your server policy. Janitor never decides to block or show a CAPTCHA. See [private scores and action security](docs/SECURITY.md).

```ts
// Server-side result, not the default browser response.
type VisitorIdentity = {
  visitorId: string; // Opaque, random vis_… ID; never a fingerprint hash.
  confidence: number;
  isReturning: boolean;
  risk: { automation: number; suspicious: number };
  riskStatus: "evaluated" | "unavailable" | "disabled";
};
```

The library never blocks a user, changes access, or displays a CAPTCHA. It recognizes browser environments, not people. Matching confidence and risk are experimental scores, not authentication credentials or calibrated guarantees. Two browsers with indistinguishable observations cannot reliably be separated after cookie loss. See [limitations and calibration](docs/MATCHING.md).

## Identity context for the agentic era

Jev evaluates three narrow questions: browser continuity, automation, and suspicious technical signals. The application keeps control of policy. An authorized agent can be automated and legitimate; a low automation score does not prove a human is authorized.

Janitor combines browser identity with a server-side identity directory: verified email/key associations, distinct person and agent principals, and scoped, expiring, revocable delegation. Your existing authentication verifies credentials; Janitor returns attribution alongside risk. Read [Humans, agents & authority](docs/AGENTIC-IDENTITY.md) for the working APIs and trust boundaries.

## Opt-in login feedback

Applications can opt in to collecting short anonymous sessions that a later verified login labels. Data stays in the implementer's database. Optional shadow predictions stay server-side and never authenticate or merge accounts. Collection is disabled by default and uses the implementer’s application-wide or per-request collection policy. This does not automatically train Jev or establish anonymous cross-device accuracy. See [learning configuration and erasure](docs/LEARNING.md) and the [product review and comparison](docs/REVIEW.md).

## Elixir / Phoenix

```elixir
# mix.exs — public Git preview, not yet on Hex
{:janitor, github: "Holy-Coders/janitor", tag: "v0.6.0", sparse: "packages/elixir"}
```

```elixir
janitor = Janitor.new(repo: MyApp.Repo, evaluator: [api_key: System.fetch_env!("JEV_API_KEY")])
Janitor.handle(conn, janitor)
```

Native Ecto/Postgres, Plug/Phoenix, verified user updates, PostHog and Mixpanel. [Install and connect an existing app](packages/elixir/README.md) · [Boot the Phoenix example](examples/phoenix/README.md).

## Cloudflare

```ts
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";

export default {
  async fetch(request, env) {
    const visitor = createCloudflareVisitor({ db: env.VISITORS, ai: env.AI });
    return visitor.handle(request);
  },
};
```

Uses D1 and `typesafe/jev` through the Workers AI binding. No separate TypeSafe key. Apply the [D1 migrations](packages/storage/d1/migrations) in order first. This checkout includes `0005_protection.sql` and `0006_evidence.sql`; the public v0.6.0 artifacts stop at `0004_candidate_lookup.sql`.

## Vercel / Next.js

```ts
import { Pool } from "pg";
import { createVercelVisitor } from "@janitor/adapters/vercel";

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const visitor = createVercelVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
});

export const runtime = "nodejs";
export async function POST(request: Request) {
  return visitor.handle(request);
}
```

Any compatible Postgres pool works. Isolate each application in its own database or schema/search_path; sharing these tables shares the identity namespace. The adapter does not create or close database connections. Use your database's pooled connection URL and connection limits for serverless execution. Apply the [Postgres migrations](packages/storage/postgres/migrations) in order first (through `0006_evidence.sql` for this checkout, `0004_candidate_lookup.sql` for v0.6.0).

The unreleased checkout adds optional database-backed request limits, shared Jev call budgets and circuit breaking, plus private edge/authentication evidence, narrow application events and auditable, revocable device associations. TypeScript and native Elixir share the same storage contract. These features preserve the application's control over access decisions; they do not authenticate a person from a fingerprint. See [configuration, APIs and migration instructions](docs/HARDENING.md). They have not been published or integrated into an application yet.

[Capacity benchmarks](docs/CAPACITY.md) include one million events and 200,000 live HTTP connections, with separate successful-throughput and overload results. The checkout adds per-handler admission, optional sharded global quotas and smaller activity-query results; these are local measurements, not a production SLA or paid Jev capacity claim.

## Node

```ts
import { Pool } from "pg";
import { createNodeVisitor } from "@janitor/adapters/node";

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const visitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
});

const response = await visitor.handle(request); // Standard Web Request / Response.
```

Use with Fastify, Express, Hono, Astro SSR, Nest, plain Node HTTP, and hosts supporting Node 22+. Translate the framework request/response at the route boundary. The [Fastify example](examples/node-fastify) includes this translation; no framework is imported by the library.

## Install and develop

Requires Node 22.12+ and pnpm 9.12.0. The workspace is implemented locally; these package names have **not** been published to npm.

```sh
git clone https://github.com/Holy-Coders/janitor.git
cd janitor
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Download the prebuilt [v0.6.0 bundle](https://github.com/Holy-Coders/janitor/releases/tag/v0.6.0) to try the packages outside the monorepo:

```sh
mkdir janitor-packages && cd janitor-packages
curl -fL https://github.com/Holy-Coders/janitor/releases/download/v0.6.0/janitor-0.6.0.tar.gz -o janitor-0.6.0.tar.gz
tar -xzf janitor-0.6.0.tar.gz
pnpm install # or npm install / bun install
```

Packages expose compiled ESM and TypeScript declarations. Inside this workspace use `workspace:^` dependencies. Run `pnpm pack:all` to produce seven archives and a consumer `package.json` in `artifacts/`. Copy that folder outside the workspace and run `pnpm install` there for a standalone installation. For an existing application, merge `dependencies` and `pnpm.overrides` (pnpm) or `overrides` (npm/Bun) into its manifest, adjusting all `file:` paths to the archives. See [installation options and other languages](docs/LANGUAGES.md). The overrides are necessary because these sibling packages are unpublished; they prevent pnpm from looking them up on npm. Alternatively, publish the packages to your own registry. Subpath exports isolate Cloudflare and Node entrypoints. SQL migrations and source/declaration maps ship with the packages.

Run the browser integration test:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

It runs the real browser client through Fastify and embedded Postgres, verifies the HttpOnly cookie, clears cookies, resizes the viewport, and restores the original visitor using deterministic fallback. No external AI calls occur in tests.

## Scale and the full journey

For millions of visitors, use the existing **Postgres** backend in your own infrastructure. Candidate lookup searches a bounded pool through selective indexes, ranks it, loads ten candidate histories in one database round trip, and evaluates at most three with Jev. Ten is the final comparison shortlist, not the total database search population. Saturated, ambiguous buckets abstain. See [scale benchmarks and migration](docs/SCALING.md).

The [research review](docs/RESEARCH.md) compares published spoofing/history studies and documented Cloudflare, Fingerprint, Sift, Auth0 and Segment approaches. Verified accounts, browser continuity, actor delegation and action risk remain distinct. Anonymous cross-device accuracy is unproven.

## Small architecture

```text
browser collection → normalization → bounded candidate search
  → deterministic ranking → optional evaluator → confidence → persistence
```

- `@janitor/core`: shared types, normalization, similarity, matching engine. No hosting or evaluator provider imports.
- `@janitor/browser`: guarded collection, aggregate counters, `identify()`, `setEnabled()`, `reset()` and `destroy()`.
- Native `janitor` Mix package: Ecto/Postgres, Phoenix/Plug, user updates and PostHog/Mixpanel.
- [Analytics bridges](docs/ANALYTICS.md), [signed evidence](docs/TRUST.md), and [feedback evaluation](docs/EVALUATION.md) remain separate opt-in helpers.
- `@janitor/adapters/{cloudflare,vercel,node}`: storage/evaluator composition and a shared HTTP boundary.
- `@janitor/storage-{d1,postgres}`: indexed candidate lookup, bounded history, erasure and cleanup.
- `@janitor/evaluator-{jev,cloudflare-jev}`: the same narrow, typed evaluator contract via two transports.

The [full tree and public interfaces](docs/API.md), [matching algorithm](docs/MATCHING.md), [exact provider contracts](docs/JEV.md), and [privacy inventory](PRIVACY.md) document the implementation.

## Matching and risk

A valid cookie loads five recent observations for that visitor, evaluates current risk, saves the new observation, and returns the same ID without a global lookup. Cookie continuity has `confidence: 1`; that describes possession of an existing visitor cookie, not proof of a person or device.

Without a usable cookie, indexed coarse lookup returns at most ten recent visitors. Core compares each against at most five observations and sends at most three plausible candidates to the evaluator. The identity score is `0.35 * deterministicSimilarity + 0.65 * sameVisitor`, capped for sparse or contradictory evidence. A candidate must reach `0.90` and lead the runner-up by at least `0.03`. Otherwise a new random ID is issued with `confidence: 0` (no established historical link). Recency breaks ranking ties; it does not turn ambiguity into a match.

Risk never affects identity ranking or restoration. First visits also get a risk evaluation. With no evaluator, a timeout, HTTP error, rate limit or malformed response, identity falls back to deterministic matching and risk defaults to `{ automation: 0, suspicious: 0 }`. Those zeros mean unavailable evidence in this case, not a verified human. Storage failures produce a sanitized `503`, without issuing a cookie. The browser rejects failed identification so applications can handle service failure themselves.

## Options and operations

```ts
const visitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY!, model: "jev-latest" },
  evaluatorTimeoutMs: 1200,
  restoreThreshold: 0.9,
  observationRetentionDays: 90,
  maxObservationsPerVisitor: 10,
  cookie: { name: "__visitor", maxAgeDays: 90 },
  maxBodyBytes: 16_384,
  onMetrics(metrics) {
    /* Counts/scores/timing only; send to your own telemetry. */
  },
});
const progress = await visitor.cleanup({ batchSize: 100 });
// Persist progress?.nextVisitorId for the next maintenance batch.
await visitor.deleteVisitor(visitorId); // Server-side: authorize this operation yourself.
```

`cleanup()` removes a bounded page of expired observations, repairs count limits for a page of visitor IDs, and removes a page of expired visitors with no observations. Continue with `nextVisitorId` and run expiry batches while `hasMoreExpired` is true; see [maintenance](docs/SCALING.md). Retention is also enforced on reads, so expired history cannot restore an ID while awaiting cleanup. Each save prunes that visitor's history. Postgres insertion and pruning are separate committed statements; interrupted pruning is repaired by cleanup or a later save. D1 batches insertion and pruning atomically. Concurrent cookieless first requests can create separate IDs; in-flight calls on a single browser client are coalesced, while no cross-tab lock or queue is used.

Cookies default to `HttpOnly; Secure; SameSite=Lax; Path=/` and are host-only. Use HTTPS in production. Chromium accepts Secure cookies on localhost; if a local browser does not, explicitly configure `environment: 'development', cookie: { secure: false }`. This exception is rejected outside loopback and in production mode. Adapters default to production mode.

For **local debug only**, enable both `environment: 'development', debug: true` on the adapter and `debug: true` on the browser client. Responses then include deterministic score, evaluator usage, candidate count, and collected signals. Browser opt-in alone never enables debug. Do not retain debug responses in logs.

Pass `evaluator: false` to Node/Vercel, or omit `ai` on Cloudflare, for deterministic-only operation. Supply a custom `VisitorEvaluator` as Node/Vercel's `evaluator`, or use the advanced `createVisitorHandler(storage, evaluator, options)` export from `@janitor/adapters/node`. `createVisitorEngine` accepts only the shared storage/evaluator interfaces. A custom classifier therefore needs no browser API changes.

HTTP accepts `POST /api/visitor` (`endpointPath` is configurable) with `{ signals: {}, behavior?: {}, debug?: boolean }`. All signal fields are optional. Only known fields are accepted, with bounded strings/arrays/numbers and a streamed 16 KiB body limit. Other methods receive `405`, invalid JSON/schema `400`, oversized bodies `413`, and wrong content types `415`. Responses are `private, no-store`. Same-origin JSON requests are required; there is no third-party CORS support. Mount behind the application's normal request/rate limits, especially when enabling paid evaluation. One request can make up to three evaluations. The library never logs raw observations, IPs, cookies or provider errors.

## Boot examples

First run `pnpm install && pnpm build` from the repository root.

**Cloudflare** — no database service or AI key needed for the default local mode:

```sh
cd examples/cloudflare-worker
pnpm exec wrangler d1 migrations apply VISITORS --local
pnpm dev
# http://localhost:8787
```

**Fastify and Next.js** — start the supplied local Postgres once:

```sh
docker compose -f examples/compose.yaml up -d --wait
```

```sh
cd examples/node-fastify
cp .env.example .env
pnpm migrate
pnpm dev
# http://localhost:3001
```

```sh
cd examples/nextjs
cp .env.example .env.local
pnpm migrate
pnpm dev
# http://localhost:3000
```

The example migrations are idempotent. All examples disable external AI by default; blank `JEV_API_KEY` means deterministic-only. For real risk judgments, set a valid key in Node/Next or enable Workers AI as described in the [Cloudflare instructions](examples/cloudflare-worker/README.md). Provider calls may incur charges. Never put keys into client bundles.

## Privacy and scope

Only first-party browser observations and enabled aggregate behavior summaries are stored. No raw IP, geolocation, keys, form contents, absolute mouse positions or cross-site identifiers are collected from the browser. Optional server-verified account linking returns an application-scoped subject label without storing account identifiers. Browser protections are respected, including masked WebGL values. [PRIVACY.md](PRIVACY.md) describes every signal, erasure, retention, evaluator data sharing and disclosure. Create the client only after any required opt-in and stop collection when consent is withdrawn. Cookie loss is not treated as consent to resume collection.

This is a small experimental library, not a fingerprinting platform: no accounts, dashboard, billing, queues, worker service, Redis, model training or automatic enforcement.

## Public website

The documentation site lives in `site/` and is published at [janitor.holycoders.io](https://janitor.holycoders.io). It uses Astro static output, self-hosted fonts, repository-sourced documentation, and a synthetic in-memory playground powered by `@janitor/core`. It collects no visitor signals.

```sh
pnpm site:dev
pnpm site:build
pnpm site:check
pnpm site:test
```

See [site/README.md](site/README.md) for publishing and content maintenance.

## Behavior, cross-device links, and benchmarks

Opt in to motion/timing summaries with `createVisitorClient({ behavior: "extended" })`. For account keys, actor attribution and delegation, configure `identity: { secret, namespace }` and use the [identity directory APIs](docs/AGENTIC-IDENTITY.md). Different browsers keep their own `visitorId` while sharing a server-verified subject. The library does not verify anonymous people or implement authentication. Optional [login feedback](docs/LEARNING.md) supports a separate shadow experiment. Lightweight stateless account labels remain available in the [cross-device guide](docs/EXTENSIONS.md).

Generate controlled observations with `pnpm exec playwright install chromium firefox webkit` followed by `pnpm benchmark:browser`. [The benchmark report](docs/BENCHMARKS.md) includes both successful restoration and identical-profile false matches. The generated data is not a real-user population or a measured bot-detection accuracy claim.
