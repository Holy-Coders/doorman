# One integration for identity context

**0.13 is currently available from source.** The latest npm and Hex release is 0.12.0. The unified API below requires the source checkout, not the current registry release. [Run from source](https://github.com/Holy-Coders/doorman).

Doorman connects browser visits to the users and accounts your application already knows. It also returns private estimates about uncertain identity and activity. Your login system remains responsible for authentication, and PostHog or Mixpanel remains your analytics system.

The recommended API is `createDoorman` on the server and `createDoormanClient` in the browser. In Phoenix, use `Doorman.new` with `secret` and `namespace`. This API is introduced in 0.13.0; earlier releases expose the lower-level visitor and identity-directory methods.

## Install and migrate

```sh
npm install @aarondovturkel/doorman-browser @aarondovturkel/doorman-adapters pg
# Or: pnpm add … / bun add …
```

Use a stable random secret of at least 32 characters, stored on the server. `namespace` identifies one application or tenant. Changing either breaks associations with the old HMAC-labeled users. Use a separate database/schema per application; namespaces isolate subject associations, not the underlying browser-observation store.

Apply all Postgres or D1 migrations for a new installation. An existing 0.12 installation needs `0010_browser_associations.sql` from its storage package. This additive table stores only relationships verified by your application. No queue or new service is required.

## Set up the server once

```ts
import { Pool } from "pg";
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";

const doorman = createDoorman({
  db: new Pool({ connectionString: process.env.DATABASE_URL }),
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: { apiKey: process.env.JEV_API_KEY! }, // Or false.
  crossDevice: true,
});
```

For Next.js, import from `@aarondovturkel/doorman-adapters/vercel`. For Cloudflare, import from `@aarondovturkel/doorman-adapters/cloudflare` and pass `{ db: env.VISITORS, ai: env.AI, secret, namespace, crossDevice: true }`. Workers AI needs no TypeSafe key. Reuse the handler across requests.

Your endpoint receives authenticated context from your existing server middleware:

```ts
const result = await doorman.assess(request, {
  auth: currentUser
    ? { userId: currentUser.id, accountId: currentAccount.id }
    : undefined,
});

// Private server fields:
// result.context, result.identity, result.properties, result.riskEvidence
return result.response;
```

`currentUser` and `currentAccount` above are supplied by your application. Never copy `auth`, an IP address, or reputation claims from the visitor JSON body. The body accepts browser signals and behavior only.

If authentication verified a separate actor, include it:

```ts
auth: {
  userId: principal.id,
  accountId: account.id,
  actor: { id: authenticatedAgent.id, kind: "agent" },
}
```

The application must verify that actor and its authority to act for the principal. Use `kind: "person"` for a separately authenticated human. Different passwords, member credentials or explicit profiles can distinguish account members; browser telemetry cannot prove that a shared login belongs to a husband or wife.

## Connect the browser and analytics

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  collection: "extended", // Optional; minimal is the default.
  analytics: { posthog, mixpanel }, // Your initialized SDKs.
});

