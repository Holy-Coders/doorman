# Janitor for Elixir and Phoenix

Native Elixir browser identity and optional Jev risk, using your existing Ecto Postgres repo. No Node service, background worker, Janitor account or hosted Janitor database. The browser client speaks the same JSON contract as the TypeScript adapters.

This is a developer preview. Install the public Git tag; it is **not published to Hex**:

```elixir
# mix.exs
{:janitor, github: "Holy-Coders/janitor", tag: "v0.6.0", sparse: "packages/elixir"}
```

Then `mix deps.get`. Requires Elixir 1.17+, Ecto SQL 3.14+, PostgreSQL and Plug. Tested with Elixir 1.20.2 / OTP 29 and Postgres 17. Existing apps should resolve their own compatible dependency lockfile. For this checkout, use `{:janitor, path: "../../packages/elixir"}` instead.

## Migrate and configure

```elixir
# mix ecto.gen.migration add_janitor
 defmodule MyApp.Repo.Migrations.AddJanitor do
   use Ecto.Migration
   def up, do: Janitor.Migration.up()
   def down, do: Janitor.Migration.down()
 end
```

Run `mix ecto.migrate`. This creates the dedicated `janitor` schema and visitor, observation, identity-key, delegation and learning tables. Use `prefix: "another_schema"` in both the migration and configuration for isolation. Never share one schema across unrelated applications.

```elixir
config = Janitor.new(
  repo: MyApp.Repo,
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  identity: [
    secret: System.fetch_env!("JANITOR_IDENTITY_SECRET"),
    namespace: "my-app-production"
  ],
  learning: [enabled: true, collection_policy: :application]
)
```

Generate the identity secret once with `openssl rand -hex 32`; store it in server secrets. Omit `evaluator` to use deterministic matching and zero risk with `riskStatus: "disabled"`. Jev timeout/failure produces zero risk with `riskStatus: "unavailable"` and deterministic matching. A custom `evaluator: fn input -> ... end` can replace Jev. It must return string keys `sameVisitor`, `automation`, `suspicious`, each a number in 0..1.

Learning is disabled unless explicitly enabled. `collection_policy: :application` authorizes collection application-wide without a per-session consent flag. Default `:per_request` collects only when server context contains `learning_consent: true`. Either mode respects explicit `learning_consent: false`. Janitor adds no consent UI; the implementer owns collection policy and disclosures. Visitor identity and risk work with learning off.

## Phoenix controller

```elixir
# Router's existing :browser pipeline: fetch_session, protect_from_forgery.
post "/api/visitor", VisitorController, :identify

# Controller (config() returns the config above):
def identify(conn, _params) do
  context = case conn.assigns[:current_user] do
    nil -> %{}
    user ->
      person = Janitor.Identity.identify_user(config(), to_string(user.id))
      %{verified: %{subject_id: person["id"], actor_id: person["id"]}}
  end
  Janitor.handle(conn, config(), context)
end
```

Use `actor_id: person["id"]` only when your authentication establishes this actor; for a separately authenticated agent or family member, supply their distinct actor and a verified delegation. Never accept user, actor, consent or scope claims from the measurement JSON. Janitor returns evidence; your controller owns access decisions.

The adapter enforces POST, same-origin requests, JSON, a 16 KiB payload limit and bounded strings/arrays. Keep Phoenix CSRF protection enabled. If `Plug.Parsers` runs earlier, configure its `length` and `read_timeout` too: Janitor cannot undo an allocation an earlier parser made. Filter `signals`, `behavior`, `token` and identity keys from Phoenix logs. Native SQL queries use `log: false`; do not add a query-parameter logger for these tables.

## Private scores and existing installations

The browser receives only `visitorId` and `isReturning` by default. Full evidence remains in `conn.assigns.janitor_identity` and the result of server-side `Janitor.identify`. `expose_client_scores: true` explicitly publishes it; leave this off for fraud integrations. Never authorize an account from a visitor ID. See [server policy and encrypted receipts](../../docs/SECURITY.md).

Fresh `Janitor.Migration.up()` includes selective lookup indexes. Existing installations need a new Ecto migration whose `up` calls `Janitor.Migration.upgrade_lookup()`. On a large live database build the three indexes concurrently outside a transaction first; see [migration instructions](../../docs/SCALING.md). `Janitor.cleanup(config, batch_size: 100, after_visitor_id: cursor)` now returns `%{next_visitor_id: ..., has_more_expired: ...}`; advance the cursor and process further expiry batches through existing maintenance.

## Unreleased checkout additions

This checkout adds optional `protection: [secret: ..., namespace: ...]` for shared measurement quotas and evaluator budgets/circuit breaking, plus `evidence: true` with `identity` configuration for server event counts and verified device associations. `Janitor.assess/3` returns a private evidence envelope; `Janitor.handle/3` adds `conn.assigns.janitor_evidence` without putting it in JSON. Use `Janitor.Evidence.record`, `velocity`, `link_device` and `revoke_device` after your application verifies the corresponding outcome. See [complete options, examples and limits](../../docs/HARDENING.md).

Existing installations need `Janitor.Migration.upgrade_security()` in a new application-owned Ecto migration, with the same prefix. Fresh migrations include the new tables. These APIs are not in the v0.6.0 Git tag or a Hex release yet. Use the local path dependency to test this checkout.

## Browser and LiveView client

The Mix package includes a small generated ESM client, so installing the server package requires no JavaScript build:

