# API reference

Start with [add Doorman to your app](IDENTITY-CONTEXT.md). This reference targets the upcoming 0.13 release.

## Recommended server API

Import `createDoorman` from `@aarondovturkel/doorman-adapters/node`, `/vercel` or `/cloudflare`.

```ts
const doorman = createDoorman({
  db,
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: false, // Node/Vercel. Cloudflare accepts an optional ai binding.
});
```

| Method or option                                       | Purpose                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `handle(request, { auth? })`                           | Return public identity JSON and cookies.                                                                              |
| `assess(request, { auth?, riskEvidence?, clientIp? })` | Also return private `identity`, `context`, `properties` and risk evidence. Return only its `response` to the browser. |
| `ready()`                                              | Optional startup check. Table setup also runs automatically on first database use.                                    |
| `cleanup()`                                            | Remove expired history using existing maintenance.                                                                    |
| `forgetUser(rawUserId)`                                | Erase retained user relationships and dependent learning data.                                                        |
| `deleteVisitor(visitorId)`                             | Erase the browser and its relationships.                                                                              |
| `crossDevice`                                          | Default `false`; enable later-login feedback and private cross-device suggestions.                                    |
| `autoMigrate`                                          | Default `true`; set `false` only when another deployment step owns table setup.                                       |

`auth` is server-owned: `{ userId, accountId?, actor?: { id, kind: "person" | "agent" } }`. In this flow scores stay private, missing-cookie matches never restore an ID, and lookup planning is off. Jev is optional. [Context statuses and limits](IDENTITY-CONTEXT.md).

## Recommended browser API

`createDoormanClient({ endpoint?, analytics?, collection?, enabled?, headers? })` uses the current origin. `collection` defaults to `"minimal"`; `"extended"` adds bounded optional detection summaries.

Call `identify()` for an anonymous visit or `identify({ userId, accountId? }, traits?)` after verified login. Other methods are `update`, `track`, `reset`, `setEnabled` and `destroy`. The public result is `{ visitorId, sessionId, isReturning }` when the server uses the recommended flow. See [analytics lifecycle](ANALYTICS.md).

## Lower-level APIs

The remaining reference is for custom integrations. These constructors expose separate visitor, directory and learning services. Their defaults can differ from `createDoorman`, and their callers manage storage setup explicitly. Most applications do not need them.

## Browser

```ts
createVisitorClient(options?: {
  endpoint?: string;
  debug?: boolean;
  behavior?: "counts" | "extended";
  enabled?: boolean;
  headers?: () => Record<string, string>;
}): {
  identify(): Promise<VisitorClientIdentity>;
  setEnabled(enabled: boolean): void;
  reset(): void;
  destroy(): void;
};
```

`endpoint` defaults to `/api/visitor`; cross-origin URLs are rejected. Concurrent calls on one client share a promise. `identify()` sends signals and current aggregate behavior using same-origin cookies and a ten-second request timeout. Network, HTTP or invalid response errors reject; collection failures alone do not throw. After `destroy()`, the client cannot identify again. Create a new client on a new mount; do not reuse it after disposal. Collection should start only after the application's required opt-in.

`createIdentityAnalytics({ visitor?, posthog?, mixpanel? })` adds explicit `identifyUser(authenticatedId, traits?)` and `reset()` hooks for existing browser analytics SDKs. It preserves the anonymous-to-login transition, resets on user switches, and never receives risk scores. See [analytics lifecycle and account/actor reports](ANALYTICS.md).

`collectBrowserSignals`, `createBehaviorTracker`, and `safe` are exported for advanced integrations/testing. The normal application API requires only `createVisitorClient`. `enabled: false` creates no event listeners; `setEnabled(false)` pauses and clears collection. `reset()` discards pending results and restarts aggregate counts, useful after logout/account changes. Neither changes HttpOnly cookies. `headers()` supplies framework CSRF tokens at request time.

## Application identity client

`createDoormanClient({ ...browserOptions, analytics: { posthog?, mixpanel?, segment? } })` is the application-facing identity layer. It accepts your existing initialized SDK instances.

