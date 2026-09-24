# API reference

These docs cover the Doorman 0.13 integration. Start with [add Doorman to your app](IDENTITY-CONTEXT.md) for a complete example. You need one server handler and one browser client.

## Server setup

Import `createDoorman` from `@aarondovturkel/doorman-adapters/node` or `/vercel`:

```ts
const doorman = createDoorman({
  db, // Your Postgres pool.
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: false,
});
```

For Cloudflare, use the `/cloudflare` import with `db: env.VISITORS` and optional `ai: env.AI`. For Phoenix, use [the native Elixir API](../packages/elixir/README.md).

Reuse the handler across requests. Tables are created automatically; the database must exist and allow schema creation. Keep the secret and namespace stable.

## Server methods

| Method                       | Use                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `handle(request, { auth? })` | Return public identity JSON and cookies.                                                   |
| `assess(request, context?)`  | Return that response plus private identity, account context and analytics properties.      |
| `ready()`                    | Optionally prepare tables before accepting traffic. First database use also prepares them. |
| `cleanup(options?)`          | Remove expired history in bounded batches.                                                 |
| `forgetUser(rawUserId)`      | Erase a user's remembered relationships and dependent login feedback.                      |
| `deleteVisitor(visitorId)`   | Erase a browser and its relationships.                                                     |

Pass authentication from your server, never from the browser payload:

```ts
const result = await doorman.assess(request, {
  auth: {
    userId: String(currentUser.id),
    accountId: String(currentAccount.id), // Omit without workspaces.
    // actor: { id: agent.id, kind: "agent" }, // Only after verifying its permission.
  },
});

// result.context: authenticated / remembered / inferred / ambiguous / unknown
// result.identity: browser matching, risk and optional activity scores
// result.properties: flat properties for your server analytics event
return result.response;
```

Omit `auth` for anonymous visits. A validation or database failure can leave private results absent; check `result.response.ok` before using them. Return only `result.response` to the browser.

Additional trusted context accepts `riskEvidence`, an explicitly resolved `clientIp` for optional reputation, `admission` keys for request quotas, and `learningConsent: false` to withdraw login-feedback collection for that session. See [identity context](IDENTITY-CONTEXT.md) and [limits](HARDENING.md).

## Common server options

| Option                      | Default or behavior                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `evaluator`                 | Node/Vercel: disabled unless configured; `{ apiKey }` enables Jev. Cloudflare uses `ai`. |
| `evaluatorTimeoutMs`        | Short bounded deadline; see [Jev](JEV.md) and inference limits.                          |
| `crossDevice`               | `false`; opt into confirmed login feedback and private suggestions.                      |
| `classifyOperator`          | `true` in the recommended API; needs an evaluator and enough activity evidence.          |
| `scoring`                   | Optional TypeScript browser similarity and confidence weights.                           |
| `activity`                  | Off; configure route templates to enable request aggregates.                             |
| `reputation`                | Off; requires provider credentials and a trusted client IP.                              |
| `observationRetentionDays`  | `90`.                                                                                    |
| `maxObservationsPerVisitor` | `10`; matching reads at most five recent observations.                                   |
| `cookie`                    | `__visitor`, Secure, HttpOnly, SameSite=Lax, Path=/.                                     |
| `maxInFlightRequests`       | `64` per reusable TypeScript handler.                                                    |
| `protection`                | Shared database request and evaluator limits; [configuration](HARDENING.md).             |
| `autoMigrate`               | `true`; leave on for normal installation.                                                |

The recommended flow always keeps scores private, disables AI lookup planning and creates a fresh browser ID when a usable cookie is missing. A possible previous-browser match remains private evidence; it does not restore a guessed identity or merge analytics profiles.

## Browser setup

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  analytics: { posthog, mixpanel }, // Optional initialized SDKs.
  collection: "minimal", // Default; "extended" adds optional summaries.
});
```

The endpoint must be on your application's origin. `headers` can supply a Phoenix CSRF token. `enabled: false` delays collection until `setEnabled(true)`.

| Method                                      | Use                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `identify()`                                | Measure an anonymous browser.                                                           |
| `identify(userId, traits?)`                 | Identify after your app verifies login, then measure the browser.                       |
| `identify({ userId, accountId? }, traits?)` | The same, with workspace context.                                                       |
| `update({ name?, email?, plan? })`          | Update the current identified user's profile.                                           |
| `track(event, properties?)`                 | Optional forwarding to connected analytics SDKs. Do not also track that event directly. |
| `reset()`                                   | Reset analytics identity and local measurement state after logout or user switching.    |
| `setEnabled(boolean)`                       | Pause or resume Doorman collection.                                                     |
| `destroy()`                                 | Remove listeners and discard pending measurements. Create a new client after teardown.  |

The public identification result is `{ visitorId, sessionId, isReturning }`. Calls can reject on network, request or storage failure; catch measurement errors so they do not break login or navigation. `reset()` does not log the user out or delete the HttpOnly cookie.

Existing PostHog/Mixpanel events can stay. See [the analytics guide](ANALYTICS.md) for the optional tracking helper, identity lifecycle and other providers. Doorman does not enable session replay, capture application logs or configure analytics dashboards.
