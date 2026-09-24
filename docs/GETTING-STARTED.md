# Your first visitor ID

For the recommended browser, account and analytics flow, start with [one identity integration](IDENTITY-CONTEXT.md). The detailed APIs below remain available for advanced use.

In this guide, you’ll run Doorman locally, identify a browser, and see the same ID on a return visit. The example includes the browser client, server endpoint and database, so you can see the whole flow before adding it to your own app.

We’ll use the Cloudflare example because its development tools provide a local database. You do not need a Cloudflare account, an AI key or Docker for this path. If you prefer Elixir, use the [Phoenix example](../examples/phoenix/README.md).

## 1. Get the example

You’ll need Git, Node.js 22.12 or newer, and pnpm 9.12.0. The repository uses pnpm; the packaged library also supports [npm and Bun installation](LANGUAGES.md).

```sh
git clone https://github.com/Holy-Coders/doorman.git
cd doorman
corepack enable
pnpm install
pnpm build
```

## 2. Create the local database and start the app

```sh
cd examples/cloudflare-worker
pnpm exec wrangler d1 migrations apply VISITORS --local
pnpm dev
```

The migration command creates Doorman’s tables in a local D1 database. The development server serves the example page and its `/api/visitor` endpoint at **http://localhost:8787**.

This example starts with AI disabled. It makes no Jev requests and needs no provider credentials.

## 3. Identify the browser twice

Open the page and select **Identify**. You should receive a new ID:

```json
{ "visitorId": "vis_…", "isReturning": false }
```

Select **Identify** again. The browser sends back the cookie Doorman set on the first response, and the ID should stay the same:

```json
{ "visitorId": "vis_…", "isReturning": true }
```

To try recovery without the cookie, delete `__visitor` for localhost in your browser’s developer tools, then identify again. With only this browser’s history in the database and enough available signals, Doorman can restore the same ID. If the evidence is too sparse or ambiguous, a new ID is the expected result.

For repeatable examples that do not collect your browser’s signals, try the [public playground](https://doorman.holycoders.io/playground/).

## 4. See the two pieces of code

The browser creates a client and calls your endpoint:

```ts
import { createVisitorClient } from "@aarondovturkel/doorman-browser";

const visitor = createVisitorClient({ endpoint: "/api/visitor" });
const result = await visitor.identify();

// When the component unmounts or collection should stop:
visitor.destroy();
```

The server connects the request to storage:

```ts
import { createCloudflareVisitor } from "@aarondovturkel/doorman-adapters/cloudflare";

export default {
  async fetch(request, env) {
    const visitor = createCloudflareVisitor({ db: env.VISITORS });
    return visitor.handle(request);
  },
};
```

That server snippet is for a route dedicated to Doorman. The example app also serves HTML and browser JavaScript; it calls the handler only for `/api/visitor`.

The cookie is `HttpOnly`, so browser JavaScript cannot read it. `isReturning` describes the browser’s stored history, not whether someone is logged in.

## 5. Read a private assessment

When you need scores in server code, call `assess()` instead of `handle()`:

```ts
const { response, identity } = await visitor.assess(request);

if (identity) {
  // Use these values in your server logic.
  const { confidence, risk, riskStatus } = identity;
}

return response; // Sends the visitor ID and cookie, without private scores.
```

With AI disabled, `riskStatus` is `"disabled"` and both risk values are zero. This means no risk assessment took place. It does not prove that the visitor is human or safe.

To add AI, read [Jev and risk scoring](JEV.md). For policy code and failure handling, read [keep scores private](SECURITY.md).

## Add Doorman to your application

Choose the guide for your server:

- [Cloudflare Workers](../examples/cloudflare-worker/README.md): D1 or Postgres, with optional Workers AI.
- [Next.js and Vercel](../examples/nextjs/README.md): an App Router endpoint and Postgres.
- [Node and Fastify](../examples/node-fastify/README.md): a standard Request/Response handler in your Node app.
- [Elixir and Phoenix](../packages/elixir/README.md): native Elixir with your Ecto Postgres repository.

Apply the migrations, mount a same-origin endpoint, and create the browser client when your app’s collection policy allows it. Keep your existing login system. You can add [analytics](ANALYTICS.md), [verified user links](AGENTIC-IDENTITY.md) and other features later.