```elixir
# Endpoint, before the router
plug Plug.Static, at: "/janitor", from: {:janitor, "priv/static"}, only: ~w(janitor.js)
```

```js
import { createVisitorClient } from "/janitor/janitor.js";
const visitor = createVisitorClient({
  headers: () => ({
    "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content,
  }),
});
const identity = await visitor.identify();
// On account change/logout: visitor.reset(); posthog.reset(); mixpanel.reset();
// On collection withdrawal: visitor.setEnabled(false);
// On teardown: visitor.destroy();
```

Include Phoenix's CSRF meta tag in your layout. Alternatively use the `@janitor/browser` npm/Bun-compatible release artifact. A LiveView hook can create the client in `mounted()`, call `identify()` after your authenticated session changes, and call `destroy()` in `destroyed()`. Keep account verification in the controller, not in hook parameters.

`reset()` clears aggregate behavior and rejects stale requests. It does not delete HttpOnly cookies or authenticate/logout the application. Clear `__visitor_learning` on your authenticated logout response; if withdrawing collection, delete its known session through `Janitor.Learning.delete_session/2` first. Omit verified context after logout. Keep the browser continuity cookie if desired; use `Janitor.delete_visitor/2` and delete that cookie for erasure. Cookie deletion alone can be followed by a fuzzy match unless collection is also paused.

## Identify and update users

```elixir
# Stable authenticated account ID; never an anonymous prediction.
person = Janitor.Identity.identify_user(config, to_string(user.id))
# Equivalent lower-level operation:
person = Janitor.Identity.update_subject(config, %{id: to_string(user.id), kind: :person})

# Only after your application verifies ownership of this email:
Janitor.Identity.add_verified_key(config, person["id"], %{
  type: :email, issuer: "my-app", value: user.email
})
```

Repeated identification upserts the same subject. This works independently of learning/session collection. Verified keys are HMAC digests in storage; email is not sent to Jev. `find_subject/2`, `remove_key/3`, `delete_subject/2`, `create_delegation/2`, `revoke_delegation/2`, and `assess/2` support account lifecycle and scoped agents. Account collisions are rejected, never silently merged. Update a changed verified email by removing the old key and adding the new verified key.

## PostHog and Mixpanel

The unreleased checkout includes `createIdentityAnalytics` in the bundled browser client plus account/actor dimensions in native server exports. Follow the [complete Phoenix lifecycle, shared-browser and reporting guide](../../docs/ANALYTICS.md) to connect anonymous journeys, login, profile updates, logout and multi-user accounts.

Use the same account ID your analytics already uses. Janitor does not replace either analytics product. No export happens unless your server calls these functions or explicitly supplies `analytics_consent: true` and `analytics_id` to the handler with configured providers.

```elixir
posthog = [api_key: System.fetch_env!("POSTHOG_API_KEY"), host: "https://us.i.posthog.com"]
mixpanel = [token: System.fetch_env!("MIXPANEL_TOKEN"), host: "https://api.mixpanel.com"]

# At authenticated signup/profile update; choose which verified traits to export.
traits = %{"email" => user.email, "name" => user.name, "plan" => "pro"}
Janitor.Analytics.identify_user(:posthog, to_string(user.id), traits, posthog)
Janitor.Analytics.identify_user(:mixpanel, to_string(user.id), traits, mixpanel)

# Following identify, server-side:
Janitor.Analytics.capture(:posthog, identity, to_string(user.id), posthog)
Janitor.Analytics.capture(:mixpanel, identity, to_string(user.id), mixpanel)
```

Profile updates allow only `email`, `name`, `plan`; risk events export only Janitor's small allowlist, including verified actor/subject IDs and an optional authorized account ID. Pass `account_id:` per capture or `analytics_context: %{account_id: ...}` in trusted handler context; `analytics_id` must identify the authenticated actor, not a shared workspace. No fingerprints, behavior, debug data, IP addresses or raw identity keys are exported. Choose EU/regional ingestion hosts to match your project. Exports are synchronous best effort, default 750 ms/provider, no retry/queue; functions return `:ok` or `{:error, reason}`. Delivery failure cannot change the returned identity. Accepted ingestion is not proof of a dashboard profile update. With an existing SDK, pass `Janitor.Analytics.properties(identity)` to its capture/track function instead of configuring a second exporter.

For an Open Calls rebuild, put this controller behind the existing authenticated Phoenix session and use the existing PostHog account ID. No calling, billing, provider credential, phone number, message content or replay is needed by Janitor. This example does not modify or deploy Open Calls.

## Maintenance and tests

```elixir
Janitor.cleanup(config) # Existing maintenance schedule; no built-in scheduler.
Janitor.Learning.reports(config, 100) # Privileged server-side export only.
Janitor.Identity.delete_subject(config, person["id"]) # Cascades labeled learning data.
Janitor.delete_visitor(config, visitor_id)
```

Defaults: 90-day observations, 10 snapshots/visitor, 5 loaded for matching; learning 30 days, 30-minute sessions, 20 verified examples/subject. Configure `observation_retention_days`, `max_observations_per_visitor`, or learning's `retention_days` / `session_minutes`.

From this repository, start the documented Postgres container, then `cd packages/elixir && mix deps.get && mix test`. SQL tests run against real Postgres; Jev and analytics transport are mocked. Generated JSON conformance vectors verify normalization, matching, HMAC labels and exact Jev input against TypeScript. This package does not establish cross-device, bot or account-takeover accuracy.
