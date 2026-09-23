# Abuse controls and trusted application evidence

**Unreleased workspace changes.** These APIs are implemented in this checkout; the public v0.6.0 archives do not contain them yet. Publishing and application integration are separate next steps. Nothing here enables automatic blocking, CAPTCHA display, account merging, or model training.

## Configure shared protection

Node and Vercel use Postgres; Cloudflare supports D1 or Postgres. Apply `0005_protection.sql` and `0006_evidence.sql` after the existing migrations. Protection and event storage are optional and create no tables at runtime.

```ts
const visitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  protection: {
    secret: process.env.JANITOR_PROTECTION_SECRET!, // Dedicated random server secret, at least 32 characters.
    namespace: "my-app",
    requests: { global: 600, account: 60, session: 30, windowMs: 60_000 },
    evaluator: {
      maxCalls: 120,
      windowMs: 60_000,
      maxConcurrent: 4,
      failureThreshold: 3,
      cooldownMs: 30_000,
    },
    onEvent: ({ kind, reason }) =>
      metrics.increment(`janitor.${kind}.${reason}`),
  },
  identity: {
    secret: process.env.JANITOR_IDENTITY_SECRET!,
    namespace: "my-app",
  },
  evidence: {
    eventRetentionDays: 7,
    linkRetentionDays: 90,
    maxEventsPerQuery: 1000,
  },
});
```

`db`, `metrics` and authenticated session management belong to your application. Use identical secrets, namespaces, limits and synchronized server clocks across replicas. A changed protection secret/namespace starts a new budget; it is not a routine way to rotate a busy limiter. Use separate database/schema installations for unrelated applications.

| Control                    | Behavior                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measurement request limits | Database-atomic fixed windows. Global limit always applies when protection is configured; account/session limits apply only when supplied in trusted server context. Earlier counters count attempts denied by a later counter too. Fixed windows can admit bursts across a boundary. |
| Call budget                | Counts evaluator starts, including failures and each candidate evaluation. Shared across adapter instances and native Elixir with matching configuration. It is a call-count limit, not a currency-denominated billing guarantee.                                                     |
| Concurrency                | At most the configured number of unexpired leases. Reservation updates use compare-and-swap, with eight bounded attempts. Contention or storage failure skips inference.                                                                                                              |
| Circuit breaker            | Repeated failures open the circuit. After cooldown, one recovery probe may run. A completion from an older circuit generation cannot close the new circuit.                                                                                                                           |
| Timeout/crash              | Timed-out calls retain their lease until the provider deadline plus five seconds. Abandoned leases expire; there is no worker or scheduler. This cannot guarantee that a remote provider or arbitrary custom evaluator stopped running or billing.                                    |
| History protection         | A cookie-bearing observation is saved only when retained history has sufficient, non-contradictory deterministic evidence. Sparse or contradictory submissions leave useful history intact; cookie continuity remains separate from authentication.                                   |

The defaults above are starting limits, not traffic recommendations. Request windows and evaluator budget windows accept 1 second to 1 hour; concurrency is 1–32. Protected evaluator deadlines are 1–5,000 ms. The engine allows one additional second for the guard to persist its outcome before its outer fallback deadline. Configure database pool/statement timeouts in the application: these controls do not cancel arbitrary storage queries.

The TypeScript HTTP adapters also enforce `maxInFlightRequests` (default 64, range 1–1,024) per reusable handler instance, returning 503 with `Retry-After: 1` before database work when full. `onOverload` is an optional payload-free callback. Reuse the adapter across requests; configure framework and database timeouts independently. This gate covers measurement HTTP calls, not direct core/evidence management calls or other application endpoints. Native Phoenix uses the application's HTTP admission and DBConnection pool/queue controls.

For higher request volumes, `requests.shards` (default 1, maximum 128) divides the global allowance across database rows with epoch-aligned windows. Per-shard limits sum to the global maximum; there is no borrowing, so uneven traffic may be denied early. All replicas must agree on configuration. Changing the shard count changes counter keys: drain the old configuration and wait out its window before switching. Elixir supports the same `shards` option and HMAC keys. See [measured capacity, configuration and limits](CAPACITY.md).

A measurement quota denial returns sanitized **429** and `Retry-After`, without identity or cookie creation. A protection-store request failure returns **503**. Inference denial, provider failure, malformed output and timeout preserve deterministic matching and return zero risk with `riskStatus: "unavailable"`. A successful evaluated zero is different from unavailable risk. Never treat unavailable risk as affirmative proof of safety; the application's sensitive-action policy chooses its existing verification path.

The endpoint limiter does not protect your login/payment endpoints or absorb a network flood. Keep gateway and application admission controls in front of the database. A global quota protects resources but can itself be exhausted by an attacker; unavailable measurement must not grant permissions. Account/session limiter keys must come from authenticated accounts and application-issued sessions, not request body fields, arbitrary headers, or Janitor's fuzzy visitor ID. No raw IP address is collected.

