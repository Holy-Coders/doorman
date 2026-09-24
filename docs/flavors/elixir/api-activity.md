# Understand API activity

An assistant can use your API without opening a browser. Doorman's optional API middleware gives those requests context: which routes a session or authenticated actor uses, how often requests complete, and whether the application accepts or rejects them.

It runs in **your application**, with your database and existing authentication. Keep PostHog, Mixpanel or Segment for analytics. Doorman can add identity context and a separate API-risk assessment to the events you send there.

This feature does not intercept browser `fetch`, proxy traffic through Doorman, or read request/response bodies. It never changes access permissions, blocks a request or shows a CAPTCHA. Browser identity confidence stays separate from API activity.

## Add a Phoenix Plug

Add `activity` to your existing native configuration. Doorman prepares the tables automatically; no Ecto migration is required:

```elixir
def doorman do
  Doorman.new(
    repo: MyApp.Repo,
    secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
    namespace: "my-app-production",
    evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
    activity: [
      routes: [
        %{route: "GET /api/orders/:id"},
        %{route: "POST /api/payments", sensitive: true}
      ]
    ]
  )
end
```

Mount `Doorman.ActivityPlug` in the API pipeline after your authentication plug:

```elixir
plug Doorman.ActivityPlug,
  config: &MyApp.Identity.doorman/0,
  context: &MyApp.Identity.api_context/1
```

Your `api_context/1` returns a configured template and an authenticated actor ID, or `nil` to skip collection. Resolve the template from your router/controller, not `conn.request_path`:

```elixir
def api_context(conn) do
  if actor = conn.assigns[:current_actor] do
    %{
      route: conn.assigns.doorman_route_template,
      key: %{kind: "actor", id: actor.id}
    }
  end
end
```

The Plug runs in `register_before_send`, preserving the application's response and adding private `conn.assigns.doorman_api_activity`. If another before-send callback consumes that assign, register the consumer **before** the activity Plug: Plug executes those callbacks in reverse registration order. Unhandled exceptions that never produce a response do not invoke the callback; your normal exception telemetry owns those cases.

You can also call `Doorman.Activity.observe(config, context, %{status: 200, duration_ms: 12})` directly, or `Doorman.Activity.assess(config, context)` before a sensitive action. An optional `activity: [..., evaluator: fn input -> ... end]` replaces Jev for API activity and must return string-keyed `automation` and `suspicious` numbers in `[0, 1]`.

The [Phoenix example](../../../examples/phoenix/README.md) includes an opt-in API route and server-issued session. The [Fastify example](../../../examples/node-fastify/README.md) uses an authenticated demo service and an `onSend` hook. Both run with Jev disabled when no API key is provided.

## What is recorded and evaluated

Doorman stores one aggregate row per application-scoped HMAC actor/session key, route template and time window. It updates that row atomically across processes. There is no raw request log.

Each row contains request count, 401/403 count, all 4xx count, 5xx count, total/max handler duration, first/last completion time and a count of completion gaps below 100ms on the same route. Durations are rounded and capped at 60 seconds; counts saturate at one billion. Timing covers the handler through response creation/before-send, not reading a streamed response. It is affected by server load and application behavior and is not human reaction time. Doorman does not collect exact action sequences or infer distributed concurrency from these counters.

Jev receives at most 128 aggregate rows from the latest five windows, the configured route being assessed, its sensitive-action flag, and optional **server-verified** actor kind/delegation status. Truncated summaries are labeled. Raw IDs, cookies, credentials, headers, URLs, query values, bodies, IPs and browser observations are absent. API summaries are evaluated independently of fingerprint matching and cross-device learning.

The two typed questions return `automation` and `suspicious`. Their instructions account for normal polling, retries, parallel browser requests, authorized agents and server errors. These scores are experimental and need evaluation on your own traffic. An automated assistant can be legitimate; a low score cannot authenticate a person or rule out abuse.

## Cost, latency and scale

Defaults are deliberately bounded:

