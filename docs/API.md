# Public API and repository map

## Browser

```ts
createVisitorClient(options?: { endpoint?: string; debug?: boolean; behavior?: "counts" | "extended"; enabled?: boolean; headers?: () => Record<string, string> }): {
  identify(): Promise<VisitorClientIdentity>;
  setEnabled(enabled: boolean): void;
  reset(): void;
  destroy(): void;
};
```

`endpoint` defaults to `/api/visitor`; cross-origin URLs are rejected. Concurrent calls on one client share a promise. `identify()` sends signals and current aggregate behavior using same-origin cookies and a ten-second request timeout. Network, HTTP or invalid response errors reject; collection failures alone do not throw. After `destroy()`, the client cannot identify again. Create a new client on a new mount; do not reuse it after disposal. Collection should start only after the application's required opt-in.

`createIdentityAnalytics({ visitor?, posthog?, mixpanel? })` adds explicit `identifyUser(authenticatedId, traits?)` and `reset()` hooks for existing browser analytics SDKs. It preserves the anonymous-to-login transition, resets on user switches, and never receives risk scores. See [analytics lifecycle and account/actor reports](ANALYTICS.md).

`collectBrowserSignals`, `createBehaviorTracker`, and `safe` are exported for advanced integrations/testing. The normal application API requires only `createVisitorClient`. `enabled: false` creates no event listeners; `setEnabled(false)` pauses and clears collection. `reset()` discards pending results and restarts aggregate counts, useful after logout/account changes. Neither changes HttpOnly cookies. `headers()` supplies framework CSRF tokens at request time.

## Core

```ts
interface VisitorStorage {
  findCandidates(
    observation: NormalizedObservation,
    limit: number,
  ): Promise<VisitorCandidate[]>;
  getRecentObservations(
    visitorId: string,
    limit: number,
  ): Promise<NormalizedObservation[]>;
  getRecentObservationsBatch?(
    visitorIds: string[],
    limit: number,
  ): Promise<Record<string, NormalizedObservation[]>>;
  createVisitor(): Promise<string>;
  saveObservation(
    visitorId: string,
    observation: NormalizedObservation,
  ): Promise<void>;
  touchVisitor(visitorId: string): Promise<void>;
}
interface VisitorEvaluator {
  evaluate(input: {
    history: NormalizedObservation[];
    current: NormalizedObservation;
    deterministicSimilarity: number;
  }): Promise<{ sameVisitor: number; automation: number; suspicious: number }>;
}
```

`VisitorCandidate` is `{ visitorId: string; lastSeenAt: number; lookupSaturated?: boolean }`, with epoch milliseconds. `NormalizedObservation` is the optional browser observation plus optional normalized `browser` family and optional aggregate `behavior`. Complete signal and result types are in [types.ts](../packages/core/src/types.ts).

```ts
const engine = createVisitorEngine({
  storage,
  evaluator, // Optional; replace with any implementation of the interface above.
  evaluatorTimeoutMs: 1200,
  restoreThreshold: 0.9,
});
const result = await engine.identify({
  signals,
  behavior, // Optional aggregate counts/summaries.
  visitorId, // Optional, extracted from a trusted application cookie boundary.
});
```

Core has no HTTP, hosting, database driver or provider imports. Advanced direct callers are responsible for validating untrusted inputs; standard adapters provide validation. `normalizeObservation`, `calculateSimilarity`, named weights/defaults and `VisitorStorageError` are also exported.

## High-level adapters

All return this lifecycle/HTTP surface (the optional `identities` directory methods are documented below):

```ts
{
  handle(request: Request, context?: VisitorRequestContext): Promise<Response>;
  assess(request: Request, context?: VisitorRequestContext): Promise<{ response: Response; identity?: VisitorIdentity; evidence?: RequestEvidence }>;
  cleanup(options?: { batchSize?: number; afterVisitorId?: string }): Promise<{ nextVisitorId?: string; hasMoreExpired: boolean } | void>;
  deleteVisitor(visitorId: string): Promise<void>;
  learning?: { reports(limit?: number): Promise<LearningReport[]>; deleteSession(id: string): Promise<void> };
}
```

Node/Vercel accept `{ db, evaluator?: { apiKey, model?, timeoutMs? } | VisitorEvaluator | false, ...options }`. Cloudflare accepts `{ db, ai?, ...options }`. Omitting an evaluator/AI binding is deterministic-only. No adapter automatically performs cleanup or blocks based on risk.

`handle()` returns only `visitorId` and `isReturning` by default. `assess()` additionally returns full private server evidence and no identity on HTTP errors. Explicit `exposeClientScores: true` restores the full public response. Browser result score fields are optional. See [security boundaries](SECURITY.md).

Common options: `observationRetentionDays` (90), `maxObservationsPerVisitor` (10, 1–100 accepted), `evaluatorTimeoutMs` (1200), `restoreThreshold` (0.90, 0.8–1 accepted), `cookie: { name?, maxAgeDays?, secure? }`, `maxBodyBytes` (16384, up to 65536), `requestTimeoutMs` (5000, 100–30000; HTTP 408 on deadline), `endpointPath` (`/api/visitor`), `environment` (`production`), `debug` (false), `exposeClientScores` (false), and `onMetrics` (none). Limits are validated when the adapter is constructed. Example-only port/database/key variables are handled by examples, never by core.

