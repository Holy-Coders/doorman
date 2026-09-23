# Privacy and collected signals

Janitor collects a small set of signals from a browser visiting your application so it can recognize that browser later. It stores a random visitor ID and a short history in your database. “First-party” means the client talks to an endpoint on your application’s own origin.

If a cookie disappears, Janitor can use retained history to recover the ID. Explain this behavior in your disclosure: deleting the cookie alone does not delete stored observations.

Basic browser recognition, optional AI evaluation, verified user links and learning feedback have different data flows. This page lists them so you can choose what to enable and provide a complete deletion path.

## Our public playground

Reading Janitor's website and running its local examples collects no visitor observations. The optional **live playground** begins only after its collection notice and explicit start action. It uses the signals and event counts described below, two first-party HttpOnly cookies, and our Cloudflare D1 database. Compact signals may be evaluated by Jev through Cloudflare. Numeric scores remain private; there are no browser analytics integrations on this site.

Demo sessions expire after 24 hours, with physical removal by an hourly cleanup. The **Stop & erase** button deletes the session's browser history and cached AI answers immediately when successful. Anonymous aggregate call counters are retained to enforce the budget. Clearing a visitor cookie alone does not erase stored history. Cross-device learning, account linking and extended behavior summaries are disabled on the public demo. [Full playground behavior and limits](docs/PLAYGROUND.md).

## What is collected

Every browser observation field is optional. Each collector is guarded independently and accepts absent or blocked APIs.

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

There is no canvas-derived hash. A temporary canvas is used only to request an ordinary WebGL context. No image is rendered or read back. The unmasking/debug-renderer extension is never requested. The context is released if the standard context-loss extension is available. No attempt is made to defeat anti-fingerprinting, infer intentionally hidden hardware values, probe fonts, or access persistent storage beyond the server-set cookie.

While enabled, the browser client counts events from its creation until collection is paused or the client is destroyed:

- elapsed milliseconds since tracker creation (bounded to seven days);
- mouse-move, pointer-down, key-down, scroll and visibility-change counts (each capped at one million).

Only totals are sent on `identify()`. The default `behavior: "counts"` mode does not inspect event contents.

Optional `behavior: "extended"` adds these bounded, rounded summaries:

- `mouseDistancePx`: sum of mouse movement delta lengths;
- `mouseActiveMs`: accumulated intervals below one second between mouse events;
- `mouseDirectionChanges`: count of successive movement vectors more than 90 degrees apart;
- `mousePauseCount`: mouse-event gaps of at least one second;
- `scrollDistancePx` and `scrollDirectionChanges`: absolute vertical wheel deltas and sign reversals, using pixel-mode wheel events only (attempted movement, not actual page travel);
- `interactionIntervalCount`, `interactionIntervalMeanMs`, `interactionIntervalStdDevMs`: count, mean and population standard deviation of successive key-down/pointer-down intervals no greater than one minute.

Extended mode reads movement deltas, wheel deltas and a monotonic clock. It retains only running totals and the immediately preceding delta/time in transient memory. Visibility/focus gaps reset timing continuity. Absolute pointer coordinates, key values, event targets, text and form data are never read. No raw events, timestamps, movement paths or event sequences are sent or stored. Extended mode is opt-in so applications can disclose the additional processing before starting collection. These are uncalibrated risk inputs, never browser-identity matching features. If you also enable learning, Jev may consider their aggregates as weak supporting evidence for private cross-device suggestions. Creation adds passive listeners; `destroy()` removes them and aborts in-flight identification. Call it on unmount or opt-out. Creating a tracker is separate from sending an observation; the example button controls sending, while counts accumulate while the example is open.

## What is never collected by the library

No raw IP addresses, geolocation, actual keystrokes, passwords, text inputs, form values, absolute mouse coordinates, camera, microphone, browsing history, referrer, URL history or third-party tracking identifiers are collected from the browser. The current application origin is used locally to enforce same-origin delivery, not stored as a fingerprint feature. The library does not read IP-related request headers. Network infrastructure naturally receives connection metadata; configure hosting/access logs separately because they are outside this library's control.

