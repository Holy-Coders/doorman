# What is Doorman?

**0.13 is currently available from source.** The latest npm and Hex release is 0.12.0. The unified API below requires the source checkout, not the current registry release. [Run from source](https://github.com/Holy-Coders/doorman).

Doorman adds identity context to the analytics you already use. It remembers browsers, connects the users and agents your server authenticates, and gives you private estimates when identity or activity is uncertain.

Install one browser client and one server module beside your existing Postgres or D1 database. There is no Doorman account, hosted service or extra worker to run. Jev, an optional AI evaluator from TypeSafe, can assess browser history and activity.

## One account can have several operators

Imagine a household account. Two members sign in from four browsers, and an assistant uses its own credential to act for one member. Doorman keeps the account, verified members, assistant, browsers and sessions distinct. Your analytics can report each without treating four browsers as four people.

When a familiar browser returns before login, Doorman can remember which verified identities used it. A shared browser remains ambiguous. Remembered context never becomes a new login.

If the cookie is missing, browser similarity can suggest an earlier browser. Optional login feedback can also suggest a user on another device. Those estimates stay private, carry their evidence source, and never silently merge analytics identities. Unknown is a useful result.

## A small browser API

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  analytics: { posthog, mixpanel }, // Your initialized SDKs.
});

await doorman.identify();
// After your application's login succeeds:
await doorman.identify({ userId: user.id, accountId: account.id });
await doorman.track("Project created");
// On logout:
await doorman.reset();
```

Existing PostHog and Mixpanel events can keep using their SDKs: Doorman adds safe browser/session/account context through their supported APIs. Scores and inferred identities stay on your server.

[Set up the complete integration](IDENTITY-CONTEXT.md), including Phoenix, trusted server authentication, migrations and analytics reports. To explore basic browser matching first, [run a local example](GETTING-STARTED.md).

## Understand activity without treating every agent as an attacker

Jev can score human, assistant and scripted activity separately from suspicious behavior. Optional browser summaries, server-owned request patterns and network reputation provide evidence. An authorized agent can be automated and legitimate. Missing APIs, privacy settings and no mouse movement do not establish malicious activity.

Collection remains bounded: no actual keystrokes, form values, coordinate trails or recordings. External IP-reputation checks are separately enabled and disclosed. [Read what is collected](../PRIVACY.md).

## Know the limits

Browser continuity is not proof of a person. Shared passwords cannot establish how many humans are behind an account. Cross-device scores and activity labels are uncalibrated estimates; reliable headcounts and agent-brand identification have not been established. Our [public-data results](EXTERNAL-BENCHMARKS.md) include false matches and classification failures.

Your application owns authentication, authorization and any CAPTCHA policy. Doorman never automatically blocks users. If an evaluator fails, it falls back to deterministic browser evidence and marks risk unavailable.

Start with the [one-context integration](IDENTITY-CONTEXT.md). Request middleware, linked-activity analysis, warehouse exporters and classifier training are optional additions, not prerequisites.
