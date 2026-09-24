# Privacy and collected signals

Doorman runs on your application's origin and stores a random browser ID and recent observations in your database. The recommended API keeps scores and tentative user matches on your server. It does not send telemetry to a Doorman-operated service.

A retained cookie establishes browser continuity. Without it, the recommended flow creates a fresh ID and keeps possible historical matches private. Cookie removal does not delete retained observations; provide the erasure path below.

## Collection choices

`collection: "minimal"` is the default. `collection: "extended"` adds the aggregate and environment probes listed below. Instantiate the client only when your application's collection policy permits it. `setEnabled(false)` pauses collection; `destroy()` removes listeners and aborts pending identification.

All signal fields are optional. Blocked or unavailable APIs remain missing. Doorman does not bypass browser restrictions or reconstruct intentionally hidden values.

## Browser signals and aggregate behavior

| Signal                | Source                                             | Purpose                                                                         |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| User agent            | `navigator.userAgent` (at most 512 characters)     | Browser family and ordinary update context; stored, omitted from provider state |
| Platform              | `navigator.platform`                               | Coarse operating-system/environment matching                                    |
| Languages             | `navigator.languages` (at most 20)                 | Language-set continuity                                                         |
| Timezone              | `Intl.DateTimeFormat().resolvedOptions().timeZone` | Coarse environment evidence; not geolocation                                    |
| Screen width/height   | `screen.width`, `screen.height`                    | Compare dimensions with orientation normalized                                  |
| Screen color depth    | `screen.colorDepth`                                | Technical environment evidence                                                  |
| Device pixel ratio    | `window.devicePixelRatio`                          | Display scaling context                                                         |
| Viewport width/height | `window.innerWidth`, `window.innerHeight`          | Low-weight context tolerant of window resizing                                  |
| CPU concurrency       | `navigator.hardwareConcurrency`                    | Coarse hardware continuity                                                      |
| Device memory         | `navigator.deviceMemory`, when available           | Coarse hardware continuity                                                      |
| Maximum touch points  | `navigator.maxTouchPoints`                         | Device capability continuity                                                    |
| Webdriver flag        | `navigator.webdriver`                              | Technical automation evidence, excluded from identity scoring                   |
| WebGL vendor/renderer | Standard `gl.VENDOR`, `gl.RENDERER`                | Graphics environment evidence; masked values are accepted                       |

There is no canvas-derived hash. A temporary canvas is used only to request an ordinary WebGL context. No image is rendered or read back. The unmasking/debug-renderer extension is never requested. The context is released if the standard context-loss extension is available. No attempt is made to defeat anti-fingerprinting, infer intentionally hidden hardware values, or access persistent storage beyond the server-set cookie.

While enabled, the browser client counts events from its creation until collection is paused or the client is destroyed:

- elapsed milliseconds since tracker creation (bounded to seven days);
- mouse-move, pointer-down, key-down, scroll and visibility-change counts (each capped at one million).

Only totals are sent on `identify()`. The default `collection: "minimal"` profile does not inspect event contents.

Optional `collection: "extended"` adds these bounded, rounded summaries:

- `mouseDistancePx`: sum of mouse movement delta lengths;
- `mouseActiveMs`: accumulated intervals below one second between mouse events;
- `mouseDirectionChanges`: count of successive movement vectors more than 90 degrees apart;
- `mousePauseCount`: mouse-event gaps of at least one second;
- `scrollDistancePx` and `scrollDirectionChanges`: absolute vertical wheel deltas and sign reversals, using pixel-mode wheel events only (attempted movement, not actual page travel);
- `interactionIntervalCount`, `interactionIntervalMeanMs`, `interactionIntervalStdDevMs`: count, mean and population standard deviation of successive key-down/pointer-down intervals no greater than one minute.

