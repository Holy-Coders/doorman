# Next.js and Vercel

This example adds a Doorman endpoint to a Next.js App Router application. It uses Postgres through the standard `pg` client, so you can choose your database provider. The browser client identifies a visit; the route sets the cookie and stores history.

## Run the example

You need Node 22.12+, pnpm 9.12.0 and Docker for the supplied local Postgres. From the Doorman repository root:

```sh
pnpm install
pnpm build
docker compose -f examples/compose.yaml up -d --wait
cd examples/nextjs
cp .env.example .env.local
pnpm migrate
pnpm dev
```

Open **http://localhost:3000** and identify twice. The second call should keep the visitor ID. The migration command can be run again safely.

## Configure the server

`DATABASE_URL` points to your Postgres database. Leave `JEV_API_KEY` blank for built-in browser matching with no AI requests. Set a TypeSafe key to enable [Jev risk scoring](../../docs/JEV.md); those calls can incur charges. Never put the key in a `NEXT_PUBLIC_` variable.

In an existing app, [install the packages](../../docs/LANGUAGES.md), apply their migrations, and create a route like this:

```ts
import { Pool } from "pg";
import { createVercelVisitor } from "@aarondovturkel/doorman-adapters/vercel";

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const visitor = createVercelVisitor({ db, evaluator: false });

export const runtime = "nodejs";
export async function POST(request: Request) {
  return visitor.handle(request);
}
```

Save it as `app/api/visitor/route.ts`. Keep the pool and adapter outside the request function so they can be reused. For serverless deployment, use your database provider’s pooled URL and appropriate connection limits.

## Create and clean up the client

The [client component](app/identify.tsx) creates Doorman inside an effect and destroys it on unmount. Copy that lifecycle into your component rather than collecting during server rendering. The example enables optional extended behavior totals; the library’s default is event counts only.

The response contains `visitorId` and `isReturning`. For private confidence or risk in server code, use `visitor.assess(request)` and return its `response`. See [private scores](../../docs/SECURITY.md).

## Production and maintenance

`pnpm build && pnpm start` runs a production build locally. Deploy using your existing Next.js/Vercel pipeline and set server environment variables there. Return the adapter’s Response directly so its cookie and cache headers are preserved.

Give each production application its own database or schema. Call `visitor.cleanup()` from existing maintenance. The local Node and Next.js examples share the supplied test database; stop it from the repository root with `docker compose -f examples/compose.yaml down` when finished. Omitting `-v` preserves local history.
