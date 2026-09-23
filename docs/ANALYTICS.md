# Identify users and send analytics

Risk/confidence exports should run on your **server**. Browser analytics SDK payloads are visible to users and attackers even when the UI hides them. Use the private result from `visitor.assess()` / `Janitor.identify`; the default browser response contains no scores. See [score confidentiality](SECURITY.md).

Janitor already has a server-side account update API. Browser `visitor.identify()` measures a browser; `identities.updateSubject()` creates or updates the verified person/agent. Profile updates to analytics are explicit, separate calls. All work independently of the optional learning collector.

```ts
// After your existing server authentication:
const person = await visitor.identities!.updateSubject({
  id: session.user.id,
  kind: "person",
});
// Only after your app verifies email ownership:
await visitor.identities!.addVerifiedKey(person.id, {
  type: "email",
  issuer: "my-app",
  value: session.user.email,
});
return visitor.handle(request, {
  verified: { subjectId: person.id, actorId: person.id },
});
```

Repeated updates preserve the same subject. A browser cannot claim an arbitrary account by sending its ID. Janitor stores HMAC key digests, not a general-purpose profile with names and emails. Your application's users table and analytics provider remain the profile systems. See [the identity directory](AGENTIC-IDENTITY.md) for agent/family delegation and erasure.

## Elixir / Phoenix first

```elixir
person = Janitor.Identity.identify_user(config, to_string(user.id))
Janitor.Identity.add_verified_key(config, person["id"], %{
  type: :email, issuer: "my-app", value: user.email
})

Janitor.Analytics.identify_user(:posthog, to_string(user.id), %{"plan" => "pro"},
  api_key: System.fetch_env!("POSTHOG_API_KEY"))
Janitor.Analytics.identify_user(:mixpanel, to_string(user.id), %{"plan" => "pro"},
  token: System.fetch_env!("MIXPANEL_TOKEN"))
```

The [native guide](../packages/elixir/README.md) covers capture, EU/regional endpoints and using existing SDKs. Both native integrations are real HTTP implementations with mocked transport tests. No real analytics project events were sent during validation.

## TypeScript server SDK bridges

Install your preferred provider's SDK in the consuming application:

```sh
npm install posthog-node mixpanel @segment/analytics-node
# or
bun add posthog-node mixpanel @segment/analytics-node
# or
pnpm add posthog-node mixpanel @segment/analytics-node
```

Only install the providers you use. Janitor depends on none of their SDKs.

```ts
import { PostHog } from "posthog-node";
import { createAnalyticsBridge } from "@janitor/adapters/analytics";

const posthog = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: "https://us.i.posthog.com",
});
const bridge = createAnalyticsBridge({ provider: "posthog", client: posthog });
await bridge.identifyUser(session.user.id, { plan: "pro" });
await bridge.capture(identity, session.user.id);
// Await your SDK's flush/shutdown at the appropriate serverless/lifecycle boundary.
```

```ts
import Mixpanel from "mixpanel";
import { Analytics } from "@segment/analytics-node";

const mixpanelBridge = createAnalyticsBridge({
  provider: "mixpanel",
  client: Mixpanel.init(process.env.MIXPANEL_TOKEN!, { geolocate: false }),
});
const segmentBridge = createAnalyticsBridge({
  provider: "segment",
  client: new Analytics({ writeKey: process.env.SEGMENT_WRITE_KEY! }),
});
await mixpanelBridge.identifyUser(session.user.id, {
  name: "Sam",
  plan: "pro",
});
await segmentBridge.capture(identity, session.user.id);
```

The bridge returns `queued` when the SDK call returns, or `unavailable` on a thrown/rejected SDK call. It does not claim network delivery; callback-based SDK failures may happen later. Configure SDK error handlers and await provider-specific flush/callback completion in serverless functions. For a custom transport, `analyticsProperties(identity)` exposes the same allowlist.

Allowed event fields: visitor ID, matching confidence, returning flag, automation/suspicion scores, risk availability, actor kind and delegation status. Profile updates allow only `name`, `email`, `plan`. No observations, debug payloads, raw keys, learning predictions or behavior summaries are exported. Pass verified account IDs explicitly; never use anonymous predictions as analytics account IDs. Disable geolocation and provider collection features according to your application policy. The static Janitor documentation site contains no analytics collection.

## Browser analytics and logout

Use your existing frontend PostHog/Mixpanel SDK normally after the application establishes login:

```js
posthog.identify(authenticatedUser.id);
mixpanel.identify(authenticatedUser.id);
// Once your server session is updated, request fresh Janitor attribution.
visitor.reset();
const identity = await visitor.identify();

// On logout, clear the application session and learning cookie server-side, then:
visitor.reset();
posthog.reset();
mixpanel.reset();
```

There is no compulsory consent-session API or UI. Configure learning with application-wide or per-request policy, and use `visitor.setEnabled(false)` if the application wants all browser collection paused. Janitor account updates remain available when browser collection is disabled.

Provider references: [PostHog Elixir](https://posthog.com/docs/libraries/elixir), [Mixpanel Node profile updates](https://docs.mixpanel.com/docs/tracking-methods/sdks/nodejs), [Segment Node SDK](https://github.com/segmentio/analytics-next/tree/master/packages/node).