## Keep evidence on the server

```ts
const { response, identity, evidence } = await visitor.assess(request, {
  admission: {
    account: authenticatedUser?.id,
    session: serverSession.id,
  },
  evidence: {
    authentication: authenticatedUser
      ? { method: "passkey", verifiedAt: serverSession.verifiedAt }
      : undefined,
    action: "payment",
  },
});
// identity?.risk and evidence remain in server memory.
// Use them in your application's policy; return only the measurement response.
return response;
```

The evidence envelope distinguishes browser claims, authenticated session context, edge assessments and application actions. Browser measurements always carry `authenticated: false`; that describes the measurements, not whether the session has an authenticated account. All browser payload fields purporting to be trusted evidence are rejected. Missing evidence stays missing, never a manufactured low-risk probability.

This evidence is returned separately by `assess()` and is **never included in `handle()` JSON**, even with `exposeClientScores: true`. It is not added to browser histories or sent to Jev. Jev's narrow technical risk questions and deterministic identity matching remain unchanged. Activity and edge judgments are independent inputs for application policy, not unexplained adjustments to identity confidence. Application code must also keep them out of hydration props, browser analytics and logs.

### Cloudflare evidence

```ts
import {
  createCloudflareVisitor,
  cloudflareRequestEvidence,
} from "@janitor/adapters/cloudflare";

const visitor = createCloudflareVisitor({ db: env.VISITORS, ai: env.AI });
const assessment = await visitor.assess(request, {
  evidence: { edge: cloudflareRequestEvidence(request) },
});
return assessment.response;
```