There are no third-party browser scripts, beacons, cross-origin endpoints, hidden storage caches, localStorage/IndexedDB identity copies, evercookies, or attempts to recover values hidden by browser protections. All collection uses ordinary browser APIs.

## Stored data and sharing

`visitors` stores an opaque ID and creation/last-seen timestamps. `observations` stores normalized JSON (including the optional aggregate behavior), a timestamp, visitor link, and coarse indexed fields: platform, browser family, timezone and WebGL renderer. The ID contains 192 random bits and encodes no browser information.

When an evaluator is enabled, compact observations (up to five history entries plus current data and similarity evidence) are sent server-to-server to TypeSafe, or through Cloudflare Workers AI. The compact payload excludes raw user agent, visitor ID, cookie, IP address and application URL. Platform/browser, language/timezone, display/hardware/graphics values, webdriver and enabled aggregate behavior summaries are included. This is still browser-environment data: disclose the evaluator providers and review their handling terms for your application. Deterministic-only mode does not send data to an evaluator.

Server assessments contain ID, continuity confidence and risk. HTTP responses contain only ID and returning status unless the implementer explicitly enables score disclosure. Debug responses additionally expose collected signals only with explicit client/server opt-in and a non-production server environment. Do not log debug output. Optional metrics contain counts, scores, evaluator usage/latency, returning status and whether history was saved; no fingerprints are logged by default.

## Retention

Defaults: retain observations for at most 90 days and at most ten per visitor; matching loads only the latest five retained observations. Choose a shorter period if sufficient for the application (for example 30 days). The default cookie lifetime is 90 days and refreshes on identification. These are operational suggestions, not universal compliance requirements.

Reads and candidate searches exclude expired observations even before deletion. Each save prunes the visitor's history. `await visitor.cleanup()` removes expired rows, excess observations, and expired empty visitor records. Invoke it periodically using existing application maintenance (for example daily); no scheduler or background worker is installed. Until cleanup runs, expired data may still be physically present, but is not used for matching. Include backups, database exports and provider-side retention in the application's retention process.

## Erasure and withdrawal

1. Stop invoking/creating the browser client; call `visitor.destroy()` on an existing instance.
2. In an application-authorized server operation, call `await serverVisitor.deleteVisitor(visitorId)`. This deletes that visitor and cascades all its observations. Do not expose an unauthenticated endpoint that deletes any supplied ID.
3. Clear the first-party cookie using the same name/path, e.g. `__visitor=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/` in a server response.
4. Respect the application's opt-out on future visits. Recreating the client after withdrawal can collect a new observation and issue a new ID. This library intentionally does not maintain an opt-out account or another persistent tracking identifier.

The server's opaque visitor cookie can help locate records for erasure while present, but a visitor ID is not proof of account ownership. An application may need its own authorized mechanism to erase records when the cookie is already gone or several IDs were issued. No global reverse identity search or public deletion route is provided. Applications should coordinate erasure with concurrent requests to avoid fresh collection during deletion.

## Disclosure and control

Describe why browser recognition is used, which signal categories are collected, how cookie-loss restoration works, whether an evaluator receives compact data, how long data is kept, and how to withdraw/erase. Obtain any required opt-in before creating the client. Do not treat cookie removal as permission to resume tracking. Respect browser protections and user choices at the application integration point.

Risk scores do not establish that a person is a bot, malicious, or identifiable. Privacy-focused browsers, missing APIs and lack of mouse activity are explicitly not sufficient evidence for high risk. Evaluator failure defaults to zero risk. The consuming application owns CAPTCHA/access policy and should assess false positives before acting on these experimental scores.

## Optional verified cross-device labels

An HMAC is a hash computed with a secret key. It lets Janitor derive a stable label without storing the original value; the resulting label is still linkable data, not anonymous data.

