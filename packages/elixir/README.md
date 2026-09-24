# Doorman for Elixir and Phoenix

**0.13 is currently available from source.** The latest npm and Hex release is 0.12.0. The unified API below requires the source checkout, not the current registry release. [Run from source](https://github.com/Holy-Coders/doorman).

For 0.13 before the registry release, clone the repository and use `{:doorman_identity, path: "../doorman/packages/elixir"}` in your application. The source Phoenix example already uses the local package.


For the recommended browser, account and analytics flow, start with [one identity integration](../../docs/IDENTITY-CONTEXT.md). The detailed APIs below remain available for advanced use.


Add browser recognition to a Phoenix app using your existing Ecto Postgres repository. Doorman runs natively in Elixir, and the Mix package includes the JavaScript client your page needs. You do not need a separate Node service.

This guide assumes you already have a Phoenix app with Postgres. To try a complete small app first, use the [Phoenix example](https://github.com/Holy-Coders/doorman/tree/main/examples/phoenix).

## Install the package

Add Doorman to `deps` in `mix.exs`:

```elixir
{:doorman_identity, "~> 0.12.0"}
```

Then run `mix deps.get`. This is a developer preview. It requires Elixir 1.17+, Ecto SQL 3.14+, Plug and PostgreSQL. Tests currently run on Elixir 1.20.2 / OTP 29 and Postgres 17; your app should resolve and keep its own dependency lockfile.

## Create the tables

Generate a migration:

```sh
mix ecto.gen.migration add_doorman
```

Replace its body with:

```elixir
defmodule MyApp.Repo.Migrations.AddDoorman do
  use Ecto.Migration
  def up, do: Doorman.Migration.up()
  def down, do: Doorman.Migration.down()
end
```

Run `mix ecto.migrate`. This creates Doorman’s tables in a dedicated `doorman` schema. To choose another schema, use the same `prefix:` in both the migration and `Doorman.new`. Keep unrelated applications in separate schemas or databases.

## Add a measurement endpoint

Add this route to your existing browser pipeline, which fetches the session and protects against cross-site request forgery (CSRF):

```elixir
post "/api/visitor", VisitorController, :identify
```

The controller can start with browser recognition only:

```elixir
defmodule MyAppWeb.VisitorController do
  use MyAppWeb, :controller

  def identify(conn, _params) do
    config = Doorman.new(repo: MyApp.Repo)
    Doorman.handle(conn, config)
  end
end
```

The endpoint accepts browser measurements, sets a visitor cookie, and returns `visitorId` and `isReturning`. With no evaluator configured, risk is disabled. Your normal login flow remains unchanged.

## Load the browser client

Serve the packaged client before your router in the endpoint:

```elixir
plug Plug.Static,
  at: "/doorman",
  from: {:doorman_identity, "priv/static"},
  only: ~w(doorman.js)
```

Keep Phoenix’s CSRF meta tag in your layout. Then import the client from your page’s JavaScript:

```js
import { createVisitorClient } from "/doorman/doorman.js";

const visitor = createVisitorClient({
  endpoint: "/api/visitor",
  headers: () => ({
    "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content,
  }),
});

const identity = await visitor.identify();
// { visitorId: "vis_…", isReturning: false }

// On teardown, or when collection must stop:
visitor.destroy();
```

Create the client when your app’s collection policy allows it. In LiveView, a hook can create it in `mounted()` and destroy it in `destroyed()`. A new mount needs a new client. Do not use hook parameters as proof of a user’s identity.

`visitor.reset()` clears aggregate counts and discards stale requests. It does not log out your application or delete HttpOnly cookies. `visitor.setEnabled(false)` pauses collection. The [analytics guide](https://github.com/Holy-Coders/doorman/blob/main/docs/ANALYTICS.md) shows how to coordinate login and logout with PostHog or Mixpanel.

## Add Jev risk scoring

Jev is TypeSafe’s AI model. It can assess whether a browser fits its history and whether its technical signals look automated or inconsistent. Enable it by adding a server-only key:

```elixir
config = Doorman.new(
  repo: MyApp.Repo,
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")]
)
```

Provider calls may incur charges. Without an evaluator, risk values are zero with `riskStatus: "disabled"`. If an enabled evaluator fails, the status is `"unavailable"` and browser matching falls back to built-in rules. Zero in either case means no assessment, not proof of safety.

The private result is available in `conn.assigns.doorman_identity` after `Doorman.handle`. The measurement response has already been sent at that point. Use server-side `Doorman.identify` or `Doorman.assess` in your application’s own action flow when you need to decide how to handle a sensitive operation. See [private scores](https://github.com/Holy-Coders/doorman/blob/main/docs/SECURITY.md).

A custom `evaluator: fn input -> ... end` can replace Jev. Return string keys `sameVisitor`, `automation` and `suspicious`, each with a number from 0 to 1.

## Connect a signed-in user

Configure the identity directory when you want user links or agent permissions:

```elixir
config = Doorman.new(
  repo: MyApp.Repo,
  identity: [
    secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
    namespace: "my-app-production"
  ]
)
```

Generate that secret once with `openssl rand -hex 32`, store it on the server and use the same value across instances of this app. A namespace names the application’s identity scope. Changing the secret or namespace changes its derived IDs.

After your authentication system verifies a user:

```elixir
person = Doorman.Identity.identify_user(config, to_string(user.id))

Doorman.handle(conn, config, %{
  verified: %{subject_id: person["id"], actor_id: person["id"]}
})
```

Repeated calls register the same identity. Another browser signed into this user can have a different visitor ID and the same verified person. For an assistant or family member acting for someone else, pass that actor’s separate verified identity and delegation. [People and agents](https://github.com/Holy-Coders/doorman/blob/main/docs/AGENTIC-IDENTITY.md) explains those relationships.

You can also add a lookup key after your app verifies its ownership:

```elixir
Doorman.Identity.add_verified_key(config, person["id"], %{
  type: :email, issuer: "my-app", value: user.email
})
```

Keys are stored as keyed hashes, not raw email addresses, and are not sent to Jev. Finding a key is a lookup, not a login check. Remove outdated verified keys when account information changes. User updates work independently of optional learning-session collection.

## Connect analytics or other optional features

Follow [PostHog and Mixpanel integration](https://github.com/Holy-Coders/doorman/blob/main/docs/ANALYTICS.md) for browser login/reset hooks, profile updates, private server events and account reports. Use the user ID your analytics already knows; a visitor ID should not replace it.

Other features are opt-in:

- [Login feedback](https://github.com/Holy-Coders/doorman/blob/main/docs/LEARNING.md) saves anonymous session examples labeled by later verified logins. Choose an application-wide or per-request collection policy.
- [API activity](https://github.com/Holy-Coders/doorman/blob/main/docs/API-ACTIVITY.md) adds `Doorman.ActivityPlug` for selected API routes, bounded server-side counters and private Jev assessments. Upgrade an existing database with `Doorman.Migration.upgrade_activity()` before enabling it.
- [Request limits and trusted events](https://github.com/Holy-Coders/doorman/blob/main/docs/HARDENING.md) adds shared inference budgets and records your server’s verified outcomes.
- [Credentials and receipts](https://github.com/Holy-Coders/doorman/blob/main/docs/TRUST.md) explains signed agent credentials, delegation and operation-bound assessments.

These features do not automatically train a model, merge accounts, enable analytics or block users.

## Maintenance and upgrades

```elixir
Doorman.cleanup(config, batch_size: 100, after_visitor_id: cursor)
Doorman.delete_visitor(config, visitor_id)
Doorman.Identity.delete_subject(config, person["id"])
```

Cleanup returns `next_visitor_id` and `has_more_expired`. Save the cursor for another maintenance batch. Defaults are 90 days of observations, ten stored observations per visitor, and five loaded for matching. Configure `observation_retention_days` and `max_observations_per_visitor` to change retention.

Fresh migrations include all current tables and indexes. To upgrade an earlier installation, call `Doorman.Migration.upgrade_lookup()` and `Doorman.Migration.upgrade_security()` from new Ecto migrations using the same prefix. On large live databases, read [how to build lookup indexes without blocking writes](https://github.com/Holy-Coders/doorman/blob/main/docs/SCALING.md) first.

For erasure, stop collection and clear the browser cookie as well as deleting stored records. Learning uses a separate `__visitor_learning` cookie; clear it on logout and delete its session when withdrawing collection. See [privacy and deletion](https://github.com/Holy-Coders/doorman/blob/main/PRIVACY.md).

## Before deploying

Use HTTPS, production cookie settings, strong server secrets and your normal database TLS/pool configuration. Keep Phoenix CSRF protection enabled. Doorman limits its payload to 16 KiB; if `Plug.Parsers` runs first, configure its body-size and read-time limits too. Filter `signals`, `behavior`, tokens and identity keys from application logs.

To run this package’s tests from the repository, start the Postgres instance described in the [Phoenix example](https://github.com/Holy-Coders/doorman/tree/main/examples/phoenix), then run `mix deps.get && mix test` from `packages/elixir`. SQL tests use real Postgres; Jev and analytics transport are mocked. Shared fixtures check compatibility with the TypeScript implementation.

## Built-in Jev learning and analytics identity

With Jev and `identity` configured, add `learning: [enabled: true, collection_policy: :application]`. Doorman automatically evaluates anonymous sessions against earlier login-confirmed examples. Report verified self-person logins in the server context, then read suggestions from `conn.assigns.doorman_learning`. No custom predictor is required. Suggestions are private and never establish authentication. See [learning setup and cold-start behavior](https://github.com/Holy-Coders/doorman/blob/main/docs/LEARNING.md).

The bundled browser module exports `createDoormanClient`. Use `identify(user.id)`, `update`, `track` and `reset` to manage PostHog, Mixpanel and Segment through one interface. It supports the same Phoenix CSRF `headers` callback as `createVisitorClient`. See [the complete analytics flow](https://github.com/Holy-Coders/doorman/blob/main/docs/ANALYTICS.md).

For an existing v0.7 installation, create a new Ecto migration whose `up` calls `Doorman.Migration.upgrade_learning()`. This adds migration 0007's two indexes without rebuilding the existing tables. Fresh installations use `Doorman.Migration.up()` as before. On a large active database, use your normal online index deployment procedure before enabling learning.