| Setting                     | TypeScript / Elixir                               | Default                                |
| --------------------------- | ------------------------------------------------- | -------------------------------------- |
| Counter window              | `windowMs` / `window_ms`                          | 60 seconds                             |
| Counter retention           | `retentionDays` / `retention_days`                | 1 day                                  |
| First volume milestone      | `minRequests` / `min_requests`                    | 20 requests on one route in one window |
| Cache / evaluation interval | `evaluationIntervalMs` / `evaluation_interval_ms` | 60 seconds                             |
| Total activity wait         | `timeoutMs` / `timeout_ms`                        | 1.5 seconds                            |
| Local TypeScript work cap   | `maxInFlight`                                     | 64 operations per reusable instance    |

Volume triggers occur at 20, 40, 80, 160… requests. The first 401/403 on a route/window and every configured sensitive action also attempt an assessment. A shared database lease limits these attempts to one evaluation per actor/session, route and verified actor context per interval. Other requests reuse a fresh cache or proceed without an assessment while one is pending. Failures are cached for the same interval. Empty history never triggers a paid evaluation.

Without explicit `protection` configuration, the high-level adapters apply a shared allowance of 60 evaluator calls/minute, four concurrent leases and a circuit breaker to API activity. With `protection`, API activity shares your configured inference budget with the other Jev stages. Advanced users of the standalone `createApiActivity` factory must supply a protected evaluator themselves. Native Elixir uses the same shared budget defaults. Provider timeouts can still incur provider usage; the limits bound admission, not a guaranteed dollar amount.

Ordinary observations use one indexed UPSERT. Assessment attempts also access the cache, bounded history and evaluator controls. Counter storage grows with active keys, configured routes and retained windows. This is not a claim of 100,000 concurrent requests: size your Postgres pool, database, gateway admission and query deadlines for measured traffic. D1 remains suitable for smaller deployments. All replicas must share the same namespace, route configuration, window and budget settings; change window settings only after coordinated erasure or retention of old counters.

Both middleware paths fail open for activity collection. Provider failures return zero defaults with `riskStatus: "unavailable"`; absent evaluators return `disabled`. Storage errors, exhausted local capacity or the overall deadline return `{ status: "unavailable" }` without a score. A recorded request can have no assessment because it did not hit a trigger, or another process is evaluating it. None of these outcomes changes the application response. In TypeScript, a stuck database operation continues occupying its local slot until it settles; driver-side timeouts remain necessary.

## Keep your existing analytics

After obtaining attribution from your verified identity context, pass an API assessment through the existing **server** bridge:

```ts
const attribution = await doorman.identities!.assess(verifiedContext);
if (activity.assessment && !activity.assessment.cached) {
  await analytics.capture(
    { attribution, apiActivity: activity.assessment },
    authenticatedActorId,
    { accountId: authorizedWorkspaceId },
  );
}
```

`analytics` is your configured [PostHog, Mixpanel or Segment bridge](../../ANALYTICS.md). Phoenix accepts the same addition as `"apiActivity" => assessment` in `Doorman.Analytics.capture`. Exports contain only API risk status, evaluated scores, evaluation/expiry times, cache/truncation flags, window size and request totals, alongside the existing verified identity fields. Route history stays private. Unavailable scores are omitted from analytics rather than reported as an evaluated zero. Export remains explicit; the middleware sends no analytics automatically.

## Retention and erasure

`doorman.cleanup()` / `Doorman.cleanup(config)` removes up to 100 expired counter rows and 100 expired assessment records per call. Invoke it from existing maintenance frequently enough for your traffic. Expired data can remain physically present until cleanup runs; assessment reads only consider the recent bounded windows and unexpired cache. Include database backups and any explicitly exported analytics in your erasure process.

Stop collection for a key and coordinate in-flight requests before deletion:

```ts
await doorman.activity!.deleteKey({ kind: "actor", id: authenticatedActorId });
```

```elixir
Doorman.Activity.delete_key(config, %{kind: "actor", id: authenticated_actor_id})
```

Use `kind: "session"` for an anonymous application session. Actor/session keys are independent of browser visitor IDs, so deleting a browser or directory subject does not automatically erase these counters. Your account-deletion flow must delete its activity key and any related session keys. Collection can be disabled by removing `activity`; existing data still requires cleanup or erasure.