When an application explicitly enables `subjectLinking` and passes a verified `authenticatedSubject` to the server handler, it returns an application-scoped HMAC `subjectId`. The account identifier is received only from the application's trusted server code. It is not collected from the browser, read from request headers/body, placed in cookies, stored in Janitor's database, sent to the evaluator, or logged. The subject label is returned only on requests where the application supplies verified identity. Anonymous requests never retrieve an old account association from a browser cookie.

The label is deterministic for a given account, namespace and secret. The `subjectLinking` option alone stores no account-to-browser graph. If your application saves relationships, or enables the separate evidence storage described below, include those records in disclosure and erasure. Rotating the secret/namespace changes all derived labels; using an account-specific generation identifier lets your authentication system retire one account's prior label. Signing into the same account establishes an account link, not proof that the same physical person operates every session.

## Optional identity directory

With the `identity` option, the application supplies server-verified subject and actor references. Janitor stores opaque subject IDs, person/agent kind, and update time. Verified email, external-ID and public-key-reference associations are stored as application-scoped HMAC digests with type, issuer, and registration time. Raw alias values, private keys and API secrets are not stored. These digests are pseudonymous identity data, not anonymous data; protect the database and HMAC secret.

The application verifies email/key ownership and authorizes every association or grant change. Grants store account and actor references, audience, exact scopes, expiry, and revocation time. None of these directory fields are sent to Jev or captured by the browser collector. The private server result includes opaque references and attribution. They are included in browser JSON only if the application explicitly enables score and attribution disclosure.

`identities.removeKey` erases an association. `identities.deleteSubject` cascades to its keys and all grants involving it; erase browser observations separately with `deleteVisitor`. Subjects/keys are retained until explicit removal, so tie deletion to your account/credential lifecycle. `cleanup()` deletes expired grants; active/revoked grants remain until expiry or subject erasure. Also remove application-side logs, cached links and backups under your retention policy. Identity-label secrets and namespace rotation require a planned data migration.

## Optional login feedback and shadow experiments

Learning is disabled by default. The implementer enables `learning: { enabled: true }` and chooses `collectionPolicy: "application"` (no per-session flag) or the default `"per-request"` (server-side `learningConsent: true`). Explicit false overrides either policy. Janitor supplies no consent UI; collection policy is the implementer’s choice and responsibility. Identity and account updates remain usable with learning disabled. It uses a separate, fixed-lifetime HttpOnly `__visitor_learning` cookie (30 minutes by default). One latest anonymous normalized browser/aggregate-behavior snapshot is retained per flow, with timestamps and an opaque session ID. A later verified self-person login can label the pre-login snapshot with an opaque subject ID. No raw email, URL journey, coordinates or keystrokes are added. Known conflicting-account flows and delegated actors are excluded.

Default retention is 30 days, bounded to 20 verified sessions per subject and 100 records per report/predictor input. Unlabeled expired flows are deleted by `cleanup()`. Reports exclude disputed and expired retained labels. Collection mode makes no extra AI calls. With learning enabled and Jev configured, the built-in shadow predictor sends compact observations from up to three verified sessions per candidate person (ten people maximum) to your chosen Jev provider. Persistent subject/session IDs are replaced with request-local indexes. No custom predictor is required. A custom shadow predictor can instead receive the bounded verified cohort; its predictions and scores stay in the implementer's database, do not become training labels, and are never returned to anonymous browsers. Any external model processing is controlled by the implementer and needs its own disclosure and data minimization. Jev is not automatically retrained.

Each implementer stores this data on its own server/database; Holy Coders receives none. Authorize exports and deletion as account operations. `learning.deleteSession(id)` erases one flow, and `identities.deleteSubject(id)` cascades through examples labeled with or predicting that subject. Withdrawing per-request permission erases the current cookie's row and clears its cookie, but does not erase earlier completed sessions. Turning configuration off stops collection, not historical retention: erase the data or maintain cleanup separately. No trained external model can be untrained by deleting these rows. See the [learning guide](docs/LEARNING.md) for limits and the complete lifecycle.