| Method                             | Behavior                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `identify()`                       | Measure the current browser without identifying a person to analytics.                        |
| `identify(userId, traits?)`        | Use an authenticated application user ID across destinations, then measure the browser again. |
| `update({ name?, email?, plan? })` | Update the current identified person's profile.                                               |
| `track(event, properties?)`        | Send an event to each destination with the known Doorman visitor ID.                          |
| `reset()`                          | Clear local identity state and reset destinations on logout/account changes.                  |
| `setEnabled(boolean)`              | Pause/resume Doorman collection and its analytics calls.                                      |
| `destroy()`                        | Remove browser listeners and discard pending measurements.                                    |

Provider SDKs own delivery and anonymous IDs. Inferred person suggestions never enter this API. See [provider setup, login flow and limitations](ANALYTICS.md).

## Server adapters

All return this lifecycle/HTTP surface (the optional `identities` directory methods are documented below):

```ts
{
  handle(request: Request, context?: VisitorRequestContext): Promise<Response>;
  assess(request: Request, context?: VisitorRequestContext): Promise<{ response: Response; identity?: VisitorIdentity; evidence?: RequestEvidence; learning?: LearningPrediction }>;
  cleanup(options?: { batchSize?: number; afterVisitorId?: string }): Promise<{ nextVisitorId?: string; hasMoreExpired: boolean } | void>;
  deleteVisitor(visitorId: string): Promise<void>;
  learning?: { reports(limit?: number): Promise<LearningReport[]>; deleteSession(id: string): Promise<void> };
}
```

Node/Vercel accept `{ db, evaluator?: { apiKey, model?, timeoutMs? } | VisitorEvaluator | false, ...options }`. Cloudflare accepts `{ db, ai?, ...options }`. Omitting an evaluator/AI binding is deterministic-only. No adapter automatically performs cleanup or blocks based on risk.

`handle()` returns only `visitorId` and `isReturning` by default. `assess()` additionally returns full private server evidence and no identity on HTTP errors. Explicit `exposeClientScores: true` exposes the full result in the public response. Browser result score fields are optional. See [security boundaries](SECURITY.md).

### Common options

| Option                      | Default                      | Purpose                                                                                 |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `observationRetentionDays`  | `90`                         | How long browser observations can be used.                                              |
| `maxObservationsPerVisitor` | `10`                         | Stored observations per visitor; accepts 1–100.                                         |
| `lookupPlanning`            | `true`                       | Let a capable evaluator select bounded lookup families before a missing-cookie search.  |
| `evaluatorTimeoutMs`        | `1200`                       | How long to wait for an evaluator, in milliseconds.                                     |
| `restoreThreshold`          | `0.90`                       | Minimum recovery score; accepts 0.8–1. Other evidence and ambiguity checks still apply. |
| `cookie`                    | `__visitor`, 90 days, Secure | Configure `name`, `maxAgeDays` and the development-only `secure` exception.             |
| `maxBodyBytes`              | `16384`                      | Maximum request body size; up to 65536.                                                 |
| `requestTimeoutMs`          | `5000`                       | HTTP request deadline; accepts 100–30000. Deadline errors return 408.                   |
| `endpointPath`              | `/api/visitor`               | The route the adapter handles.                                                          |
| `environment`               | `production`                 | Controls development-only options.                                                      |
| `debug`                     | `false`                      | Enables gated diagnostics outside production.                                           |
| `exposeClientScores`        | `false`                      | Deliberately includes private score/attribution fields in browser JSON.                 |
| `onMetrics`                 | None                         | Receives summary counts, scores and timing without raw browser signals.                 |

Configuration is validated when the adapter is created. Environment variables such as database URLs are read by your application, not by the core library.

`createVisitorHandler` from `@aarondovturkel/doorman-adapters/node` accepts custom managed storage (`VisitorStorage` plus `cleanup()` and `deleteVisitor()`) and any evaluator for advanced composition.

`activity: { routes: [{ route, sensitive? }], windowMs?, retentionDays?, minRequests?, evaluationIntervalMs?, timeoutMs?, maxInFlight? }` enables optional server API instrumentation. It requires identity configuration and migration `0008_api_activity.sql`. The high-level adapters compose storage, evaluator admission and a private `visitor.activity` service with `observe`, `assess`, `handle`, `deleteKey` and `cleanup`. `handle(request, context, next)` returns `{ response, activity }`; return only `response` to the caller. See [API activity](API-ACTIVITY.md) for the complete context, response, failure and retention contract. Advanced users can import `createApiActivity` from `@aarondovturkel/doorman-adapters/activity` and implement the core `ApiActivityStorage` interface.

