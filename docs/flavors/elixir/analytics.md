# Connect analytics in Phoenix

Keep your existing PostHog or Mixpanel project. Use Doorman's browser client for login, profile updates and logout; use private server properties when you want risk or agent context in reports.

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
// Ordinary events:
await doorman.track("Project created");
// After logout:
await doorman.reset();
```

These calls belong in their respective lifecycle hooks; do not run the whole sequence on every page load. Omit `accountId` without workspaces. Keep one client in your app bootstrap, call `destroy()` on teardown, and catch measurement failures so they do not interrupt a completed login.

Existing `posthog.capture` and `mixpanel.track` calls also receive safe browser/session/account context. Segment, Amplitude and RudderStack are supported through `doorman.track`; their direct SDK calls are not automatically enriched. Doorman does not enable replay or change the providers' collection settings.

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
