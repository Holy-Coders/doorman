# Privacy and data inventory

Janitor is first-party browser recognition software. A stable opaque ID links a small history of browser observations within one application's database. If a cookie disappears, retained observations can be used to infer continuity. This behavior must be disclosed; deleting a cookie alone is not erasure of stored history.

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

The browser client counts events from creation until `destroy()`:

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

Extended mode reads movement deltas, wheel deltas and a monotonic clock. It retains only running totals and the immediately preceding delta/time in transient memory. Visibility/focus gaps reset timing continuity. Absolute pointer coordinates, key values, event targets, text and form data are never read. No raw events, timestamps, movement paths or event sequences are sent or stored. Extended mode is opt-in so applications can disclose the additional processing before starting collection. These are uncalibrated risk inputs, never identity-matching features. Creation adds passive listeners; `destroy()` removes them and aborts in-flight identification. Call it on unmount or opt-out. Creating a tracker is separate from sending an observation; the example button controls sending, while counts accumulate while the example is open.

## What is never collected by the library

No raw IP addresses, geolocation, actual keystrokes, passwords, text inputs, form values, absolute mouse coordinates, camera, microphone, browsing history, referrer, URL history or third-party tracking identifiers are collected from the browser. The current application origin is used locally to enforce same-origin delivery, not stored as a fingerprint feature. The library does not read IP-related request headers. Network infrastructure naturally receives connection metadata; configure hosting/access logs separately because they are outside this library's control.

There are no third-party browser scripts, beacons, cross-origin endpoints, hidden storage caches, localStorage/IndexedDB identity copies, evercookies, or attempts to recover values hidden by browser protections. All collection uses ordinary browser APIs.

## Stored data and sharing

`visitors` stores an opaque ID and creation/last-seen timestamps. `observations` stores normalized JSON (including the optional aggregate behavior), a timestamp, visitor link, and coarse indexed fields: platform, browser family, timezone and WebGL renderer. The ID contains 192 random bits and encodes no browser information.

When an evaluator is enabled, compact observations (up to five history entries plus current data and similarity evidence) are sent server-to-server to TypeSafe, or through Cloudflare Workers AI. The compact payload excludes raw user agent, visitor ID, cookie, IP address and application URL. Platform/browser, language/timezone, display/hardware/graphics values, webdriver and enabled aggregate behavior summaries are included. This is still browser-environment data: disclose the evaluator providers and review their handling terms for your application. Deterministic-only mode does not send data to an evaluator.

Responses contain ID, continuity confidence and risk. Debug responses additionally expose collected signals only with explicit client/server opt-in and a non-production server environment. Do not log debug output. Optional metrics contain counts, scores, evaluator usage/latency and returning status only; no fingerprints are logged by default.

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

When an application explicitly enables `subjectLinking` and passes a verified `authenticatedSubject` to the server handler, it returns an application-scoped HMAC `subjectId`. The account identifier is received only from the application's trusted server code. It is not collected from the browser, read from request headers/body, placed in cookies, stored in Janitor's database, sent to the evaluator, or logged. The subject label is returned only on requests where the application supplies verified identity. Anonymous requests never retrieve an old account association from a browser cookie.

The label is deterministic for a given account, namespace and secret. Janitor stores no account-to-browser graph. If your application saves the returned labels or relationships, include those records in its own disclosure and erasure process. Rotating the secret/namespace changes all derived labels; using an account-specific generation identifier lets your authentication system retire one account's prior label. Signing into the same account establishes an account link, not proof that the same physical person operates every session.

## Optional identity directory

With the `identity` option, the application supplies server-verified subject and actor references. Janitor stores opaque subject IDs, person/agent kind, and update time. Verified email, external-ID and public-key-reference associations are stored as application-scoped HMAC digests with type, issuer, and registration time. Raw alias values, private keys and API secrets are not stored. These digests are pseudonymous identity data, not anonymous data; protect the database and HMAC secret.

The application verifies email/key ownership and authorizes every association or grant change. Grants store account and actor references, audience, exact scopes, expiry, and revocation time. None of these directory fields are sent to Jev or captured by the browser collector. The optional response exposes opaque references and attribution to the same-origin application; authorize that endpoint appropriately.

`identities.removeKey` erases an association. `identities.deleteSubject` cascades to its keys and all grants involving it; erase browser observations separately with `deleteVisitor`. Subjects/keys are retained until explicit removal, so tie deletion to your account/credential lifecycle. `cleanup()` deletes expired grants; active/revoked grants remain until expiry or subject erasure. Also remove application-side logs, cached links and backups under your retention policy. Identity-label secrets and namespace rotation require a planned data migration.

## Optional login feedback and shadow experiments

Learning is disabled by default. Both `learning: { enabled: true }` and server-side `learningConsent: true` are required. It uses a separate, fixed-lifetime HttpOnly `__visitor_learning` cookie (30 minutes by default). One latest anonymous normalized browser/aggregate-behavior snapshot is retained per flow, with timestamps and an opaque session ID. A later verified self-person login can label the pre-login snapshot with an opaque subject ID. No raw email, URL journey, coordinates or keystrokes are added. Known conflicting-account flows and delegated actors are excluded.

Default retention is 30 days, bounded to 20 verified sessions per subject and 100 records per report/predictor input. Unlabeled expired flows are deleted by `cleanup()`. Reports exclude disputed and expired retained labels. Collection mode makes no extra AI calls. An explicitly configured shadow predictor can receive verified examples; its predictions and scores stay in the implementer's database, do not become training labels, and are never returned to anonymous browsers. Any external model processing is controlled by the implementer and needs its own disclosure and data minimization. Jev is not automatically retrained.

Each implementer stores this data on its own server/database; Holy Coders receives none. Authorize exports and deletion as account operations. `learning.deleteSession(id)` erases one flow, and `identities.deleteSubject(id)` cascades through examples labeled with or predicting that subject. Withdrawing per-request permission erases the current cookie's row and clears its cookie, but does not erase earlier completed sessions. Turning configuration off stops collection, not historical retention: erase the data or maintain cleanup separately. No trained external model can be untrained by deleting these rows. See the [learning guide](docs/LEARNING.md) for limits and the complete lifecycle.