Extended mode reads movement deltas, wheel deltas and a monotonic clock. It retains only running totals and the immediately preceding delta/time in transient memory. Visibility/focus gaps reset timing continuity. Movement/timing collection does not read absolute coordinates, key values, text or form data. The separate target probe included in the extended profile transiently reads press coordinates as explained below. No raw events, timestamps, movement paths or event sequences are sent or stored. Extended mode is opt-in so applications can disclose the additional processing before starting collection. These are uncalibrated risk inputs, never browser-identity matching features. If you also enable learning, Jev may consider their aggregates as weak supporting evidence for private cross-device suggestions. Creation adds passive listeners; `destroy()` removes them and aborts in-flight identification. Call it on unmount or opt-out. Creating a tracker is separate from sending an observation; the example button controls sending, while counts accumulate while the example is open.

Extended mode also counts valid movement samples, steps of at least 100 pixels, active movement intervals below one second, press intervals below 100ms, comparable adjacent intervals and intervals that differ by at most 10ms. It stores movement interval mean/standard deviation. These permit rounded mean-step, large-step, movement-variation, short-gap and repeated-gap features for optional classification. Held-key repeat events are excluded from timing; focus/visibility breaks reset the preceding-event state. Only the immediately preceding delta/time and running totals are held locally, not a movement or typing trail. These patterns are not proof of automation or screenshot capture.

## Other signals in extended collection

These probes are off in minimal collection and included by `collection: "extended"`, except the decoy, which is not part of that profile. `fonts` tries twelve named local families (Arial, Times New Roman, Courier New, Verdana, Georgia, Trebuchet MS, Helvetica Neue, Menlo, Segoe UI, Consolas, Roboto, Noto Sans) using unattached, local-only `FontFace` loads. Only a version and 12 availability bits are stored in observation JSON. No fonts are downloaded, page font faces added, local-font inventory enumerated, canvas image read or browser restriction bypassed. This small set can still help fingerprint an environment and requires disclosure. The default deterministic font weight is zero; applications can configure it. Jev can receive the set with compact observations. Fonts do not establish person or cross-device ownership.

`pageFonts` counts loaded/loading/failed statuses among at most 100 page faces, without reading their names or URLs. `runtime` checks descriptors for eight fixed automation marker names and an own `navigator.webdriver` property; it neither enumerates all globals nor runs their getters. `permissions` reads Notifications and Permissions API states without requesting permission or registering state-change listeners. Font and permission work has a 250 ms deadline; late results cannot send an identification after pause/reset. Missing or blocked APIs remain unknown.

`targets` transiently reads mouse press coordinates and element rectangles, reduces them immediately to eligible/center/top-left counts and retains neither coordinates, rectangles, elements, selectors nor text. This differs from the ordinary extended mode, which does not read absolute coordinates or targets. `focus` counts captured focus/blur events and inputs while the document lacks focus; it does not observe screenshots. The separate research decoy is not enabled by this profile. Counters are capped at one million. No actual keys or form data are read. See [the full contract and experimental controls](docs/EXPERIMENTAL-DETECTION.md).

## What is not collected

Doorman does not capture actual keys, form values, passwords, text inputs, mouse-coordinate trails, browsing history, camera, microphone, geolocation or session recordings. Target coordinates are processed transiently into counters, not stored or transmitted. Request/response bodies and raw resource URLs are not recorded by its API middleware.

The browser uses no cross-origin tracking endpoint, persistent localStorage/IndexedDB identity copy or third-party identifier. The current origin is checked locally to restrict delivery. Hosting access logs and any separately configured analytics replay are outside Doorman's collection and need their own policy.

## Storage and Jev data flow

Visitor tables retain opaque random IDs, timestamps, normalized observations and a few indexed lookup fields. IDs encode no fingerprint. Identity associations use namespace-scoped HMAC references: this is pseudonymous, linkable data, not anonymous data.

With Jev enabled, your server sends compact signals to TypeSafe or through Cloudflare Workers AI. Browser identity questions contain current/history observations and exclude automation flags, behavior and runtime probes. Separate risk questions use current technical and allowed risk evidence, not identity history. Candidate IDs are request-local indexes; raw emails, persistent account IDs, cookies, credentials, URLs and IPs are not sent to Jev.

