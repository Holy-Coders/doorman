# What is Janitor?

Janitor is an open-source library that helps your application recognize a returning browser. It can also estimate whether a visit looks automated or technically unusual, and connect visits to users who have signed in.

You run Janitor inside your own server and store its data in your own database. There is no Janitor account to create and no hosted Janitor service to send your visitors to.

## A visitor comes back without their cookie

Imagine someone visits your app on Monday. Janitor assigns their browser a random ID, such as `vis_abc123`, stores a small set of browser signals, and sets a cookie on your domain.

On Tuesday, that cookie gives Janitor the ID immediately. If the cookie is gone, Janitor compares the new visit with a small set of plausible past visitors. A close, unambiguous match can restore the original ID. Otherwise, Janitor creates a new one.

This is useful when you want continuity across ordinary browser updates, window resizing or cookie loss. It is an estimate: similar browsers can be hard to tell apart.

## What your app receives

The browser client makes one request to an endpoint in your application:

```ts
import { createVisitorClient } from "@janitor/browser";

const visitor = createVisitorClient({ endpoint: "/api/visitor" });
const identity = await visitor.identify();
// { visitorId: "vis_abc123", isReturning: true }
```

Your server receives more detail: matching confidence, risk scores and whether the risk assessment succeeded. Those fields stay on the server by default, so visitors cannot inspect the scores while changing their inputs.

The client needs a Janitor server endpoint and database behind it. Follow [your first visitor ID](GETTING-STARTED.md) for a runnable setup, or [install the packages](LANGUAGES.md) in an existing app.

## What Jev adds

**Jev** is an AI model made by TypeSafe. Janitor can ask it whether a browser fits its past history, whether a session looks automated, and whether the technical signals look inconsistent. Jev returns a score between 0 and 1 for each question.

Jev is optional. Without it, Janitor uses its built-in comparison rules for browser matching and marks risk as disabled. If an enabled evaluator fails, matching falls back to those rules and risk is marked unavailable.

Janitor does not show a CAPTCHA or block requests. Your application can use the private assessment when making those decisions. The scores need evaluation on your own traffic before you rely on a threshold. Read [Jev and risk scoring](JEV.md).

## A browser ID is different from a user ID

One person may have several browsers. Several people may share a browser. Recognizing a browser does not establish who is using it.

After your existing login system verifies a user, you can give Janitor that verified identity. It can then associate multiple devices with that user. You can also register an AI agent separately and record the actions it is allowed to perform for a user.

Janitor does not infer those permissions from mouse movements or an AI score. Your authentication system verifies the credentials; Janitor records and checks the relationships. [Browsers, people and agents](CONCEPTS.md) explains the terms with an example.

## Start small

You can use each feature as you need it:

| You want to… | Start with… |
| --- | --- |
| Recognize returning browsers | [The local example](GETTING-STARTED.md) |
| Understand the optional risk scores | [Jev and risk scoring](JEV.md) |
| Connect a signed-in user across devices | [People and agents](AGENTIC-IDENTITY.md) |
| Connect visits to product analytics | [PostHog and Mixpanel](ANALYTICS.md) |
| Decide what data to collect and keep | [Privacy](../PRIVACY.md) and [storage](../site/content/storage.md) |

Janitor is a developer preview. Its matching and risk scores are experimental. Use your existing authentication and authorization to protect accounts and sensitive actions.
