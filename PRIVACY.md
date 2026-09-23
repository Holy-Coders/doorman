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

Only totals are sent on `identify()`. Event objects and contents are not inspected or retained. There are no per-event timestamps, coordinates, sequences, key values, or movement paths. Creation adds passive listeners; `destroy()` removes them and aborts in-flight identification. Call it on unmount or opt-out. Creating a tracker is separate from sending an observation; the example button controls sending, while counts accumulate while the example is open.

## What is never collected by the library

No raw IP addresses, geolocation, actual keystrokes, passwords, text inputs, form values, mouse coordinates, camera, microphone, browsing history, referrer, URL history, account identifiers or third-party tracking identifiers. The current application origin is used locally to enforce same-origin delivery, not stored as a fingerprint feature. The library does not read IP-related request headers. Network infrastructure naturally receives connection metadata; configure hosting/access logs separately because they are outside this library's control.

There are no third-party browser scripts, beacons, cross-origin endpoints, hidden storage caches, localStorage/IndexedDB identity copies, evercookies, or attempts to recover values hidden by browser protections. All collection uses ordinary browser APIs.

## Stored data and sharing

`visitors` stores an opaque ID and creation/last-seen timestamps. `observations` stores normalized JSON (including the optional aggregate behavior), a timestamp, visitor link, and coarse indexed fields: platform, browser family, timezone and WebGL renderer. The ID contains 192 random bits and encodes no browser information.

When an evaluator is enabled, compact observations (up to five history entries plus current data and similarity evidence) are sent server-to-server to TypeSafe, or through Cloudflare Workers AI. The compact payload excludes raw user agent, visitor ID, cookie, IP address and application URL. Platform/browser, language/timezone, display/hardware/graphics values, webdriver and aggregate counts are included. This is still browser-environment data: disclose the evaluator providers and review their handling terms for your application. Deterministic-only mode does not send data to an evaluator.

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
