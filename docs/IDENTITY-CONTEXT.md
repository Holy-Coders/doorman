# Add Doorman to your app

Connect three things: your browser client, your existing login, and your database. Start without AI. Add analytics and scoring after the first visit works.

This guide covers Doorman 0.13. [Install the packages](LANGUAGES.md), or [try the source example](GETTING-STARTED.md). For Phoenix, use the [native setup](../packages/elixir/README.md).

## 1. Configure the server

This example uses Node and Postgres. Create one handler for your application:

```ts
import { Pool } from "pg";
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";

const doorman = createDoorman({
  db: new Pool({ connectionString: process.env.DATABASE_URL }),
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: false,
});
```

Generate the secret once with `openssl rand -hex 32` and save it in your server environment. Keep it stable across restarts and instances. The `namespace` names this application. Use a dedicated database or schema per application.

**Doorman creates its tables automatically.** Your database must exist and the connection must be allowed to create tables and indexes. There are no migration commands to run. See [storage and retention](../site/content/storage.md).

Use the same setup for [Next.js](../examples/nextjs/README.md), with the `/vercel` import. On [Cloudflare](../examples/cloudflare-worker/README.md), use the `/cloudflare` import and `db: env.VISITORS`; omit `evaluator`.

## 2. Mount the endpoint

At `POST /api/visitor`, read the user from **your existing server authentication**, then pass that verified ID to Doorman:

```ts
const result = await doorman.assess(request, {
  auth: currentUser ? { userId: String(currentUser.id) } : undefined,
});

// Keep result.context, result.identity and result.properties on the server.
return result.response;
```

`request` is a Web Request. `currentUser` comes from your session middleware; it is not a Doorman global. The framework guides show where this code belongs. Return `result.response` directly so cookies and headers reach the browser.

If your app has workspaces, add the account your server authorized: `auth: { userId, accountId }`. For an authenticated agent acting for a user, add `actor: { id: agent.id, kind: "agent" }`. Your app must verify that agent's credential and permission first. Never take these fields from the measurement JSON body.

No login integration yet? `return doorman.handle(request)` handles anonymous browser visits by itself.

## 3. Add the browser client

Create one client when your application's collection policy allows it:

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({ endpoint: "/api/visitor" });
const identity = await doorman.identify();
// { visitorId, sessionId, isReturning }
```

The first call sets a first-party, HttpOnly cookie. Later calls reuse the browser ID. `sessionId` groups recent visits and expires after 30 minutes between assessments; it is separate from your login session.

Call `doorman.destroy()` when the client is no longer needed. In React, create it in an effect and destroy it on unmount. In Phoenix, preserve CSRF protection and use the [bundled browser module](../packages/elixir/README.md).

## 4. Connect analytics, if you use it

Pass your already initialized PostHog or Mixpanel SDK to the client:

```ts
const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  analytics: { posthog, mixpanel }, // Include only the tools you use.
});

// After login succeeds, or when loading an already signed-in session:
await doorman.identify({
  userId: String(user.id),
  accountId: String(account.id),
});
// Optional helper: sends to both configured providers.
// Do not also capture/track this event directly in those SDKs.
await doorman.track("Project created");
// After logout, before recording another person's activity:
await doorman.reset();
```

Omit `accountId` if you do not have workspaces. Doorman calls the providers' identify/reset methods for you. Existing `posthog.capture` and `mixpanel.track` calls also receive safe browser/session/account properties.

**You can keep your existing event calls instead of using `doorman.track()`.** The helper forwards to every configured provider; use one delivery path per event per destination to avoid duplicates. See [the two tracking options](ANALYTICS.md).

Your app still needs to call Doorman on initial load, login, account switches and logout. It does not watch your authentication system automatically. A browser call also cannot authenticate a user to your server: step 2 supplies that evidence.

Keep measurement errors from interrupting login or navigation. See [the analytics lifecycle](ANALYTICS.md) for error handling, user switching and provider-specific behavior.

## 5. Add optional scoring

For Node or Next.js, replace `evaluator: false` with `evaluator: { apiKey: process.env.JEV_API_KEY! }`. On Cloudflare, pass `ai: env.AI`. Jev evaluates browser similarity and risk; provider charges may apply. Read [Jev and risk scoring](JEV.md) before choosing a policy.

Use `collection: "extended"` on the browser client to add bounded behavior, font and runtime summaries. Use `crossDevice: true` on the server to collect later-login feedback for tentative cross-device matching. Both are optional. Neither turns an estimate into a login or an analytics profile merge.

## Read what is known and what is estimated

| Private context | Meaning                                                                   | Appropriate use                                                                               |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `authenticated` | Your server verified the current user and actor.                          | Normal user funnels and account membership.                                                   |
| `remembered`    | This browser cookie previously accompanied an authenticated relationship. | Returning-browser analysis, with the previous user kept separate from current authentication. |
| `inferred`      | History suggests a possible previous browser or user.                     | Exploratory reports and evaluation against later logins.                                      |
| `ambiguous`     | More than one retained relationship fits this browser.                    | Shared-browser analysis; do not pick the most recent person as fact.                          |
| `unknown`       | No supported relationship is available.                                   | Keep the anonymous browser identity.                                                          |

`context.basis` explains the source: authentication, cookie history, browser similarity, login history, or none. Candidates carry HMAC-labeled IDs; these are pseudonymous, not anonymous. At most ten associations are returned, with `truncated: true` when more exist.

The recommended flow preserves IDs through cookie continuity. Without a cookie it issues a new browser ID and returns a strong previous-browser match privately. It never silently merges an uncertain browser or person into analytics.

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

## Retention and failure behavior

Doorman retains observations and remembered browser relationships for 90 days by default. Relationships refresh only after a verified login. Call `doorman.cleanup()` from your existing maintenance schedule; the library does not create a scheduler.

`doorman.forgetUser(rawUserId)` removes the user's associations and dependent learning history. `doorman.deleteVisitor(visitorId)` erases a browser. Delete exported copies through your analytics provider too. [Full retention guide](../site/content/storage.md).

Jev has a short timeout and a shared database budget, defaulting to 60 reserved provider calls per minute. If evaluation is unavailable, identification continues using built-in comparison rules. Check the status: zero fallback risk means “not assessed.” Database or automatic table-setup failures produce a controlled 503, without exposing database details to the browser.