Optional cross-device evaluation sends compact login-confirmed examples under the same provider policy. It compares examples, not retrains a model. Provider retention and handling terms remain separate from your database retention. Without an evaluator, no observation is sent to an AI provider.

The public result is `{ visitorId, sessionId, isReturning }`. Do not copy private scores, candidates or debug observations into browser responses or logs. PostHog/Mixpanel browser integration registers only safe browser/session/account context. Private analytics exports are explicit server actions and require their own access and deletion policy.

## Unified identity context and optional network reputation

The recommended `createDoorman` / Phoenix `secret` configuration records browser-to-subject/account/actor associations only from server-authenticated context. IDs are HMAC-labeled; they are pseudonymous personal data, not anonymous data. Cookie history is remembered context, never current authentication. Shared browsers return several possible relationships. Similarity and cross-device suggestions stay private and do not merge analytics identities. A separate opaque first-party session cookie expires after 30 minutes between assessments.

`collection: "extended"` is a shortcut for the optional bounded font, runtime, permission, target/focus and aggregate behavior collectors described above. It does not enable decoys, recordings, actual keystrokes, coordinate storage or anti-fingerprinting bypasses. Minimal collection remains the default. Existing provider replay/autocapture remains governed by your application's provider settings, not Doorman.

IP reputation is disabled unless an application configures an AbuseIPDB key and supplies a server-resolved public client IP. Enabling it sends that IP to AbuseIPDB's read-only check endpoint. Doorman never automatically reports visitors. It retains only a bounded scored summary, source/time, and HMAC cache key; raw IPs do not enter observation history, analytics properties or Jev requests. TypeScript caches summaries in memory; Phoenix uses its existing database cache. Default cache lifetime is five minutes and request budget is 100/hour per namespace. Short-lived HMAC IP keys remain pseudonymous identifiers. Disclose the provider and purpose before enabling this feature, and review provider retention separately.

Optional server risk counters and edge evidence are used only for risk, not identity matching. Reputation is evidence about a network address, not proof of a person's conduct. Errors and insufficient data carry explicit unavailable/unknown statuses.

`forgetUser(rawUserId)` / `Doorman.forget_user` removes that user's associations, directory identity and dependent login-learning history. Browser deletion cascades its associations. The normal cleanup function expires associations after the configured observation retention period (default 90 days). Analytics exports require deletion through the relevant analytics provider as well. Remembered relationships refresh only after authenticated observations.

## Optional cross-device feedback

`crossDevice: true` (Phoenix: `cross_device: true`) records anonymous pre-login observations and their later independently verified self-login. A separate 30-minute cookie connects that short flow. Feedback defaults to 30 days and at most 20 confirmed sessions per person. Conflicting users and agent/delegated activity are excluded from self-login labels.

The feature is disabled by default. Server-supplied `learningConsent: false` withdraws a session when it is enabled. Predictions remain private and never become their own labels, authentication or analytics profile merges. [Cross-device guide](docs/LEARNING.md).

## Optional API activity

When an implementer explicitly configures `activity`, server middleware can aggregate selected API operations for an application-issued session or authenticated actor. It stores an application-scoped HMAC key, a configured route template, window start and expiry, request/401–403/4xx/5xx counts, total/max handler duration, first/last completion times and the number of same-route completion gaps below 100ms. No body, header, credential, raw ID, raw IP, query value or actual resource URL is read by this middleware. Route templates must be static application configuration. There is no browser network interception or cross-application tracking.

The default counter window is one minute and retention is one day, configurable from 1–30 days. Only up to 128 rows from the latest five windows are loaded for an assessment. With Jev enabled, that compact summary, configured route/sensitivity and optional verified actor kind/delegation status go to the evaluator. HMAC keys and underlying account/session IDs do not. This transfer is separate from browser observation and cross-device learning. Shared evaluation leases and a one-minute default cache limit repeated calls; cached records contain the private assessment and compact summary.