`createVisitorHandler` from `@janitor/adapters/node` accepts custom managed storage (`VisitorStorage` plus `cleanup()` and `deleteVisitor()`) and any evaluator for advanced composition.

v0.7.0 adds `maxInFlightRequests` (default 64, 1–1,024) and `onOverload`. The limit applies per reusable TypeScript handler instance and rejects excess measurement calls with 503/Retry-After before database work. `protection.requests.shards` optionally distributes the global allowance across 1–128 rows. See [benchmarks and operational semantics](CAPACITY.md). No automatic request retries are performed.

### Abuse controls and trusted evidence (v0.7.0)

`protection: { secret, namespace, requests?, evaluator?, onEvent? }` enables shared request quotas and evaluator budgets/concurrency/circuit breaking in the existing database. `VisitorRequestContext.admission` accepts server-owned `account` and `session` keys; the browser cannot supply these. Measurement quota exhaustion returns HTTP 429. Inference denial preserves deterministic identity and unavailable risk.

`VisitorRequestContext.evidence` accepts allowlisted server authentication, application action and optional trusted edge assessments. `assess().evidence` stays private even when `exposeClientScores` is enabled. Cloudflare exports `cloudflareRequestEvidence(request)` for the original Worker request's available bot-management flags, without trusting forwarded headers.

`evidence: true | { eventRetentionDays?, linkRetentionDays?, maxEventsPerQuery? }` requires `identity` configuration and enables `visitor.evidence`: `record`, `velocity`, `linkDevice`, `assessDevice`, `listDevices`, `revokeDevice`, `deleteSession`, `deleteSubjectEvents`, `cleanup`. Event categories, verification provenance, retention and input bounds are specified in the [complete guide](HARDENING.md). These are server management APIs, not public ingestion endpoints. Apply migrations 0005 and 0006 before enabling them. These APIs ship in the v0.7.0 GitHub artifacts; upgrade older installations first.

## Installation artifacts

```sh
pnpm pack:all
# Seven .tgz archives appear in artifacts/.
```

The output also includes a consumer `package.json` with local dependencies and `pnpm.overrides` for unpublished sibling packages. Copy `artifacts/` outside the workspace and run `pnpm install`, or merge those fields into an existing application and adjust the archive paths. Without the overrides, pnpm may try to resolve unpublished dependencies from npm. Alternatively, publish the packages under your chosen registry/namespaces. Package names in this repository are not claimed to be published on npm. Core and browser have no third-party runtime dependency; Zod is used only by the server adapter's input boundary. SQL drivers are supplied by applications. The examples add their own framework/runtime dependencies.

## Repository layout

```text
packages/
  core/src/
    types.ts              Shared public contracts
    normalize.ts          Browser/platform/language/screen normalization
    similarity.ts         All feature weights and contradiction/evidence caps
    engine.ts             Cookie continuity, candidate ranking, evaluator fallback
    storage-utils.ts      Secure IDs, retention settings and limits
    index.ts
  browser/src/index.ts    Safe collectors, count tracker, browser client
  adapters/src/
    node/index.ts         Postgres + direct Jev composition
    cloudflare/index.ts   D1 + Workers AI composition
    vercel/index.ts       Thin Node-compatible composition
    handler.ts            Web HTTP/cookie/security boundary
    validation.ts         Bounded JSON validation
  storage/
    d1/{src/index.ts,migrations/0001_visitors.sql}
    postgres/{src/index.ts,migrations/0001_visitors.sql}
  evaluators/
    jev/src/{index.ts,protocol.ts}
    cloudflare-jev/src/index.ts
examples/
  cloudflare-worker/     Wrangler, local D1, AI binding, static HTML/browser bundle
  nextjs/                App Router route, client component, Postgres migration
  node-fastify/          Standard Request/Response bridge, HTML/browser bundle
  compose.yaml           Local Postgres
tests/                  Core, browser, storage, evaluator, adapter tests
  helpers/               In-memory storage and fixtures
  e2e/                   Chromium → Fastify → embedded Postgres
site/                   Static documentation site and synthetic playground
  src/                    Astro pages, components, and client scripts
  content/                Site-specific guides
  public/                 Logo and social preview
scripts/pack.mjs          Installable tarballs in artifacts/
docs/{API,MATCHING,JEV,VALIDATION}.md
README.md
PRIVACY.md
LICENSE
.github/workflows/ci.yml
```

Every package has an ESM export map, strict TypeScript build, version, license, and declaration files. `@janitor/adapters` has three public subpath entrypoints, not three conflicting npm packages. Storage migration files are exported as `@janitor/storage-d1/migrations/0001_visitors.sql` and the corresponding Postgres subpath.

## Extended behavior and verified cross-device subjects