await doorman.identify();
// After login completes on the server:
await doorman.identify({ userId: user.id, accountId: account.id });
await doorman.update({ plan: "team" });
await doorman.track("Project created", { plan: "team" });
// On logout or before switching accounts:
await doorman.reset();
// On teardown:
doorman.destroy();
```

The browser response contains `visitorId`, `sessionId` and `isReturning`. Scores, candidates and remembered account IDs are private. The session cookie expires after 30 minutes of inactivity between assessments; it is an analytics correlation ID, not an authenticated session.

You can continue calling existing `posthog.capture` or `mixpanel.track`: Doorman registers the safe browser/session/account properties through the SDKs' super-property APIs. Wrapper events receive the same context. Account changes and `reset()` clear old context. Call Doorman on initial load, after login, on account switches and on logout; you do not need to identify through both analytics SDKs yourself.

Only the PostHog and Mixpanel adapters currently enrich direct SDK calls this way. Other supported providers receive context on events sent through `doorman.track`. Provider autocapture, replay and consent settings remain under your application's control.

## Read what is known and what is estimated

| Private context | Meaning                                                                   | Appropriate use                                                                               |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `authenticated` | Your server verified the current user and actor.                          | Normal user funnels and account membership.                                                   |
| `remembered`    | This browser cookie previously accompanied an authenticated relationship. | Returning-browser analysis, with the previous user kept separate from current authentication. |
| `inferred`      | History suggests a possible previous browser or user.                     | Exploratory reports and evaluation against later logins.                                      |
| `ambiguous`     | More than one retained relationship fits this browser.                    | Shared-browser analysis; do not pick the most recent person as fact.                          |
| `unknown`       | No supported relationship is available.                                   | Keep the anonymous browser identity.                                                          |

`context.basis` explains the source: authentication, cookie history, browser similarity, login history, or none. Candidates carry HMAC-labeled IDs; these are pseudonymous, not anonymous. At most ten associations are returned, with `truncated: true` when more exist.

The recommended flow preserves IDs through cookie continuity. Without a cookie it issues a new browser ID and returns a strong previous-browser match privately. It never silently merges an uncertain browser or person into analytics. The older `createNodeVisitor`/`createCloudflareVisitor` APIs retain their configurable browser-ID recovery behavior.

## Cross-device suggestions

`crossDevice: true` uses the existing learning tables and the configured Jev evaluator. Anonymous observations that later lead to a verified self-login become feedback examples. Conflicting users, agents and delegated sessions do not become self-login labels. The Jev predictor requires repeated independently confirmed flows and can abstain.

A new anonymous device may receive a private candidate with `basis: "login-history"` and a score. Different devices often share little identifying evidence, so unknown results are expected. Scores are **uncalibrated estimates**, not proven probabilities that two people are the same. Predictions never become their own training labels, authenticated identities, SDK `identify` calls or irreversible aliases.

The feature is off unless configured. Applications control disclosure and permission. `learningConsent: false` explicitly withdraws a session even when collection is enabled at the application level.

## Activity and reputation

Extended collection enables the existing bounded font, runtime, permission, target/focus and movement/timing summaries. It does not send actual keys, coordinates, form content or recordings. Some probes are experimental: a font difference, missing browser API or lack of mouse movement does not establish a bot. See [collected signals](../PRIVACY.md).

`createDoorman` asks Jev for human, assistant and scripted-automation scores when enough aggregate activity is present. Sparse sessions return `operator.status: "insufficient-evidence"` and label `unknown`. Classification is separate from suspicious activity: an authorized assistant can be highly automated and legitimate. These labels have not established reliable agent-brand recognition or human headcounts.

Supply bounded, server-owned counters and trusted edge metadata through `riskEvidence`. For example:

```ts
const result = await doorman.assess(request, {
  riskEvidence: {
    activity: {
      windowMs: 60_000,
      requests: 40,
      denials: 8,
      authenticationFailures: 3,
    },
  },
});
```

Use the optional [API activity middleware](API-ACTIVITY.md) and [linked-activity service](LINKED-ACTIVITY.md) to collect route templates and compare related requests across sessions. Neither is enabled by the simple constructor. This preserves a small default installation; applications with abuse-sensitive routes add those hooks explicitly. Raw query strings and request bodies are not captured.

For external network reputation, set `reputation: { apiKey: process.env.ABUSEIPDB_API_KEY! }` in the server configuration and supply `clientIp` from a trusted connection/proxy resolver. No IP is inferred from arbitrary forwarded headers. This is a read-only [AbuseIPDB check](https://docs.abuseipdb.com/#check-endpoint), with a default 500 ms deadline, five-minute cache and shared database budget of 100 checks/hour per namespace. TypeScript caches locally in the reusable handler; Phoenix caches in the existing database. Configure `timeoutMs`, `cacheTtlMs`, `maxRequestsPerHour` (snake case in Elixir) and the provider's own account quota.

The provider receives the IP. Doorman stores HMAC cache keys and a small scored summary, never the raw IP, and never sends raw IPs to Jev or automatically reports visitors. A network reputation score is provider evidence, not a verdict about an individual. Errors return an unavailable/limited status and do not interrupt identification. Reputation and request-risk evidence reach only the risk questions, never identity matching.

## Use the private context in analytics

`result.properties` is a flat event snapshot ready for a server analytics SDK. It includes browser/session IDs, verified subject/actor context, identity status and basis, risk availability, optional operator scores, and optional reputation source/age. A single uncertain candidate is under `doorman_candidate_subject_id`, never `doorman_subject_id`.

Attach these properties to your existing server event for a checkout, login or other action. Use the analytics identity established by your own authentication or anonymous event flow. Do not replace it with the inferred candidate.

Useful reports:

- **Normal funnel:** anonymous visit → verified signup → purchase, using the provider's normal identity join.
- **Account usage:** distinct verified `doorman_subject_id`, `doorman_actor_id`, browsers and sessions, grouped by account.
- **Activity mix:** evaluated human/assistant/script scores, with unknown and unavailable sessions counted explicitly.
- **Cross-device experiment:** candidate predictions compared with later authenticated outcomes. Keep these separate from the canonical funnel until you have measured false links.

“Three verified agent credentials” is measurable. “Probably three separate agents” is a model estimate. Neither establishes three physical machines or proves that two humans share one password.

## Phoenix

```elixir
# mix.exs
{:doorman_identity, "~> 0.13.0"}
```

For a new Ecto installation, use `Doorman.Migration.up()` in your migration. Existing installations add:

```elixir
defmodule MyApp.Repo.Migrations.AddDoormanContext do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_context()
  def down, do: raise("Erase retained associations before removing this table")
end
```

```elixir
doorman = Doorman.new(
  repo: MyApp.Repo,
  secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
  namespace: "my-app",
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  cross_device: true
)

# In the existing authenticated controller pipeline:
auth = if user = conn.assigns[:current_user], do: %{user_id: to_string(user.id)}
conn = Doorman.handle(conn, doorman, %{auth: auth})
# Private: conn.assigns.doorman_context / doorman_properties / doorman_identity
# The response sent by handle contains only browser/session IDs and isReturning.
```

Use `account_id` and `actor: %{id: "agent-123", kind: :agent}` when your server has verified them. Keep the existing CSRF protection. The package serves the same browser client at your configured static path. See the [Phoenix example](../examples/phoenix/README.md).

Existing `analytics` configuration with `analytics_consent: true` and a server-owned `analytics_id` now includes the private context snapshot in its explicit server event. Alternatively, attach `conn.assigns.doorman_properties` to your own server analytics event. Private fields are not registered in the browser SDK.

## Retention and failure behavior

Associations expire after `observationRetentionDays` (default 90), refreshed only by a verified login observation. Call `doorman.cleanup()` periodically from your existing scheduler. `doorman.forgetUser(rawUserId)` removes that user's associations, directory record and dependent learning history. `deleteVisitor` removes the browser and its associations. Phoenix equivalents are `Doorman.cleanup`, `forget_user` and `delete_visitor`. Erase copies already exported to analytics through that provider's API too.

Jev has a short deadline and a shared database evaluation budget (default 60 reserved provider calls/minute); a single assessment can include separate identity and risk provider requests. Match recovery falls back to deterministic evidence when unavailable. Risk/classification status explains whether an assessment ran; zero fallback risk does not mean proven safe. Storage failures return a controlled 503. Doorman never blocks an application action or displays a CAPTCHA.
