# Cross-device suggestions

A verified login connects a user across devices using your application's user ID. That works without AI. Before login, Doorman can optionally suggest that an anonymous visit resembles earlier sessions that ended in a verified login.

**This does not require training a model or running a learning service.** With `crossDevice: true`, your existing Doorman handler saves login-confirmed examples in your database and asks Jev to compare them. A new installation has no such history and will usually return unknown.

## Enable it

After [setting up the endpoint](IDENTITY-CONTEXT.md), add one option:

```ts
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";

const doorman = createDoorman({
  db,
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  crossDevice: true,
});
```

Vercel uses the same configuration. Cloudflare uses `ai: env.AI` instead of the direct evaluator key. Phoenix uses:

```elixir
Doorman.new(
  repo: MyApp.Repo,
  secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
  namespace: "my-app",
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  cross_device: true
)
```

Tables are set up automatically. There is no extra service, training job or manual migration. Without Jev, enabled feedback can accumulate but no Jev suggestion is available.

## Report the real login

Call `doorman.identify()` during the anonymous visit and `doorman.identify(user.id)` after successful login. Your endpoint must also pass the authenticated user in its server-owned `auth` context. The browser's claimed user ID is not verification.

A short-lived, first-party cookie connects the anonymous measurement to that later login. The flow expires after 30 minutes by default. Only independently confirmed self-person logins become examples. Conflicting users and delegated or agent sessions are excluded; predictions never label themselves.

The feature is off by default. Enable it only when your application's collection policy permits it. Your server can pass `learningConsent: false` to withdraw a session even when `crossDevice` is enabled. Stop the browser client too when withdrawing collection generally.

## Read the suggestion privately

```ts
const result = await doorman.assess(request); // Anonymous visit.
if (result.context?.basis === "login-history") {
  // Private candidates and scores for evaluation, never a login or SDK identify call.
  const candidates = result.context.candidates;
}
return result.response;
```

Phoenix exposes the same private context in `conn.assigns.doorman_context`. The browser response stays `{ visitorId, sessionId, isReturning }`.

A remembered browser/account relationship from an earlier login is different: it has `basis: "cookie-history"`. A possible browser match has `basis: "browser-similarity"`. Neither establishes who is using that browser now.

## Why Doorman often returns unknown

The lookup uses indexed language/timezone hints, not an exhaustive search. It declines crowded cohorts rather than hide alternatives. Jev receives at most ten possible people, with up to three confirmed examples each; a person needs at least two independently confirmed sessions. Matching locale alone is not enough.

The current suggestion threshold is 0.90 with a 0.10 lead over alternatives. These are experimental settings, **not calibrated probabilities**. Cookie loss, different devices, shared environments and missing data can all leave too little evidence.

Suggestions do not sign anyone in, grant access, replace authenticated user IDs, merge analytics profiles or change risk scores. Build normal funnels using real logins; evaluate tentative matches separately against later outcomes. See [testing and limitations](VALIDATION.md).

## Retention and cost

Login feedback defaults to 30 days and up to 20 confirmed sessions per person. `cleanup()` expires retained data; `forgetUser(rawUserId)` erases a user's relationships and dependent feedback. Stop collection before deletion and erase exported copies separately.

Eligible cross-device evaluation adds a provider call under the same [shared AI budget](HARDENING.md). It uses compact observations with request-local candidate indexes; persistent user IDs and raw emails are not sent to Jev. See [privacy](../PRIVACY.md).
