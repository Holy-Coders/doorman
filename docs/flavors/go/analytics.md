# Connect analytics

Keep your existing Go analytics client. Janitor's private identity and risk assessments live in your upstream engine; configure its PostHog, Mixpanel, Segment, Amplitude or RudderStack bridge there. The Go relay intentionally receives only public browser continuity.

## Browser login and logout

Use the same JavaScript `createJanitorClient` in your frontend regardless of server language:

```ts
const janitor = createJanitorClient({
  endpoint: "/api/visitor",
  analytics: { amplitude, rudderstack }, // Your initialized browser SDKs.
});
await janitor.identify();
// After your app verifies login:
await janitor.identify(currentUser.id, { plan: "pro" });
await janitor.track("project opened");
// On logout:
await janitor.reset();
```

Import `createJanitorClient` from `@janitor/browser`. Only pass the initialized SDKs you use, with consent and autocapture configured in your application. Never pass a fuzzy visitor ID as the authenticated user ID.

## Warehouse reports

Route the upstream engine's private server events through RudderStack to Snowflake or BigQuery, or export its versioned JSONL. Keep people, agents and accounts in separate columns and count only verified actors. The transport client does not infer these relationships. [Warehouse integration](../../../docs/WAREHOUSES.md).