## Optional analytics and signed results

Server analytics bridges export only browser ID, continuity, risk status/scores, optional server-authorized account/workspace ID, opaque verified subject/actor IDs, verification basis, schema version and actor/delegation categories through explicitly configured PostHog, Mixpanel or Segment integrations. Profile updates separately export only name, email and plan explicitly passed by the implementer with the authenticated actor's stable analytics ID. These are intentional third-party transfers to the implementer's chosen analytics provider, not a shared Janitor identity graph. No full fingerprint or shadow prediction is exported. The optional browser lifecycle helper uses existing initialized SDKs to identify an authenticated user, update explicitly supplied name/email/plan traits, emit a Mixpanel identity-transition event, and reset on logout/user changes. It never receives private scores or observation payloads and does not initialize providers, enable replay, or manage consent. Analytics events describe observed associations, not authoritative membership; a shared browser does not merge people.

Encrypted result receipts contain compact browser/risk results, operation ID, action category, audience, expiry and nonce. They omit observations, debug payloads, identity keys and raw account IDs. Current receipts use authenticated JWE encryption; older readable signed receipts are rejected. Keep all receipts out of URLs and logs. Learning exports are sensitive pseudonymous datasets: manage their retention/deletion lineage wherever copied, including outside Janitor.

## Optional protection and application evidence

Optional database-backed protection limits measurement requests and evaluator work. Request counters contain application-scoped HMAC keys for the global budget and any server-supplied account/session, counts and window expiry. Evaluator control records contain call counts, circuit state and short-lived random leases, without observations or account identifiers. Cleanup deletes up to 100 expired rows from each table per call. These controls do not read raw IPs or client identity headers.

Optional trusted request context can contain an authentication method/time, an allowlisted action, and Cloudflare's available bot score, verified-bot and signed-agent flags with observation time. It is returned privately by `assess()` or Phoenix assigns, never in browser JSON, even when public scores are enabled. Janitor does not persist this envelope or send it to Jev. Applications decide whether to retain it. The Cloudflare helper only reads the original Worker's available metadata; it does not collect IP addresses, location, JA3/JA4 or forwarded headers.

With `evidence` enabled, server management APIs can record nine narrow login, verification, recovery and sensitive-action event categories. Records contain server ingestion time, optional action category, opaque subject/actor/visitor references and HMAC event/session references. They accept no arbitrary properties, URLs, form values or credentials. Default event retention is seven days, configurable from 1–30. Activity summaries count retained events for one account/session/actor and a bounded time window; erasing an event immediately removes it from later summaries.

Explicit verified device associations store opaque subject/visitor IDs, the verification method, verifier name, HMAC proof reference, verification/creation/expiry times and optional revocation reason/time/verifier/HMAC reference. Verifier names should identify the authentication system, not a person or email. Associations expire within 90 days. Revoked/expired records remain for a configurable 1–365 days (default 90) for audit, then cleanup removes up to 100 per call. They are historical associations, not physical-device authentication or automatic anonymous account links. No added field is sent to Jev or analytics automatically.

Use `evidence.deleteSession` / `Janitor.Evidence.delete_session` for session events and `deleteSubjectEvents` / `delete_subject_events` for events involving a subject as principal or actor. Existing subject/visitor erasure cascades related events and device links. Evidence cleanup respects the application's namespace and retention. HMAC references remain linkable personal data; include them, backups and any separate application exports in disclosure/erasure. Disabling collection does not erase old records. See [the guide](docs/HARDENING.md) for configuration and bounded maintenance. These options are available in v0.7.0.

## Score disclosure

HTTP responses omit risk, confidence, account attribution and diagnostics by default. These stay on the implementer's server. Applications can explicitly expose the full result, and should document that choice. Optional result receipts encrypt evidence rather than exposing readable JWT claims. Analytics containing private risk scores should be sent server-to-server. See [security configuration](docs/SECURITY.md).