The helper accepts the **original inbound Worker Request**. It allowlists `request.cf.botManagement.score`, `verifiedBot` and `signedAgent`, according to the [official Workers variables](https://developers.cloudflare.com/bots/reference/bot-management-variables/). It ignores headers, IPs, location, JA3/JA4 and other metadata. Missing or malformed fields are omitted. The raw Cloudflare score remains on its 1–99 scale; it is not converted into a calibrated Janitor probability. A signed-agent flag is provider evidence, not a user's delegation grant or a Janitor implementation of Web Bot Auth.

Do not reconstruct `request.cf` from incoming headers. If a Node/Phoenix origin receives evidence through a proxy, the application must authenticate that hop and prevent direct-origin/header spoofing before creating trusted context. No automatic header trust is installed. Edge evidence expires after 60 seconds, with five seconds of clock skew; session verification timestamps must be within 30 days. Adjust the application's actual authentication/step-up freshness policy independently.

## Record narrow funnel events

After your application observes the actual authentication or business outcome:

```ts
await visitor.evidence!.record({
  id: loginAttempt.id, // Stable application event ID for retries.
  type: "login-failure",
  action: "sign-in",
  subjectId: knownJanitorSubject.id, // Omit if the account is unknown.
  sessionId: serverSession.id,
});

const activity = await visitor.evidence!.velocity({
  subjectId: knownJanitorSubject.id,
  action: "sign-in",
  windowMs: 15 * 60_000,
});
// { source: "application", observedAt, windowMs, action, counts, total, saturated }
```

Event categories: `login-attempt`, `login-success`, `login-failure`, `verification-success`, `verification-failure`, `recovery-requested`, `recovery-completed`, `sensitive-action`, `action-denied`. Optional action categories: `sign-in`, `recovery`, `payment`, `profile-update`, `read`, `other`.

Recording requires at least one subject, actor or application session. Subject/actor references must exist in the identity directory; an optional visitor reference must exist in visitor storage. Event/session references are application-scoped HMAC labels at rest. No URLs, form fields, credentials, arbitrary event properties, raw IPs or user-supplied timestamps are accepted. An event's time is the server ingestion time. Recording a verification event does not authenticate its contents or automatically train the learning module.

A repeated event ID with the same semantic fields is idempotent, including concurrent delivery. Reusing it for different data throws an error. Deduplication lasts while the event is retained; after erasure/expiry cleanup, the application must prevent unwanted replay from its source system. There is no public ingestion endpoint or automatic forwarding to analytics vendors.

Velocity selects exactly one subject, session or actor and optionally an action. The window is 1 second to 24 hours, default 15 minutes. Indexed reads return at most `maxEventsPerQuery + 1` rows. When `saturated: true`, reported counts and `total` are **lower bounds**, not exact totals; do not interpret the cap as low activity. This bounds the returned data, not every physical database read. The [capacity report](CAPACITY.md) includes one million synthetic application events on local Postgres; a production event workload is still unmeasured.

## Auditable device associations

```ts
const link = await visitor.evidence!.linkDevice({
  subjectId: subject.id,
  visitorId: identity.visitorId,
  verification: {
    method: "passkey",
    issuer: "my-auth",
    eventId: verifiedAuthenticationEvent.id,
    verifiedAt: verifiedAuthenticationEvent.occurredAt,
  },
  expiresAt: Date.now() + 30 * 86_400_000,
});

const association = await visitor.evidence!.assessDevice({
  id: link.id,
  subjectId: subject.id,
  visitorId: identity.visitorId,
});

await visitor.evidence!.revokeDevice(link.id, {
  reason: "compromised",
  issuer: "my-auth",
  eventId: securityReview.id,
});
```

Only call `linkDevice` after the application verifies the credential or explicit device-approval proof and binds it to this account/session. Janitor records provenance; it does not perform the password/passkey/OAuth ceremony. Methods are `password`, `passkey`, `mfa`, `oauth`, `email-link`, `recovery`, `admin-review`. Device-link verification must be at most five minutes old, with five seconds of clock skew, and the association expires within 90 days.

The same issuer/event proof cannot be reused for another account/device association. Repeated matching calls preserve the original record and revocation. Revocation records its issuer, hashed event reference, reason and time; it cannot be undone by replaying the original proof. Reverification needs a new independently verified event. Supported reasons are `logout`, `device-removed`, `compromised`, `account-recovery`. `listDevices(subjectId, limit)` returns up to 100 recent associations, including retained revoked/expired records for review.

A shared browser can have separately verified associations with multiple accounts. Those accounts are not merged. An association is historical evidence, **not a device-bound credential, physical-device proof or authorization**. Copying a cookie plus an account reference cannot become account access. Require actual authentication/delegation; a fuzzy-restored visitor ID never creates or reinstates a verified link. The same browser's past anonymous activity is not retroactively assigned to a person.

## Native Elixir / Phoenix

```elixir
config = Janitor.new(
  repo: MyApp.Repo,
  protection: [secret: System.fetch_env!("JANITOR_PROTECTION_SECRET"), namespace: "my-app"],
  identity: [secret: System.fetch_env!("JANITOR_IDENTITY_SECRET"), namespace: "my-app"],
  evidence: [event_retention_days: 7, link_retention_days: 90, max_events_per_query: 1000]
)

Janitor.Evidence.record(config, %{
  id: attempt.id, type: "login-failure", action: "sign-in",
  subject_id: subject["id"], session_id: server_session.id
})
activity = Janitor.Evidence.velocity(config, %{subject_id: subject["id"], window_ms: 900_000})
{:ok, assessment} = Janitor.assess(config, payload, %{
  admission: %{account: authenticated_user.id, session: server_session.id},
  evidence: %{action: "payment"}
})
```

`Janitor.handle` stores private results in `conn.assigns.janitor_identity` and `conn.assigns.janitor_evidence`. Its measurement response is already sent: make sensitive-action decisions in your own action flow. `Janitor.Evidence.link_device`, `assess_device`, `list_devices`, `revoke_device`, `delete_session`, and `delete_subject_events` use atom input keys in snake_case and the same string-valued categories. Stored records and summaries use the same wire keys and HMAC scheme as TypeScript. Protection options use `window_ms`, `max_calls`, `max_concurrent`, `failure_threshold`, `cooldown_ms`, and `on_event`.

Existing Ecto installations add a migration calling `Janitor.Migration.upgrade_security()` with their configured prefix. Fresh `Janitor.Migration.up()` includes both migrations. The example apps apply them automatically through their documented migration commands. The new tables use indexed foreign keys for erasure; no production database is changed by working on this checkout.

## Retention, erasure and operational limits

`visitor.cleanup()` / `Janitor.cleanup(config)` also delete one bounded page of expired quota/control rows and, when enabled, up to 100 expired events and 100 retired device links per call. Event retention defaults to seven days (1–30); link cleanup defaults to 90 days (1–365) after expiry or first revocation. Subject/visitor erasure, including expired-visitor cleanup, can remove related evidence earlier through cascading deletion. Repeat maintenance periodically; there is no scheduler. Evidence cleanup respects its namespace and configured retention. Existing optional learning/delegation cleanup retains its separately documented behavior.

`deleteSession` removes a session's event records; `deleteSubjectEvents` removes events involving a subject as principal or actor. Deleting a subject or visitor through existing erasure APIs cascades its related events/links. Aggregate summaries are computed from retained events, so erased events immediately disappear from summaries. Hashed references and verified associations remain personal/linkable data. The implementer owns disclosure, collection policy and erasure authorization.

Regression tests exercise real Postgres and D1 SQL, shared admission across instances, malformed providers, timeout/circuit recovery, stale completions, duplicate delivery, proof reuse, shared devices, spoofed headers/body fields, retention and erasure. They do not establish fraud-detection accuracy, independently audit cryptography, or test an attack against another service. Copied compatible signals, gradual poisoning and credential theft remain possible; independent authentication, production monitoring and real-world calibration remain necessary.