Existing cleanup removes up to 100 expired rows from each new table per call. Stop collection and coordinate in-flight requests, then use `activity.deleteKey` / `Doorman.Activity.delete_key` to erase counters and caches for an actor or session. Browser/subject deletion does not automatically find these separately derived keys; applications must include them in account/session erasure. Disabling collection does not delete existing rows. These pseudonymous records remain linkable data; disclose collection, provider transfers, retention and erasure, and apply the application's collection policy before supplying middleware context.

The explicit server analytics bridge can additionally export API risk status, evaluated scores, evaluation/expiry times, cache and truncation flags, window size and request totals. It excludes route history and does not export API activity automatically. Nothing is added to browser responses. See [API activity](docs/API-ACTIVITY.md) for configuration and operational limits.

## Optional linked API activity

With `activity.correlation` enabled, server code can supply up to three group references with linkage basis and confidence. The correlation helper HMACs up to four bounded application-selected components within the implementer's namespace; it does not read a request body, IP address or raw credential. Never supply passwords or bearer tokens. Session/actor aggregates remain separate. Shared group counters retain configured route, window, status and timing summaries, following activity retention (default one day). Private cached assessments can contain related summaries, confidence and basis, not raw identifiers. Jev receives bounded summaries with overlapping-count and uncertainty instructions, without group IDs or HMAC input components.

Groups are hypotheses, not verified users or analytics identity merges. `deleteCorrelation` erases the whole aggregate group, since individual contributions cannot be subtracted from counters. Also delete affected session/actor keys to erase their cached summaries; otherwise those expire with the assessment cache (default one minute). Stop collection first. [Linked activity](docs/LINKED-ACTIVITY.md) documents the lifecycle. No data is contributed to a Doorman-operated service automatically.

Correlation erasure uses the same admission-threshold configuration that recorded a group. If you change that threshold, earlier policy groups remain isolated and expire under their original retention; erase them using a service configured with the earlier threshold when immediate deletion is required.

## Retention and erasure

Browser observations default to 90 days, at most ten per visitor, with five loaded for matching. The visitor cookie defaults to 90 days. Shorten history when your application does not need it. Reads exclude expired data before physical deletion. Run `cleanup()` from existing maintenance; no scheduler is installed.

For deletion, stop collection and coordinate in-flight requests first. From an authorized server operation:

1. Use `forgetUser(rawUserId)` / `Doorman.forget_user` for a user's associations and login feedback.
2. Use `deleteVisitor(visitorId)` / `Doorman.delete_visitor` for browser history and its relationships.
3. Delete separately keyed API activity and correlation groups when enabled, as described above.
4. Clear the server cookies with their matching names and paths, and keep the application opt-out in effect.
5. Delete downstream analytics exports and apply your backup/provider retention policy.

A cookie or visitor ID is not proof of account ownership. Authorize erasure through your application, not a public endpoint that accepts arbitrary IDs. Pausing collection alone does not erase existing records. [Storage guide](site/content/storage.md).

## Public playground

Reading the Doorman website or using its synthetic examples collects no visitor observations. The live playground starts after its notice and explicit start action. It uses minimal browser signals/event counts, first-party cookies and our Cloudflare D1 database; compact signals may be evaluated through Workers AI. Scores stay private. Cross-device feedback, extended collection and analytics forwarding are off.

Demo sessions expire after 24 hours, with an hourly cleanup. Stop & erase removes the session's history and cached answers when successful; anonymous aggregate call counters remain for budget enforcement. The demo uses a lower-level browser-recovery experiment, so it can restore a browser ID after cookie loss. [Playground details](docs/PLAYGROUND.md).

## Explain use to your users

Disclose the purpose, signal categories, cookies, retained history, optional providers and erasure process before enabling the relevant collection. Browser similarity does not authenticate a person. Missing signals and privacy settings are not evidence of abuse. Doorman does not automatically show a CAPTCHA or block an action.

Separately configured research modules have a [historical full data inventory](docs/archive/PRIVACY-ADVANCED.md). They are not started by the recommended integration and are not required for normal setup. Review their independent data flows before deliberately using that archived code.
