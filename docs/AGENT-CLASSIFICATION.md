# Classify people, assistants and scripts

An email address tells you which account is signed in. It does not tell you who is operating it right now. A person might browse manually, hand a task to an AI assistant, or run a scheduled script.

Janitor adds private evidence about that activity to the identity context you already send to analytics. It supports three separate things:

| Capability                            | What supports it                                                           | What you receive                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Verified agent identity               | Credentials and delegation checked by your server                          | The known actor and the account it may act for                                                        |
| Experimental activity classification  | Browser aggregates, server API patterns and optional Jev evaluation        | Independent human, assistant, conventional automation and abuse scores; unknown when evidence is weak |
| Trainable assistant/abuse classifiers | Independently confirmed examples, offline training and held-out evaluation | A versioned local model, coverage checks and private scores                                           |

Classification cannot establish permission. An assistant can be legitimate; a human can be abusive. Inferred labels never replace your authenticated user ID or merge analytics profiles.

## The new movement and timing evidence

With `behavior: "extended"`, the browser computes a few additional summaries in constant memory. The default remains event counts.

```ts
const visitor = createVisitorClient({
  endpoint: "/api/visitor",
  behavior: "extended",
});
```

| Measurement                 | What it means                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Mean movement step          | Total displacement divided by valid movement samples                               |
| Large-step fraction         | Fraction of valid movement samples with a displacement of at least 100 pixels      |
| Movement interval variation | Variation in active movement gaps below one second, after enough samples           |
| Short interaction gaps      | Fraction of consecutive pointer/key press intervals below 100 milliseconds         |
| Repeated interaction gaps   | Fraction of comparable neighboring intervals within 10 milliseconds of one another |

Only totals, counts and distribution summaries leave the page. Janitor does not retain coordinate arrays, key values, event targets or an individual keystroke trail. Held-key repeats are excluded from timing; visibility changes and blur break the timing sequence. Invalid or missing movement values are skipped. Measurements are rounded before use in the optional learning service. [The full data contract](../PRIVACY.md) lists collection and retention.

These patterns can help a classifier, but none proves automation. Browser event batching, high-DPI devices, remote desktops, accessibility tools and ordinary repeated tasks can produce similar patterns. Janitor does not call a large movement a physically impossible jump. [W3C Pointer Events](https://www.w3.org/TR/pointerevents/) documents implementation-dependent event delivery and coalescing.

The existing `navigator.webdriver` signal can also be included in operator evidence as `webdriver: 0 | 1`. A true value is technical evidence of reported browser automation; false or missing values do not prove human operation or identify an AI product. Janitor does not attempt to defeat browser privacy protections, inspect DevTools internals or infer screenshot capture from focus changes.

## Bring browser and server evidence together

The server receives browser behavior through the existing validated identification payload. For operator assessment, explicitly project an authorized, closed activity window:

```ts
import { extractFeatures } from "@janitor/network";

const features = extractFeatures({
  behavior: validatedBehavior,
  observation: validatedSignals,
  activity: serverActivity,
  routes: routeCategories,
  sequence: serverSequence,
});

const result = await janitor.operators!.observe({
  accountId: authorizedAccount.id,
  sessionId: serverSession.id,
  windowId: closedWindow.id,
  browserId: visitorId,
  startedAt: closedWindow.startedAt,
  endedAt: closedWindow.endedAt,
  evidence: { source: "mixed", features },
});
```

Use one bounded window and the same session/account for all inputs. Lifetime browser totals are not automatically divided into closed windows: reset your application's collector between windows. Browser measurements remain untrusted even when combined with server observations. Do not pass raw request bodies directly to this API. [Operator setup](OPERATOR-ATTRIBUTION.md) covers authentication, budgets, storage and analytics exports.

Jev evaluates human, assistant, script and abuse evidence separately. The operator prompt version is `operators-v2`; current transport remains TypeSafe's typed `noul` questions or Cloudflare's `typesafe/jev`. Family suggestions require independently labeled reference runs. Generic behavior cannot reliably identify ChatGPT, Claude, an underlying model, or a unique physical person. Unknown is an expected result.

## Put the results in your existing analytics

Send assessed windows and account summaries through the server analytics bridge. PostHog, Mixpanel, Segment, Amplitude and RudderStack receive inference-specific properties, while Snowflake and BigQuery can use warehouse rows. Scores remain private unless your server explicitly chooses to export them.

You can ask how many evaluated windows looked assistant-operated, which accounts had unresolved activity, and how many inferred profiles a fully compared report supports. “Three agents and two humans” is an estimate only when enough evidence exists; it is not a verified headcount. [Account reports](OPERATOR-ATTRIBUTION.md) explain missing counts and report revisions.

## Evaluate before relying on it

The [public benchmark](EXTERNAL-BENCHMARKS.md) compares the old five-feature model with the new measurements using FP-Agent and Balabit, and replays historical browser identity with FP-Stalker. These are research datasets, not proof of your production accuracy. Existing dataset labels do not validate unique-person counts, agent intent or permission.

Use [scoring configuration](SCORING.md) to tune application thresholds. Use the [classifier pipeline](CLASSIFIER.md) to fit numeric models or combine them with versioned Jev features. Neither action fine-tunes Jev itself. New collectors are available; whether they improve detection is a measured outcome, not a product promise.

See [optional detection signals](EXPERIMENTAL-DETECTION.md) for local fonts, runtime/permission probes, target/focus summaries and trusted JA4 evidence. [Linked suspicious activity](LINKED-ACTIVITY.md) correlates server-observed denials across likely related sessions without using IP addresses or merging people. These are opt-in source features with documented experimental limits.