The handler also accepts `maxInFlightRequests` (default 64, range 1–1,024) and an `onOverload` callback. The limit applies per reusable TypeScript handler instance and rejects excess measurement calls with 503/Retry-After before database work. `protection.requests.shards` optionally distributes the global allowance across 1–128 rows. See [benchmarks and operational semantics](CAPACITY.md). No automatic request retries are performed.

### Optional request limits and trusted evidence

`protection: { secret, namespace, requests?, evaluator?, onEvent? }` enables shared request quotas and evaluator budgets/concurrency/circuit breaking in the existing database. `VisitorRequestContext.admission` accepts server-owned `account` and `session` keys; the browser cannot supply these. Measurement quota exhaustion returns HTTP 429. Inference denial preserves deterministic identity and unavailable risk.

`VisitorRequestContext.evidence` accepts allowlisted server authentication, application action and optional trusted edge assessments. `assess().evidence` stays private even when `exposeClientScores` is enabled. Cloudflare exports `cloudflareRequestEvidence(request)` for the original Worker request's available bot-management flags, without trusting forwarded headers.

`evidence: true | { eventRetentionDays?, linkRetentionDays?, maxEventsPerQuery? }` requires `identity` configuration and enables `visitor.evidence`: `record`, `velocity`, `linkDevice`, `assessDevice`, `listDevices`, `revokeDevice`, `deleteSession`, `deleteSubjectEvents`, `cleanup`. Event categories, verification provenance, retention and input bounds are specified in the [complete guide](HARDENING.md). These are server management APIs, not public ingestion endpoints. Apply migrations 0005 and 0006 before enabling them. These APIs ship in the v0.7.0 GitHub artifacts; upgrade older installations first.

## Result fields

The default browser result contains only:

```ts
type VisitorClientIdentity = {
  visitorId: string;
  isReturning: boolean;
  // Other fields are optional and require explicit server disclosure.
};
```

The server's `assess()` result includes a private identity with:

```ts
type VisitorIdentity = {
  visitorId: string;
  confidence: number;
  isReturning: boolean;
  risk: { automation: number; suspicious: number };
  riskStatus: "evaluated" | "unavailable" | "disabled";
  // Optional subjectId, attribution and debug fields depend on configuration.
};
```

These excerpts show the common fields. [The exported types](../packages/core/src/types.ts) contain the complete optional structures. Confidence describes browser continuity, not account ownership. A new ID has confidence zero because no historical link was established.

## Risk availability

`VisitorIdentity.riskStatus` is `"evaluated"` when a valid evaluator result produced the returned risk, `"unavailable"` when a configured evaluator failed or timed out, and `"disabled"` when none is configured. Fallback numeric risk stays zero. A zero fallback is not an assessment of safety; the application chooses policy. Browser clients validate this status alongside the numerical scores.

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

All methods are asynchronous and server-only. The application verifies credentials/key ownership and authorizes management operations. `updateSubject` returns `{ id, kind, updatedAt }`; `findSubject` returns that record or `undefined`. Adding/removing keys and deletion/revocation return no value. `createDelegation` returns `{ id, principalId, actorId, audience, scopes, expiresAt }`. `assess` returns `IdentityAttribution` exported by `@aarondovturkel/doorman-core`.

`handle(request, { verified: { subjectId, actorId?, delegationId?, audience?, requiredScopes? } })` adds server-only `attribution` to `VisitorIdentity` when the identity directory is configured. Context must come from server-verified authentication; body claims are rejected. Anonymous calls return unknown subject/actor attribution. Directory/database failures return controlled HTTP errors, never manufactured valid grants. `cleanup()` also removes expired grants.

Attribution exposes subject status (`verified`/`unknown`), actor kind (`person`/`agent`/`unknown`) with credential basis, and delegation status (`none`/`valid`/`invalid`). Invalid reasons are `missing`, `revoked`, `expired`, `principal`, `actor`, `audience`, or `scope`. A valid grant reports its scopes and expiry; it is not an access decision. Read the full [identity and delegation guide](AGENTIC-IDENTITY.md) before integration.

