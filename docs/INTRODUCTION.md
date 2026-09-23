# What is Doorman?

Doorman is an open-source identity and activity-classification library. It helps you recognize returning browsers, connect verified people and agents to accounts, and add private activity estimates to the analytics tools you already use.

You run Doorman inside your own server and store its data in your own database. There is no Doorman account to create and no hosted Doorman service to send your visitors to.

## A visitor comes back without their cookie

Imagine someone visits your app on Monday. Doorman assigns their browser a random ID, such as `vis_abc123`, stores a small set of browser signals, and sets a cookie on your domain.

On Tuesday, that cookie gives Doorman the ID immediately. If the cookie is gone, Doorman compares the new visit with a small set of plausible past visitors. A close, unambiguous match can restore the original ID. Otherwise, Doorman creates a new one.

This is useful when you want continuity across ordinary browser updates, window resizing or cookie loss. It is an estimate: similar browsers can be hard to tell apart.

## What your app receives

The browser client makes one request to an endpoint in your application:

```ts
import { createVisitorClient } from "@aarondovturkel/doorman-browser";

const visitor = createVisitorClient({ endpoint: "/api/visitor" });
const identity = await visitor.identify();
// { visitorId: "vis_abc123", isReturning: true }
```

Your server receives more detail: matching confidence, risk scores and whether the risk assessment succeeded. Those fields stay on the server by default, so visitors cannot inspect the scores while changing their inputs.

The client needs a Doorman server endpoint and database behind it. Follow [your first visitor ID](GETTING-STARTED.md) for a runnable setup, or [install the packages](LANGUAGES.md) in an existing app.

## What Jev adds

**Jev** is an AI model made by TypeSafe. Doorman can ask it whether a browser fits its past history, whether a session looks automated, and whether the technical signals look inconsistent. Jev returns a score between 0 and 1 for each question. It also helps choose bounded lookup paths and, when learning is enabled, compares anonymous visits with earlier login-confirmed sessions to suggest a person across devices. Suggestions remain separate from verified logins.

Jev is optional. Without it, Doorman uses its built-in comparison rules for browser matching and marks risk as disabled. If an enabled evaluator fails, matching falls back to those rules and risk is marked unavailable.

Doorman does not show a CAPTCHA or block requests. Your application can use the private assessment when making those decisions. The scores need evaluation on your own traffic before you rely on a threshold. Read [Jev and risk scoring](JEV.md).

## A browser ID is different from a user ID

One person may have several browsers. Several people may share a browser. Recognizing a browser does not establish who is using it.

After your existing login system verifies a user, you can give Doorman that verified identity. It can then associate multiple devices with that user. You can also register an AI agent separately and record the actions it is allowed to perform for a user.

Doorman does not infer those permissions from mouse movements or an AI score. Your authentication system verifies the credentials; Doorman records and checks the relationships. [Browsers, people and agents](CONCEPTS.md) explains the terms with an example.

## Understand the activity behind a login

An account may be used by a human, an assistant or a scheduled script. The optional operator service scores those possibilities separately from abuse. It can summarize inferred profiles within an account and attach the results to PostHog, Mixpanel or warehouse events. Uncertain activity stays unknown.

This feature is experimental. Browser patterns cannot prove who is at the keyboard, name an agent brand reliably, or establish permission. [Agent classification](AGENT-CLASSIFICATION.md) explains the inputs and outputs; [public research results](EXTERNAL-BENCHMARKS.md) show the measured limits. You can [adjust scoring](SCORING.md) and evaluate settings on your own independently labeled traffic.

## Start small

You can use each feature as you need it:

| You want to…                            | Start with…                                                        |
| --------------------------------------- | ------------------------------------------------------------------ |
| Recognize returning browsers            | [The local example](GETTING-STARTED.md)                            |
| Understand the optional risk scores     | [Jev and risk scoring](JEV.md)                                     |
| Connect a signed-in user across devices | [People and agents](AGENTIC-IDENTITY.md)                           |
| Connect visits to product analytics     | [PostHog and Mixpanel](ANALYTICS.md)                               |
| Decide what data to collect and keep    | [Privacy](../PRIVACY.md) and [storage](../site/content/storage.md) |

Doorman is a developer preview. Its matching and risk scores are experimental. Use your existing authentication and authorization to protect accounts and sensitive actions.
