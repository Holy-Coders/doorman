# Next.js / Vercel example

From the repository root:

```sh
pnpm install
pnpm build
docker compose -f examples/compose.yaml up -d --wait
cd examples/nextjs
cp .env.example .env.local
pnpm migrate
pnpm dev
```

Open http://localhost:3000. `DATABASE_URL` selects any Postgres service using the standard `pg` client. `JEV_API_KEY` is server-only and optional; blank runs deterministic matching without external inference. A real key enables paid evaluation. Never use a `NEXT_PUBLIC_` variable for the key.

`app/api/visitor/route.ts` uses the Node runtime and a module-scoped pool (maximum five connections); configure the pooled URL and limits for your database/hosting service. `app/identify.tsx` creates the browser client in an effect and destroys listeners on unmount. The button sends an observation; counts accumulate after client creation.

`pnpm migrate` is idempotent. `pnpm build && pnpm start` boots a production build. The route returns the adapter Response directly, including HttpOnly/Secure cookies and no-store headers. Use your own deployment pipeline; nothing is deployed automatically. Integrate `visitor.cleanup()` with existing maintenance.
