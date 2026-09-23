# Janitor

<img src="https://janitor.holycoders.io/janitor-logo.png" alt="Janitor pixel-sweep J logo" width="128" />

Durable first-party visitor identity from browser history, with optional Jev-assisted matching and risk scoring.

[Documentation](https://janitor.holycoders.io/docs/getting-started/) · [Interactive playground](https://janitor.holycoders.io/playground/) · [Releases](https://github.com/Holy-Coders/janitor/releases)

Prelaunch developer preview. The API is still evolving.

```ts
import { createVisitorClient } from "@janitor/browser";

const visitor = createVisitorClient({ endpoint: "/api/visitor" });
const identity = await visitor.identify();

// Your application owns the decision and the CAPTCHA integration.
if (identity.risk.automation > 0.85) {
  showCaptcha();
}

// Remove event listeners when a component unmounts or collection stops.
visitor.destroy();
```

```ts
type VisitorIdentity = {
  visitorId: string; // Opaque, random vis_… ID; never a fingerprint hash.
  confidence: number;
  isReturning: boolean;
  risk: { automation: number; suspicious: number };
};
```

The library never blocks a user, changes access, or displays a CAPTCHA. It recognizes browser environments, not people. Matching confidence and risk are experimental scores, not authentication credentials or calibrated guarantees. Two browsers with indistinguishable observations cannot reliably be separated after cookie loss. See [limitations and calibration](docs/MATCHING.md).

## Identity context for the agentic era

Jev evaluates three narrow questions: browser continuity, automation, and suspicious technical signals. The application keeps control of policy. An authorized agent can be automated and legitimate; a low automation score does not prove a human is authorized.

Janitor combines browser identity with a server-side identity directory: verified email/key associations, distinct person and agent principals, and scoped, expiring, revocable delegation. Your existing authentication verifies credentials; Janitor returns attribution alongside risk. Read [Humans, agents & authority](docs/AGENTIC-IDENTITY.md) for the working APIs and trust boundaries.

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

Uses D1 and `typesafe/jev` through the Workers AI binding. No separate TypeSafe key. Apply the [D1 migration](packages/storage/d1/migrations/0001_visitors.sql) first.

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

Any compatible Postgres pool works. Isolate each application in its own database or schema/search_path; sharing these tables shares the identity namespace. The adapter does not create or close database connections. Use your database's pooled connection URL and connection limits for serverless execution. Apply the [Postgres migration](packages/storage/postgres/migrations/0001_visitors.sql) first.

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

Download the prebuilt [v0.3.0 bundle](https://github.com/Holy-Coders/janitor/releases/tag/v0.3.0) to try the packages outside the monorepo:

```sh
mkdir janitor-packages && cd janitor-packages
curl -fL https://github.com/Holy-Coders/janitor/releases/download/v0.3.0/janitor-0.3.0.tar.gz -o janitor-0.3.0.tar.gz
tar -xzf janitor-0.3.0.tar.gz
pnpm install
```

Packages expose compiled ESM and TypeScript declarations. Inside this workspace use `workspace:^` dependencies. Run `pnpm pack:all` to produce seven archives and a consumer `package.json` in `artifacts/`. Copy that folder outside the workspace and run `pnpm install` there for a standalone installation. For an existing pnpm application, merge the generated `dependencies` and `pnpm.overrides` fields into its manifest, adjusting `file:` paths to the archives. The overrides are necessary because these sibling packages are unpublished; they prevent pnpm from looking them up on npm. Alternatively, publish the packages to your own registry. Subpath exports isolate Cloudflare and Node entrypoints. SQL migrations and source/declaration maps ship with the packages.

Run the browser integration test:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

It runs the real browser client through Fastify and embedded Postgres, verifies the HttpOnly cookie, clears cookies, resizes the viewport, and restores the original visitor using deterministic fallback. No external AI calls occur in tests.

## Small architecture

```text
browser collection → normalization → bounded candidate search
  → deterministic ranking → optional evaluator → confidence → persistence
```

- `@janitor/core`: shared types, normalization, similarity, matching engine. No hosting or evaluator provider imports.
- `@janitor/browser`: guarded browser collection, aggregate event counters, `identify()` and `destroy()`.
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
await visitor.cleanup(); // Run from an existing maintenance task; no scheduler included.
await visitor.deleteVisitor(visitorId); // Server-side: authorize this operation yourself.
```

`cleanup()` removes expired observations, repairs count limits, and removes expired visitors with no observations. Retention is also enforced on reads, so expired history cannot restore an ID while awaiting cleanup. Each save prunes that visitor's history. Postgres insertion and pruning are separate committed statements; interrupted pruning is repaired by cleanup or a later save. D1 batches insertion and pruning atomically. Concurrent cookieless first requests can create separate IDs; in-flight calls on a single browser client are coalesced, while no cross-tab lock or queue is used.

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

Opt in to motion/timing summaries with `createVisitorClient({ behavior: "extended" })`. For account keys, actor attribution and delegation, configure `identity: { secret, namespace }` and use the [identity directory APIs](docs/AGENTIC-IDENTITY.md). Different browsers keep their own `visitorId` while sharing a server-verified subject. The library does not infer anonymous people or implement authentication. Lightweight stateless account labels remain available in the [cross-device guide](docs/EXTENSIONS.md).

Generate controlled observations with `pnpm exec playwright install chromium firefox webkit` followed by `pnpm benchmark:browser`. [The benchmark report](docs/BENCHMARKS.md) includes both successful restoration and identical-profile false matches. The generated data is not a real-user population or a measured bot-detection accuracy claim.
