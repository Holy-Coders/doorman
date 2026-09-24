# Connect analytics

Keep your existing Python analytics client. Doorman's private identity and risk assessments live in your upstream engine; configure its PostHog, Mixpanel, Segment, Amplitude or RudderStack bridge there. The Python relay intentionally receives only public browser continuity.

## Browser login and logout

Use the same JavaScript `createDoormanClient` in your frontend regardless of server language:

```ts
const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  analytics: { amplitude, rudderstack }, // Your initialized browser SDKs.
});
await doorman.identify();
// After your app verifies login:
await doorman.identify(currentUser.id, { plan: "pro" });
// Forwards to both configured SDKs. Do not also track this event directly.
await doorman.track("project opened");
// On logout:
await doorman.reset();
```

Import `createDoormanClient` from `@aarondovturkel/doorman-browser`. Only pass the initialized SDKs you use, with consent and autocapture configured in your application. Never pass a fuzzy visitor ID as the authenticated user ID.

**You do not need two tracking calls for the same event.** `doorman.track()` forwards to every configured provider; an extra direct SDK call sends a duplicate to that provider.

If you connect PostHog or Mixpanel instead, you can keep your existing `posthog.capture()` or `mixpanel.track()` calls. After `doorman.identify()` completes, those SDKs include the safe browser/session/account properties Doorman registers. Keep Doorman's login/logout lifecycle hooks. For Segment, Amplitude and RudderStack, use `doorman.track()` when you want Doorman context attached; their direct SDK calls are not automatically enriched.

## Warehouse reports

Route the upstream engine's private server events through RudderStack to Snowflake or BigQuery, or export its versioned JSONL. Keep people, agents and accounts in separate columns and count only verified actors. The transport client does not infer these relationships. [Warehouse integration](../../../docs/WAREHOUSES.md).
