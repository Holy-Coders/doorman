# Janitor

<img src="https://janitor.holycoders.io/janitor-mark.svg" alt="Janitor" width="96" />

Durable first-party visitor identity from browser history, with optional AI-assisted matching and risk scoring.

Janitor is an open-source library for recognizing returning browsers. It runs on your server, stores a small history in your database, and can use **Jev**, an AI model from TypeSafe, to help assess matches and technical risk.

[Introduction](https://janitor.holycoders.io/docs/introduction/) · [Quickstart](docs/GETTING-STARTED.md) · [Playground](https://janitor.holycoders.io/playground/) · [GitHub release](https://github.com/Holy-Coders/janitor/releases/tag/v0.9.0)

## In the browser

```ts
import { createVisitorClient } from "@janitor/browser";

const visitor = createVisitorClient({ endpoint: "/api/visitor" });
const identity = await visitor.identify();
// { visitorId: "vis_…", isReturning: true }

// When the component unmounts or collection should stop:
visitor.destroy();
```

The client needs a Janitor endpoint in your application. That endpoint sets an HttpOnly cookie and saves browser observations. If a returning browser loses its cookie, Janitor can recover its ID from a sufficiently strong match with retained history.

Confidence and risk stay on your server by default. Janitor never automatically blocks a user or displays a CAPTCHA. Your application decides what to do with the information.

## One identity layer for your analytics

```ts
import { createJanitorClient } from "@janitor/browser";
const janitor = createJanitorClient({
  endpoint: "/api/visitor",
  analytics: { posthog, mixpanel, segment: analytics }, // Your initialized SDKs.
});
await janitor.identify();
// After your application verifies login:
await janitor.identify(user.id, { email: user.email });
await janitor.update({ plan: "team" });
await janitor.track("Project created", { plan: "team" });
// On logout:
await janitor.reset();
```

Janitor manages provider identification, profile updates and account switching. Providers retain their anonymous IDs for correct login joins; events sent through Janitor carry its browser ID. See [the analytics guide](docs/ANALYTICS.md).

With Jev and the identity directory configured, `learning: { enabled: true, collectionPolicy: "application" }` also enables built-in cross-device suggestions from login-confirmed history. No custom predictor is required. Suggestions stay private and never become a login or analytics merge. [Set up learning](docs/LEARNING.md).

The separate opt-in [learning service](docs/LEARNING-NETWORK.md) can discover recurring assistant and abuse patterns from sampled summaries and independently confirmed outcomes. It includes authenticated ingestion, Postgres/D1 storage, readable pattern discovery, future-session/application holdouts, shadow/canary rollout and erasure. Remote evaluation, contribution and training are separate choices; ordinary installations send it no data. This pilot is available from source and has not established real-world detection accuracy.

The [classifier pipeline](docs/CLASSIFIER.md) now compares numeric logistic and boosted-tree models, with optional versioned Jev features. It trains offline and serves private assistant/abuse assessments in TypeScript. Start with `pnpm classifier demo`: 3,000 generated sessions, no paid calls, and models that cannot qualify for production promotion. [Research and limits](docs/CLASSIFIER-RESEARCH.md).

## Choose your server

### Cloudflare Workers

```ts
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";

const visitor = createCloudflareVisitor({
  db: env.VISITORS, // Your D1 binding.
  ai: env.AI, // Optional Workers AI binding for Jev.
});
return visitor.handle(request);
```

No separate TypeSafe API key is needed for Workers AI. [Cloudflare setup](examples/cloudflare-worker/README.md).

### Next.js / Vercel

```ts
import { Pool } from "pg";
import { createVercelVisitor } from "@janitor/adapters/vercel";

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const visitor = createVercelVisitor({ db, evaluator: false });

export const runtime = "nodejs";
export async function POST(request: Request) {
  return visitor.handle(request);
}
```

Use any compatible Postgres service. Replace `evaluator: false` with `evaluator: { apiKey: process.env.JEV_API_KEY! }` to enable Jev. [Next.js setup](examples/nextjs/README.md).

### Node

```ts
import { Pool } from "pg";
import { createNodeVisitor } from "@janitor/adapters/node";

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const visitor = createNodeVisitor({ db, evaluator: false });
const response = await visitor.handle(request);
```

The handler uses standard Web Request/Response APIs. The [Fastify example](examples/node-fastify/README.md) shows how to connect a framework route.

### Elixir / Phoenix

```elixir
# mix.exs
{:janitor, github: "Holy-Coders/janitor", tag: "v0.9.0", sparse: "packages/elixir"}
```

```elixir
janitor = Janitor.new(repo: MyApp.Repo)
Janitor.handle(conn, janitor)
```

This implementation runs natively in Elixir with Ecto/Postgres. The package includes the browser client. [Phoenix installation](packages/elixir/README.md).

Apply the database migrations before using any adapter. The v0.9.0 JavaScript release includes migrations `0001` through `0008`; the Elixir package provides Ecto migration functions. Each app should use its own database or schema.

## Read risk privately

Use `assess()` when server code needs the full result:

```ts
const { response, identity } = await visitor.assess(request);
if (!identity) return response; // A validation or storage error.

const needsExtraVerification =
  identity.riskStatus === "evaluated" && identity.risk.automation > 0.85;

// Save the decision in your existing server session if a later action needs it.
// Your app chooses whether to show a CAPTCHA or another verification step.
return response;
```

The threshold is an example, not a calibrated recommendation. A browser ID is not a login credential, and an automated session can be legitimate. If Jev is disabled or unavailable, browser matching uses built-in rules; risk values default to zero with a status explaining that no assessment is available. [Scores and failure handling](docs/SECURITY.md).

## Add users, agents and analytics

Your existing authentication system verifies people and agents. Janitor can record those identities, link their signed-in devices, and check limited permissions for an agent acting for a user. These are explicit verified relationships; browser matching alone does not establish them.

- [Understand browsers, people and agents](docs/CONCEPTS.md).
- [Register users, verified keys and agent permissions](docs/AGENTIC-IDENTITY.md).
- [Connect PostHog, Mixpanel or Segment](docs/ANALYTICS.md).
- [Understand API activity with Phoenix or Web middleware](docs/API-ACTIVITY.md).
- [Experiment with optional login feedback](docs/LEARNING.md).

## Install or run an example

Janitor v0.9.0 is a developer preview. Packages are available as GitHub archives; they are not yet published to npm or Hex. [Installation instructions](docs/LANGUAGES.md) cover npm, pnpm, Bun, Mix and existing applications.

To work from source:

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

Requires Node 22.12+ and pnpm 9.12.0. Follow [your first visitor ID](docs/GETTING-STARTED.md) for a local example that needs no AI key or external database service.

## How it works

```text
Browser observation → normalize signals → look up plausible history
                    → compare → optional Jev evaluation → save visitor ID
```

Most visits use the cookie directly. Without it, indexed queries produce at most ten candidate visitors. Janitor compares up to five observations per candidate and asks Jev about the full shortlist in one request. Jev can also select indexed lookup families before the search. A match must be strong enough and clearly ahead of alternatives; otherwise Janitor creates a new ID.

The core knows nothing about hosting providers, databases or Jev. Storage and evaluator interfaces let you replace those pieces. See the [matching rules](docs/MATCHING.md), [API reference](docs/API.md), [database scaling](docs/SCALING.md) and [capacity results](docs/CAPACITY.md).

## Data and limits

Janitor collects a modest set of browser-native signals and aggregate event counts. It does not collect raw IP addresses, geolocation, actual keys, form values, browsing history or raw mouse positions. It respects hidden browser values. Optional AI evaluation sends compact signals to your chosen provider. See the complete [privacy and deletion guide](PRIVACY.md).

Similar browser configurations can be indistinguishable, and client signals can be forged. The tests verify behavior and failure handling; they do not establish real-user matching accuracy or fraud-detection quality. Read the [validation record](docs/VALIDATION.md) before relying on the scores.

The [public dataset benchmarks](docs/EXTERNAL-BENCHMARKS.md) expose a concrete recovery problem: an all-cookies-missing replay of 15,000 historical observations produced 1,258 correct restores and 2,303 wrong restores. A separate real-Jev pilot reduced false restores while also missing more returning browsers; its raw behavior-only automation scores detected none of forty agents at the preset threshold. These results do not justify using recovered visitor IDs as authentication or assuming AI makes detection accurate.

The public website is an Astro app in `site/`. Run `pnpm site:dev`, `pnpm site:check` or `pnpm site:test` from the root. Its local playground examples use made-up data. An explicitly activated live demo uses Janitor itself, with isolated browser history, private scores, cached Jev calls and a shared lifetime allowance. [How the playground works](docs/PLAYGROUND.md).

Optional [API activity middleware](docs/API-ACTIVITY.md) adds private Jev judgments from bounded server request aggregates. [Analytics bridges](docs/ANALYTICS.md) support PostHog, Mixpanel, Segment, Amplitude and RudderStack; [warehouse exports](docs/WAREHOUSES.md) feed Snowflake, BigQuery or an existing JSONL pipeline. [Python](packages/python/README.md) and [Go](packages/go/README.md) clients can mount first-party routes backed by your Janitor engine. Choose your language and theme in the [documentation](https://janitor.holycoders.io/docs/introduction/).
