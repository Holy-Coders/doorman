# Janitor

<img src="https://janitor.holycoders.io/janitor-mark.svg" alt="Janitor" width="96" />

Durable first-party visitor identity from browser history, with optional AI-assisted matching and risk scoring.

Janitor is an open-source library for recognizing returning browsers. It runs on your server, stores a small history in your database, and can use **Jev**, an AI model from TypeSafe, to help assess matches and technical risk.

[Introduction](https://janitor.holycoders.io/docs/introduction/) · [Quickstart](docs/GETTING-STARTED.md) · [Playground](https://janitor.holycoders.io/playground/) · [GitHub release](https://github.com/Holy-Coders/janitor/releases/tag/v0.7.0)

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

## Choose your server

### Cloudflare Workers

```ts
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";

const visitor = createCloudflareVisitor({
  db: env.VISITORS, // Your D1 binding.
  ai: env.AI,      // Optional Workers AI binding for Jev.
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
{:janitor, github: "Holy-Coders/janitor", tag: "v0.7.0", sparse: "packages/elixir"}
```

```elixir
janitor = Janitor.new(repo: MyApp.Repo)
Janitor.handle(conn, janitor)
```

This implementation runs natively in Elixir with Ecto/Postgres. The package includes the browser client. [Phoenix installation](packages/elixir/README.md).

Apply the database migrations before using any adapter. The v0.7.0 JavaScript release includes migrations `0001` through `0006`; the Elixir package provides Ecto migration functions. Each app should use its own database or schema.

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
- [Experiment with optional login feedback](docs/LEARNING.md).

## Install or run an example

Janitor v0.7.0 is a developer preview. Packages are available as GitHub archives; they are not yet published to npm or Hex. [Installation instructions](docs/LANGUAGES.md) cover npm, pnpm, Bun, Mix and existing applications.

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

Most visits use the cookie directly. Without it, indexed queries produce at most ten candidate visitors. Janitor compares up to five observations per candidate and sends at most three plausible histories to Jev. A match must be strong enough and clearly ahead of alternatives; otherwise Janitor creates a new ID.

The core knows nothing about hosting providers, databases or Jev. Storage and evaluator interfaces let you replace those pieces. See the [matching rules](docs/MATCHING.md), [API reference](docs/API.md), [database scaling](docs/SCALING.md) and [capacity results](docs/CAPACITY.md).

## Data and limits

Janitor collects a modest set of browser-native signals and aggregate event counts. It does not collect raw IP addresses, geolocation, actual keys, form values, browsing history or raw mouse positions. It respects hidden browser values. Optional AI evaluation sends compact signals to your chosen provider. See the complete [privacy and deletion guide](PRIVACY.md).

Similar browser configurations can be indistinguishable, and client signals can be forged. The tests verify behavior and failure handling; they do not establish real-user matching accuracy or fraud-detection quality. Read the [validation record](docs/VALIDATION.md) before relying on the scores.

The public website is an Astro app in `site/`. Run `pnpm site:dev`, `pnpm site:check` or `pnpm site:test` from the root. Its playground uses made-up data and does not collect visitor signals.
