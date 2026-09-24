# Connect your analytics

Keep PostHog, Mixpanel or your existing analytics provider. Let Doorman coordinate identification and attach browser/session context, so your app does not have to identify through both SDKs.

**You do not need to call both `doorman.track()` and your analytics SDK for the same event.** `doorman.track()` is an optional forwarding helper. Existing PostHog and Mixpanel event calls can stay as they are.

First [mount the Doorman endpoint](IDENTITY-CONTEXT.md). Your server must pass the authenticated user to that endpoint; a browser SDK call alone cannot establish a verified relationship.

## 1. Connect your initialized SDK

Create one client in your application bootstrap, after your collection policy allows it. Pass only the providers you already use:

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  analytics: { posthog, mixpanel },
});
```

`posthog` and `mixpanel` are your existing initialized SDK instances. Doorman does not load them or turn on replay/autocapture. In Phoenix, import the same function from the [packaged browser module](../packages/elixir/README.md) and include the CSRF header.

## 2. Connect your login lifecycle

Call Doorman in the places where your app already knows whether the user is signed in:

```ts
// Anonymous visit:
await doorman.identify();

// After successful login, or when loading an already signed-in session:
await doorman.identify(
  { userId: String(user.id), accountId: String(account.id) },
  { name: user.name, plan: "team" },
);

// Later profile change; supported traits are name, email and plan:
await doorman.update({ plan: "pro" });

// After logout/session expiry, before another person's activity:
await doorman.reset();
```

These are separate lifecycle examples, not a sequence to run all at once. Omit `accountId` if your app has no workspaces. Use the same authenticated user ID on every device and in server events. Doorman handles provider resets when users switch. Do not reset immediately before the first successful login: the analytics provider needs the anonymous journey to join it to that user.

`reset()` resets analytics identity and local measurement state. It does not log out your app or delete the HttpOnly browser cookie. Your app must still handle logout, session expiry and relevant cross-tab auth changes. Doorman does not subscribe to your authentication system.

Identification sends a measurement request and may reject if that endpoint is unavailable. Keep that failure from breaking a successful login or navigation:

```ts
try {
  await doorman.identify({ userId: String(user.id) });
} catch {
  // Measurement failed. Login already succeeded; let the user continue.
}
```

The provider identity update can already have happened before measurement fails. Do not undo authentication because analytics or measurement is unavailable.

## 3. Choose one event delivery path

**Send each event once to each destination.** After connecting your initialized SDKs above, choose either of these approaches.

Keep your existing PostHog or Mixpanel calls. After `doorman.identify()` completes, Doorman registers safe browser/session/account context on those SDKs, so subsequent events include it:

```ts
// If you use PostHog:
posthog.capture("Project created", { plan: "team" });

// If you use Mixpanel:
mixpanel.track("Project created", { plan: "team" });
```

If you use both providers, one direct call to each sends one event to each. You do not need an additional Doorman tracking call.

Pass the initialized SDK itself. If you pass a custom wrapper, it must also expose `register` and `unregister` for automatic event context to work.

Alternatively, replace those direct calls with one optional helper call:

```ts
// Sends to every SDK configured in analytics.
await doorman.track("Project created", { plan: "team" });
```

With `analytics: { posthog, mixpanel }`, the helper already sends the event to both. Calling `posthog.capture()` or `mixpanel.track()` for that same event as well would send a duplicate to that provider. Choose the path that fits your application; Doorman does not deduplicate separate tracking calls.

Doorman's `identify()`, `update()` and `reset()` calls still belong in your login/profile/logout lifecycle. They coordinate provider identity; they do not replace your business events. You do not need to repeat the providers' identify/reset calls yourself.

**Segment, Amplitude and RudderStack** receive Doorman context on events sent through `doorman.track(...)`. Configure them under `analytics: { segment, amplitude, rudderstack }` as needed. Direct calls to those SDKs are not automatically enriched.

`track()` accepts a bounded event name and flat string, number, boolean or null properties. It returns a per-provider delivery status. `queued` means the SDK accepted the call, not that the event has reached your reports. Avoid sending the same event directly and through a connected forwarding destination.

## 4. Add private server context to reports

The browser receives `{ visitorId, sessionId, isReturning }`. Possible user matches, risk and activity labels stay on your server.

When your endpoint calls `doorman.assess(request, { auth })`, it also returns `result.properties`: flat event properties for your existing **server** analytics SDK. Attach them to an event under the user or agent your authentication verified. For anonymous events, keep your existing anonymous identity.

Never pass `doorman_candidate_subject_id` to an SDK's identify/alias method. It is a tentative match, not an authenticated person. Remembered relationships also stay separate from the current login.

For a separately authenticated assistant acting for Alex, your server supplies Alex as the subject and the assistant as the actor. Send the event under the assistant's own analytics ID, not Alex's. The account property groups them together without merging their profiles.

## Reports you can build

| Question                                            | Use                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| What led to signup or purchase?                     | Your normal anonymous-to-login funnel, joined at real login.                                                          |
| How many verified people or agents used an account? | Distinct `doorman_actor_id`, grouped by `doorman_account_id` and `doorman_actor_kind`, using server-verified events.  |
| Was a browser used by several signed-in people?     | Distinct verified actors grouped by `doorman_visitor_id`.                                                             |
| How much activity looks assistant-operated?         | Evaluated activity labels, with unknown/unavailable results shown separately. This is not a count of distinct agents. |
| How often are cross-device guesses right?           | Compare private candidates with later verified logins, outside your canonical user funnel.                            |

The same account can contain several users. One user can have several browsers. A browser ID is never a reliable count of physical people. [ID examples](CONCEPTS.md).

See [server exporters and report recipes](ANALYTICS-REFERENCE.md) for provider configuration, PostHog queries, Mixpanel reports and analytics-assistant prompts. [Warehouse delivery](WAREHOUSES.md) covers Snowflake and BigQuery.

## Verify before using the reports

In a development analytics project, try: anonymous visit → login → same user on another device → logout → different user on the first browser. Check that two people stay separate, the signed-in user is consistent across devices, and browser events contain no private scores.

Doorman's tests use the real PostHog and Mixpanel browser SDKs with requests intercepted locally. They do not prove ingestion or profile merging in your project; inspect the provider's event stream and reports too.

`enabled: false` pauses Doorman until `setEnabled(true)`. Provider replay, autocapture, opt-out and consent settings remain your application's responsibility. `destroy()` removes Doorman's listeners; it does not shut down the provider SDKs.
