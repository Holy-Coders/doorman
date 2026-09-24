# Next.js and Vercel

This example adds a browser client and a Node route to a Next.js App Router app. It uses Postgres through `pg`, so you can choose your database provider. It uses the 0.13 API from the source workspace.

## Run the example

You need Node.js 22.12+, pnpm 9.12.0 and Docker for the supplied Postgres database. From the repository root:

```sh
pnpm install
pnpm build
docker compose -f examples/compose.yaml up -d --wait
cd examples/nextjs
cp .env.example .env.local
openssl rand -hex 32
```

Copy the generated value into `DOORMAN_IDENTITY_SECRET` in `.env.local`. Keep it private and stable. Leave `JEV_API_KEY` blank to run without AI.

```sh
pnpm dev
```

Open **http://localhost:3000** and select **Identify** twice. The second response should keep the browser ID. Tables are created automatically on first use; no migration step is required.

## Add the route to your app

[Install the packages](../../docs/LANGUAGES.md), then create `app/api/visitor/route.ts`:

```ts
import { Pool } from "pg";
import { createDoorman } from "@aarondovturkel/doorman-adapters/vercel";

const doorman = createDoorman({
  db: new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  evaluator: false,
});

export const runtime = "nodejs";
export async function POST(request: Request) {
  return doorman.handle(request);
}
```

Reuse the pool and handler across requests. The database must exist and allow table/index creation. In serverless deployments, use your provider's pooled URL and connection limits.

## Add the client and login

The [client component](app/identify.tsx) creates Doorman in an effect and destroys it on unmount. Copy that lifecycle; do not collect browser signals during server rendering. The example opts into extended summaries, while the library defaults to minimal collection.

The browser receives `{ visitorId, sessionId, isReturning }`. To connect authenticated users and analytics, follow [add Doorman to your app](../../docs/IDENTITY-CONTEXT.md). Read your session on the server, pass its user to `assess()`, and return the assessment's `response`.

## Environment and deployment

| Variable                  | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`            | Postgres connection; the example file points to the local container. |
| `DOORMAN_IDENTITY_SECRET` | Required stable secret of at least 32 characters.                    |
| `JEV_API_KEY`             | Optional TypeSafe key for AI scoring. Blank means no provider calls. |

Keep all three server-only; none belongs in a `NEXT_PUBLIC_` variable. `pnpm build` then `pnpm start` runs production locally. Deploy through your normal Next.js/Vercel pipeline and configure the same environment there.

Call `doorman.cleanup()` from existing maintenance. The local Node and Next.js examples share Postgres. Stop it from the repository root with `docker compose -f examples/compose.yaml down`; omitting `-v` preserves history.
