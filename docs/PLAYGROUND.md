# Try the playground

The [playground](https://doorman.holycoders.io/playground/) has local examples and an optional live demo. Opening the page does not collect browser signals, create a tracking session or call Jev.

## The local examples

The browser example runs the real `@aarondovturkel/doorman-core` matching engine against a made-up Chrome browser and in-memory history. Each button starts from the same history and changes one thing: a missing cookie, browser update, resized viewport, different timezone, missing WebGL or a different device. AI is off. The displayed confidence comes from Doorman's deterministic rules.

The people-and-agents example runs Doorman's identity and delegation checks with example people, an agent and permission records. You can see what happens when permission expires, is revoked or does not cover the requested action. It does not infer a person's identity from browser signals.

Both examples stay on the page. They use no real cookies, observations, database or model calls.

## Try your actual browser

**Current pilot status:** browser identity and Jev are live. On September 23, 2026, a hosted browser check received fresh Jev answers, reused a cached answer without another model call, recovered its visitor ID and erased its data. This confirms the integration works; it does not measure accuracy on real-user traffic. If the pilot allowance is exhausted, the demo continues with deterministic matching.

1. Read the collection notice, tick the checkbox and choose **Start my live demo**.
2. Doorman's browser package collects browser signals and aggregate event counts. Our server creates a first-party visitor cookie and saves history in Cloudflare D1.
3. **Take a new snapshot** measures again. **Repeat saved snapshot** resends what you already supplied; identical model inputs can use the private cache. The first repeat may need a fresh evaluation because the initial visit added new history. Repeating again can reuse that evaluation.
4. **Remove visitor cookie & retry** tests recovery from your saved history. A separate signed demo-session cookie remains so the server can limit the lookup to your own history. This tests a controlled cookie-loss scenario, not recognition after every cookie is removed.
5. **Stop & erase my demo data** removes your history, cached answers and both demo cookies. Collection stops immediately. If erasure fails, use the button again. Closing the page also stops collection; server data follows the retention policy below.

Identity and risk use separate model inputs. Each identity/risk pair can make two provider calls; a cached half is reused independently. If either half needs fresh inference, the response reports a fresh evaluation regardless of completion order. If both use cache, the displayed time is the older cached answer. The lifetime allowance counts actual provider reservations, including failures, and remains unchanged.

The response contains a visitor ID, whether it was recognized, and whether AI evaluation was fresh, cached or unavailable. Numeric risk and confidence stay on the server. Cached results include their original evaluation time. Unavailable AI is never presented as a successful Jev judgment.

This is Doorman using its own library: browser collectors, matching engine, D1 storage, HTTP handler, Jev integration and shared request protections. The public-demo wrapper adds ownership checks, caching and a lifetime call allowance.

## What the live demo can establish

You can inspect a real browser request, receive a first-party cookie and exercise the actual storage and evaluation path. Each session is isolated: a visitor cannot search or erase another visitor's history. A session keeps at most five browser IDs with five observations each.

The site has no login, so it cannot supply verified person labels or teach cross-device person matching. Use the [learning guide](LEARNING.md) in an application with real authentication for that experiment. A demo match does not prove human identity or establish accuracy across a population.

## How we bound AI usage

- **100 call reservations for the whole pilot**, shared across all visitors, deployments and dates. This total never refills automatically.
- **At most 20 reservations per UTC day.** Database-atomic claims happen before inference. Failures and timeouts are never refunded.
- **Two concurrent evaluations**, a circuit breaker and a short provider deadline. Competing identical inputs share one database claim; only its winner may start inference.
- **Private 24-hour cache.** Keys include the session, model, questions, compact input and protocol version, protected with a server HMAC. Cache rows contain validated answers rather than raw prompts. Browser responses are always `private, no-store`.
- **Provider controls.** Each Workers AI call disables AI Gateway request logging and gateway caching, and sets a single attempt. Doorman's own cache is scoped to the signed demo session.
- **Bounded work.** Browser bodies are limited to 8 KiB and model inputs to 16 KiB. Only Doorman's fixed questions reach Jev. AI lookup planning is off for this demo's tiny candidate set.
- **Request quotas.** New sessions and cleared cookies cannot reset the inference budget. There are no automatic retries, background polling or AI calls on ordinary page views.

The counters measure admitted calls, not dollars. Cloudflare directs readers to its dashboard for [Jev pricing](https://developers.cloudflare.com/ai/models/typesafe/jev/). We do not substitute TypeSafe's direct API rate or assume Workers AI's general free allocation covers Jev. This allowance covers this demo's model calls; it does not cap unrelated Cloudflare traffic, database charges or other applications.

A timeout stops our wait; a provider may finish already-admitted work afterward. That attempt has already consumed its reservation. The two-evaluation guard limits admitted local work rather than promising that a remote provider has stopped processing.

When inference is unavailable or the allowance is exhausted, Doorman continues deterministic matching where storage and request capacity permit. The page reports that AI was unavailable. Raising the allowance is an explicit server deployment decision.

## Data and retention

The live demo collects browser/platform/languages/timezone, screen and viewport dimensions, available hardware and WebGL information, the webdriver flag, page age and event counts. Doorman collects no actual keys, mouse coordinates, form values, URLs, history, geolocation or raw IP addresses. Extended behavior collection and cross-device learning are off here.

The signed session expires after 24 hours and repeated clicks do not extend it. Expired sessions cannot be used for matching. An hourly cleanup on the existing site Worker removes their history and cached answers; physical deletion can take up to one further hour. Successful manual erasure is immediate. Anonymous aggregate spending counters remain so erasure cannot refill the allowance.

Admitted Jev requests send compact signals and counts through Cloudflare's model service. Erasure removes our stored copies; provider processing follows its policies. We do not log observation payloads or full model responses. See [all collected signals](../PRIVACY.md) and the [site runbook](../site/README.md) for deployment, budget inspection and the inference kill switch.