## Extended behavior and verified cross-device subjects

`createBehaviorTracker({ extended: true })` enables the same optional summaries as `createVisitorClient({ behavior: "extended" })`. Counts remain the default. All summaries are optional fields on `BrowserBehavior`; see [the full inventory](../PRIVACY.md).

High-level adapters accept `subjectLinking: { secret, namespace }`. Supply at least 32 cryptographically random bytes of secret material (a 64-character hex string works) and a nonempty application namespace. `handle(request, { authenticatedSubject })` derives an opaque `sub_…` HMAC-SHA-256 label from that already verified account identity. `VisitorIdentity.subjectId?: string` appears only for authenticated requests; `visitorId`, `confidence` and `isReturning` retain their browser-continuity meanings. No database migration or account table is required. See [the integration guide](./EXTENSIONS.md).

## Optional learning

`learning?: false | LearningOptions` is opt-in and requires `identity` plus migrations through `0007_learning_lookup.sql`. With Jev configured, `learning: { enabled: true }` automatically enables its built-in shadow predictor. Use `collectionPolicy: "application"` or trusted `learningConsent: true` to allow collection. `mode: "collect"` disables learning inference. A custom `predict({ current, examples })` callback can replace Jev. `assess()` returns the private `learning` result; browser JSON never includes it. See [learning](LEARNING.md).

## Native Elixir and optional utilities

- [Elixir / Phoenix](../packages/elixir/README.md): `Doorman.new`, `Doorman.handle`, `Doorman.identify`, `Doorman.Identity.identify_user`, Ecto migrations, cleanup and native PostHog/Mixpanel HTTP.
- [Analytics](ANALYTICS.md): `@aarondovturkel/doorman-adapters/analytics` exports `analyticsProperties` and `createAnalyticsBridge` for existing PostHog, Mixpanel and Segment server SDKs.
- [Trust](TRUST.md): `@aarondovturkel/doorman-adapters/security` exports `createResultReceipts` and `verifyAgentCredential`; these never alter the matching engine or application policy.
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

## Installation artifacts

```sh
pnpm pack:all
# Eight .tgz archives appear in artifacts/.
```

The packages are published on npm as `@aarondovturkel/doorman-*`. Use `npm install`, `pnpm add`, or `bun add` for normal installation; see [language setup](LANGUAGES.md). `pnpm pack:all` is useful when testing your own source changes. Its consumer manifest uses local archives and overrides so all sibling dependencies come from that build.

Core and browser have no third-party runtime dependency. SQL drivers are supplied by applications. The examples add their own framework/runtime dependencies.

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
site/                   Documentation, local examples and opt-in live playground
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

Every package has an ESM export map, strict TypeScript build, version, license, and declaration files. `@aarondovturkel/doorman-adapters` has three public subpath entrypoints, not three conflicting npm packages. Storage migration files are exported as `@aarondovturkel/doorman-storage-d1/migrations/0001_visitors.sql` and the corresponding Postgres subpath.

## Optional evaluator capabilities

A custom `VisitorEvaluator` only needs `evaluate`. It can also implement `planLookup(current)`, `evaluateCandidates({ current, candidates })`, `predictIdentity({ current, examples })` and `evaluateActivity({ activity, route, sensitive, actor? })`. Both Jev transports implement all four. Missing optional methods retain the original behavior: standard indexed lookup, at most three individual candidate evaluations, collection-only learning unless you supply a custom predictor, and API aggregates without evaluated risk. All built-in methods share the configured inference protection limits.

## Configurable scoring and activity features

See [scoring configuration](SCORING.md) for server-side identity weights and operator thresholds, and [agent classification](AGENT-CLASSIFICATION.md) for optional aggregate movement/timing evidence. These are current TypeScript source features; defaults and private-score behavior are retained.

See [optional detection signals](EXPERIMENTAL-DETECTION.md) for local fonts, runtime/permission probes, target/focus summaries and trusted JA4 evidence. [Linked suspicious activity](LINKED-ACTIVITY.md) correlates server-observed denials across likely related sessions without using IP addresses or merging people. These are opt-in source features with documented experimental limits.
