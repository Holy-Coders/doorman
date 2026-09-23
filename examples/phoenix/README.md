# Native Phoenix example

A working Phoenix 1.8 endpoint, Ecto Postgres repo and browser UI. Janitor runs in the BEAM application; no Node companion service. See the [Elixir installation and integration guide](../../packages/elixir/README.md) for an existing Phoenix/LiveView app, PostHog, Mixpanel and verified users.

From the repository root:

```sh
# Skip if you already have a local Postgres database.
docker run --name janitor-example-pg -e POSTGRES_USER=visitor -e POSTGRES_PASSWORD=visitor -e POSTGRES_DB=visitors -p 127.0.0.1:55433:5432 -d postgres:17-alpine
cd examples/phoenix
export DATABASE_URL=postgres://visitor:visitor@localhost:55433/visitors
mix setup
mix phx.server
```

Open http://localhost:4000 and click Identify twice. The second response should reuse the first-party cookie. Jev is disabled unless `JEV_API_KEY` is set; inference can incur provider charges. No analytics export is configured in this local example. `mix test` verifies the page, client asset and CSRF boundary. Use `PORT=4001` for another port.

Local-only defaults bind loopback and allow an insecure cookie on localhost. For production use a proper Phoenix release, TLS, strong `SECRET_KEY_BASE` and `JANITOR_IDENTITY_SECRET`, database TLS/pool settings, and `Janitor.new(environment: :production, secure_cookie: true, ...)`. Set collection policy explicitly for your application; the demo enables application-wide session collection and supplies no authenticated account labels.

The packaged client is committed. After changing browser code in this monorepo, regenerate it with `pnpm install && pnpm protocol:sync`. An app installing Janitor through Mix does not need pnpm.