`createBehaviorTracker({ extended: true })` enables the same optional summaries as `createVisitorClient({ behavior: "extended" })`. Counts remain the default. All summaries are optional fields on `BrowserBehavior`; see [the full inventory](../PRIVACY.md).

High-level adapters accept `subjectLinking: { secret, namespace }`. Supply at least 32 cryptographically random bytes of secret material (a 64-character hex string works) and a nonempty application namespace. `handle(request, { authenticatedSubject })` derives an opaque `sub_…` HMAC-SHA-256 label from that already verified account identity. `VisitorIdentity.subjectId?: string` appears only for authenticated requests; `visitorId`, `confidence` and `isReturning` retain their browser-continuity meanings. No database migration or account table is required. See [the integration guide](./EXTENSIONS.md).

## Identity directory and delegation

Adapters accept `identity: { secret, namespace }` and expose `identities` when configured. Apply `0002_identity.sql` in addition to the visitor migration. This directory is independent of the lightweight stateless `subjectLinking` option; use `identity` for account keys and delegation.

```ts
identities.updateSubject({ id, kind: "person" | "agent" });
identities.addVerifiedKey(subjectId, { type: "email" | "external" | "public-key", issuer, value });
identities.findSubject({ type, issuer, value });
identities.removeKey(subjectId, { type, issuer, value });
identities.deleteSubject(subjectId);
identities.createDelegation({ principalId, actorId, audience, scopes, expiresAt });
identities.revokeDelegation(delegationId);
identities.assess({ subjectId, actorId?, delegationId?, audience?, requiredScopes? });
```

All methods are asynchronous and server-only. The application verifies credentials/key ownership and authorizes management operations. `updateSubject` returns `{ id, kind, updatedAt }`; `findSubject` returns that record or `undefined`. Adding/removing keys and deletion/revocation return no value. `createDelegation` returns `{ id, principalId, actorId, audience, scopes, expiresAt }`. `assess` returns `IdentityAttribution` exported by `@janitor/core`.

`handle(request, { verified: { subjectId, actorId?, delegationId?, audience?, requiredScopes? } })` adds server-only `attribution` to `VisitorIdentity` when the identity directory is configured. Context must come from server-verified authentication; body claims are rejected. Anonymous calls return unknown subject/actor attribution. Directory/database failures return controlled HTTP errors, never manufactured valid grants. `cleanup()` also removes expired grants.

Attribution exposes subject status (`verified`/`unknown`), actor kind (`person`/`agent`/`unknown`) with credential basis, and delegation status (`none`/`valid`/`invalid`). Invalid reasons are `missing`, `revoked`, `expired`, `principal`, `actor`, `audience`, or `scope`. A valid grant reports its scopes and expiry; it is not an access decision. Read the full [identity and delegation guide](AGENTIC-IDENTITY.md) before integration.

## Risk availability

`VisitorIdentity.riskStatus` is `"evaluated"` when a valid evaluator result produced the returned risk, `"unavailable"` when a configured evaluator failed or timed out, and `"disabled"` when none is configured. Fallback numeric risk stays zero. A zero fallback is not an assessment of safety; the application chooses policy. Browser clients validate this status alongside the numerical scores.

## Optional learning

`learning?: false | LearningOptions` is disabled by default and requires `identity` plus migration `0003_learning.sql`. Explicit `learning: { enabled: true, mode: "collect" }` and trusted `handle(request, { learningConsent: true })` enable short-session feedback. `mode: "shadow"` additionally requires a `predict({ current, examples })` callback returning `{ subjectId?, score? }`. Reports and guesses stay server-only. See [all limits, lifecycle rules and examples](LEARNING.md). No built-in cross-device model is trained or automatically enabled.

## Native Elixir and optional utilities

- [Elixir / Phoenix](../packages/elixir/README.md): `Janitor.new`, `Janitor.handle`, `Janitor.identify`, `Janitor.Identity.identify_user`, Ecto migrations, cleanup and native PostHog/Mixpanel HTTP.
- [Analytics](ANALYTICS.md): `@janitor/adapters/analytics` exports `analyticsProperties` and `createAnalyticsBridge` for existing PostHog, Mixpanel and Segment server SDKs.
- [Trust](TRUST.md): `@janitor/adapters/security` exports `createResultReceipts` and `verifyAgentCredential`; these never alter the matching engine or application policy.
- [Evaluation](EVALUATION.md): core exports `createFeedbackExport`, `revokeFeedback` and `evaluateLearning` for local, verified feedback experiments.
- [HTTP protocol](../protocol/openapi.json): OpenAPI 3.1, with generated JSON payload schema and TypeScript/Elixir conformance fixtures.

Additional repository paths:

```text
packages/elixir/              Native Mix package, Ecto migration, bundled browser client
examples/phoenix/             Working Phoenix endpoint and browser page
packages/adapters/src/analytics.ts
packages/adapters/src/security.ts
packages/core/src/evaluation.ts
protocol/                    OpenAPI, JSON schema, Jev questions and conformance vectors
scripts/evaluate-learning.ts  Offline aggregate evaluation report
```
