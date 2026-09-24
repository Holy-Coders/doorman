# Doorman

**Doorman 0.13.** Install from [npm and Hex](docs/LANGUAGES.md), or run the [source examples](https://github.com/Holy-Coders/doorman/tree/main/examples).

<img src="https://doorman.holycoders.io/doorman-mark.png" alt="Doorman" width="96" />

Durable first-party visitor identity from browser history, with optional AI-assisted matching and risk scoring.

Know the context behind a request: the browser, session, account, authenticated user or agent, and what is still uncertain. Keep PostHog or Mixpanel for analytics. Run Doorman on your own server with your existing Postgres or D1 database.

[Docs](https://doorman.holycoders.io/docs/introduction/) · [Complete integration](docs/IDENTITY-CONTEXT.md) · [Playground](https://doorman.holycoders.io/playground/) · [Measured limitations](docs/DETECTION-VALIDATION.md)

## One browser client

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  analytics: { posthog, mixpanel }, // Your initialized SDKs; optional.
});

await doorman.identify();
// After your application's login succeeds:
await doorman.identify({ userId: user.id, accountId: account.id });
await doorman.update({ plan: "team" });
await doorman.track("Project created");
// On logout:
await doorman.reset();
```

Existing `posthog.capture` and `mixpanel.track` calls also receive safe browser/session/account context. You do not need to identify through both SDKs. Scores and guessed user IDs stay private. Call `doorman.destroy()` on teardown.

## One server entry point

```ts
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";

const doorman = createDoorman({
  db, // A Postgres pool.
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: false, // Add Jev later if you need scoring.
});

const result = await doorman.assess(request, {
  auth: currentUser
    ? { userId: currentUser.id, accountId: currentAccount.id }
    : undefined,
});

// Private: result.context, result.identity, result.properties
return result.response;
```

`currentUser` and `currentAccount` come from your existing server authentication. Never trust browser JSON for them. The response contains only `{ visitorId, sessionId, isReturning }`.

For **Next.js/Vercel**, use the same API from `@aarondovturkel/doorman-adapters/vercel`. For **Cloudflare**:

```ts
import { createDoorman } from "@aarondovturkel/doorman-adapters/cloudflare";
const doorman = createDoorman({
  db: env.VISITORS,
  ai: env.AI,
  secret: env.DOORMAN_IDENTITY_SECRET,
  namespace: "my-app",
  crossDevice: true,
});
return doorman.handle(request);
```

Workers AI runs `typesafe/jev`; no separate TypeSafe key is needed. Reuse the handler across requests. Doorman creates its tables automatically on first use. No migration commands are required.

For **Elixir/Phoenix**:

```elixir
doorman = Doorman.new(
  repo: MyApp.Repo,
  secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
  namespace: "my-app",
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  cross_device: true
)

Doorman.handle(conn, doorman, %{auth: %{user_id: to_string(current_user.id)}})
# Private context and analytics properties are in conn.assigns.
```

The native Elixir package is `{:doorman_identity, "~> 0.13.0"}`. The package initializes its own tables in your Ecto Postgres repo. [Full Phoenix setup](packages/elixir/README.md).

## What the context means

| Status          | Evidence                                                        |
| --------------- | --------------------------------------------------------------- |
| `authenticated` | Your server verified the current user and actor.                |
| `remembered`    | This browser cookie previously accompanied a verified identity. |
| `inferred`      | Browser or login history suggests a possible relationship.      |
| `ambiguous`     | Multiple retained identities used this browser.                 |
| `unknown`       | There is not enough evidence.                                   |

An account can contain several users or agent credentials, and one user can have several browsers. Cookie continuity proves neither a particular human nor permission. Missing-cookie and cross-device suggestions never silently merge analytics identities in the recommended flow. The lower-level visitor APIs retain configurable browser-ID recovery for applications that explicitly want it.

## Risk, separately from identity

Optional Jev evaluation returns automation and suspicious-activity scores. With enough aggregate evidence, the unified flow also asks for human, assistant and script scores. An assistant can be legitimate; an unknown session remains unknown.

```ts
if (
  result.identity?.riskStatus === "evaluated" &&
  result.identity.risk.automation > 0.85
) {
  // Your application may request extra verification.
}
```

The threshold is illustrative. Doorman never blocks an application action or shows a CAPTCHA. Optional server middleware adds request-pattern evidence. Optional AbuseIPDB enrichment adds cached, budgeted network reputation without storing raw IPs or sending them to Jev. [Configuration and data flow](docs/IDENTITY-CONTEXT.md).

Risk evidence never enters identity questions. Jev timeouts or malformed output fall back cleanly, with unavailable status and zero fallback risk. This means “not assessed,” not “proven safe.” Database errors return a controlled response.

**Classification and cross-device scores are experimental and uncalibrated.** The public-data pilot did not reliably separate all humans and agents. Browser similarity cannot establish family relationships, exact human headcounts or agent brands. [Tests and live results](docs/DETECTION-VALIDATION.md).

## Install and run

```sh
npm install @aarondovturkel/doorman-browser@^0.13.0 @aarondovturkel/doorman-adapters@^0.13.0
# Or use pnpm add / bun add with the same package names.
```

[Node/Fastify](examples/node-fastify/README.md) · [Next.js](examples/nextjs/README.md) · [Cloudflare](examples/cloudflare-worker/README.md) · [Phoenix](examples/phoenix/README.md) · [Other languages](docs/LANGUAGES.md)

From source, with Node 22.12+ and pnpm 9.12:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
```

`pnpm test:e2e` checks real browser/analytics SDK behavior against local endpoints. `pnpm test:elixir` requires a local Postgres database. Provider calls in the regression suite are mocked. Published benchmark results distinguish fixtures, public datasets, live Jev calls and load tests.

## Keep the deployment small

One browser client → your endpoint → indexed history → deterministic comparison → optional Jev → your database and analytics.

A cookie handles the normal return visit. Missing-cookie lookup retrieves a bounded shortlist, compares recent history, and asks typed questions through Jev. Confirmed login feedback can support private cross-device suggestions. Associations expire and can be erased through the same server API.

The network-learning service, custom classifier training, operator-profile research, delegation tools and warehouse exporters remain optional advanced modules. You do not need them to start.

Read [the design](docs/SIMPLE-DESIGN.md), [privacy](PRIVACY.md), [analytics](docs/ANALYTICS.md), [request activity](docs/API-ACTIVITY.md), [scoring](docs/SCORING.md) and [retention](site/content/storage.md). MIT licensed.
