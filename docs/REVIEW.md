# Compare Doorman with other tools

Doorman is a small library you run in your application. It adds browser continuity, optional AI risk estimates and records connecting verified people and agents. It does not replace an analytics platform, login system or managed fraud service.

This guide explains where those tools overlap and where you would use them together. The comparison is based on documented capabilities reviewed on September 23, 2026, not a head-to-head accuracy or cost benchmark.

## Analytics and customer data

| Tool | What it is useful for | How Doorman fits alongside it |
| --- | --- | --- |
| Segment | Collecting events from sources, sending them to destinations and linking customer identifiers. | Send verified identity and private assessment events through your existing Segment server client. |
| RudderStack | Event pipelines and identity resolution in SDKs or a data warehouse. | Keep that pipeline and add Doorman context to the events you choose to export. |
| PostHog | Product analytics, connecting anonymous visits to known users, experiments and other product tools. | Use Doorman’s login/reset helper and optional server events while PostHog continues to own analytics. |
| Mixpanel | Analyzing user journeys, retention and account activity. | Keep the person’s analytics ID and add separate browser, actor and account properties. |

You do not need Doorman merely to call an analytics SDK’s `identify()` method. Those products already support known-user identification. Doorman is useful when you also want browser history, private technical assessments or explicit agent/account relationships in your own runtime.

Follow the [analytics integration guide](ANALYTICS.md) for the working PostHog, Mixpanel and Segment APIs. It includes shared-browser behavior and reports that count distinct verified people or agents per account.

## Browser and risk intelligence

Fingerprint offers visitor identification and separate device-risk signals. This is closer to Doorman’s browser/risk role than a product analytics platform. Fingerprint also documents signed-agent detection; recognizing agents is not unique to Doorman.

Doorman’s tradeoff is control and inspectability: you operate its database, can read the matching rules, and can replace the evaluator. It does not come with a large network’s reputation data, a proven fraud-detection model or established accuracy parity with a managed product. Read [the matching limitations](MATCHING.md) and [recorded benchmarks](VALIDATION.md) before choosing it for a risk-sensitive workload.

## Authentication and permissions

Keep your existing authentication provider or application login. It verifies passwords, passkeys, tokens and recovery flows. Doorman accepts verified identity from that system; it does not perform those checks from browser signals.

An AI assistant needs its own authenticated identity and the user’s permission. Doorman can store a limited delegation and check its scope, expiry and revocation. Your application still enforces access. See [people and agents](AGENTIC-IDENTITY.md).

## When Doorman may fit

Doorman is worth evaluating when you want an open-source component inside your existing app, are comfortable operating Postgres or D1, and can test browser matching and risk thresholds against your own traffic. Optional Jev evaluation can be replaced without changing the browser API.

Choose an established service when you need managed operations, supported detection guarantees or intelligence Doorman does not provide. No synthetic benchmark can close the gap in real-user accuracy evidence.

## What to verify before relying on it

- Measure false browser associations and missed returns, including common identical profiles.
- Test risk scores on ordinary users, privacy browsers, assistive technology, authorized agents and actual automation.
- Keep unavailable risk distinct from an evaluated low score.
- Verify login, user switching and logout in your analytics project.
- Measure database latency, AI costs and overload behavior under your workload.

The [evaluation guide](EVALUATION.md), [capacity report](CAPACITY.md) and [security guide](SECURITY.md) explain the tools and limits available for these checks.

## Sources

- [Segment identity resolution](https://www.twilio.com/docs/segment/unify/identity-resolution) and [Identify specification](https://www.twilio.com/docs/segment/connections/spec/identify).
- [RudderStack SDK identity resolution](https://www.rudderstack.com/product/sdk-identity-resolution/) and [warehouse identity model](https://github.com/rudderlabs/dbt-id-resolution).
- [PostHog identification](https://posthog.com/docs/product-analytics/identify).
- [Mixpanel user identification](https://docs.mixpanel.com/docs/tracking-methods/id-management/identifying-users-simplified).
- [Fingerprint Smart Signals](https://docs.fingerprint.com/docs/smart-signals-reference) and [AI agent detection](https://docs.fingerprint.com/docs/ai-agents).
