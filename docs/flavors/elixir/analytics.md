# Connect analytics in Phoenix

Keep your existing PostHog or Mixpanel project. Use Doorman's browser client for login, profile updates and logout; use private server properties when you want risk or agent context in reports.

**`doorman.track()` is optional. Send each event once to each destination: through Doorman or through your existing analytics SDK. Do not do both for the same destination.**

First complete the [Phoenix setup](../../../packages/elixir/README.md). Its controller passes your server's authenticated `current_user` to Doorman. No manual migrations are needed.

## Browser lifecycle

Pass your initialized SDK instances to the bundled module:

```js
import { createDoormanClient } from "/doorman/doorman.js";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  headers: () => ({
    "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content,
  }),
  analytics: { posthog, mixpanel },
});

// On an anonymous page:
await doorman.identify();
// After login, or when loading a signed-in session:
await doorman.identify({
  userId: String(user.id),
  accountId: String(account.id),
});
// After logout:
await doorman.reset();
```

These calls belong in their respective lifecycle hooks; do not run the whole sequence on every page load. Omit `accountId` without workspaces. Keep one client in your app bootstrap, call `destroy()` on teardown, and catch measurement failures so they do not interrupt a completed login.

## Choose one event delivery path

Keep your existing event calls after connecting the initialized SDKs and completing `doorman.identify()`. Subsequent events receive the safe browser/session/account context Doorman registers:

```js
// If you use PostHog:
posthog.capture("Project created");
// If you use Mixpanel:
mixpanel.track("Project created");
```

If you use both providers, those two calls send one event to each. Alternatively, replace them with one optional call:

```js
// Already forwards to both configured SDKs. No extra provider calls needed.
await doorman.track("Project created");
```

Calling the helper and a provider's capture/track method for the same event duplicates that provider's event. Doorman does not deduplicate separate tracking calls. Keep Doorman's identify/update/reset lifecycle hooks; you do not need to repeat provider identify/reset calls.

Pass the initialized SDK itself. If you pass a custom wrapper, it must also expose `register` and `unregister` for automatic event context to work.

Segment, Amplitude and RudderStack receive Doorman context through `doorman.track`; their direct SDK calls are not automatically enriched. Doorman does not enable replay or change the providers' collection settings.

## Private server events

After `conn = Doorman.handle(conn, config, %{auth: auth})`, the measurement response has been sent. `conn.assigns.doorman_properties` contains the private context for a server analytics event. Use the actor ID verified by your authentication, never a guessed candidate ID.

You can send those properties through your existing server integration. Alternatively, Doorman has optional [provider exporters](../../../docs/ANALYTICS-REFERENCE.md), including regional ingestion configuration. Choose one delivery path to avoid duplicate events.

## Useful reports

- Build ordinary signup/purchase funnels using real login joins.
- Group by account and count distinct verified actors, separating people and agents.
- Count browsers separately from users.
- Analyze tentative cross-device matches and activity labels separately from verified identities.

The [report recipes](../../../docs/ANALYTICS-REFERENCE.md) include Mixpanel setup, PostHog SQL and questions for an analytics assistant. [Warehouse delivery](../../../docs/WAREHOUSES.md) covers Snowflake and BigQuery.

A browser shared by two credentials can be reported as two verified users. Two people sharing one password cannot be reliably counted from browser telemetry. Validate the event stream and profile merges in a development analytics project before trusting a report.
