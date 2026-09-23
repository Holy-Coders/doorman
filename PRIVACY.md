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

There is no canvas-derived hash. A temporary canvas is used only to request an ordinary WebGL context. No image is rendered or read back. The unmasking/debug-renderer extension is never requested. The context is released if the standard context-loss extension is available. No attempt is made to defeat anti-fingerprinting, infer intentionally hidden hardware values, or access persistent storage beyond the server-set cookie.

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

Extended mode reads movement deltas, wheel deltas and a monotonic clock. It retains only running totals and the immediately preceding delta/time in transient memory. Visibility/focus gaps reset timing continuity. In this mode, absolute pointer coordinates, key values, event targets, text and form data are never read. No raw events, timestamps, movement paths or event sequences are sent or stored. Extended mode is opt-in so applications can disclose the additional processing before starting collection. These are uncalibrated risk inputs, never browser-identity matching features. If you also enable learning, Jev may consider their aggregates as weak supporting evidence for private cross-device suggestions. Creation adds passive listeners; `destroy()` removes them and aborts in-flight identification. Call it on unmount or opt-out. Creating a tracker is separate from sending an observation; the example button controls sending, while counts accumulate while the example is open.

Extended mode also counts valid movement samples, steps of at least 100 pixels, active movement intervals below one second, press intervals below 100ms, comparable adjacent intervals and intervals that differ by at most 10ms. It stores movement interval mean/standard deviation. These permit rounded mean-step, large-step, movement-variation, short-gap and repeated-gap features for optional classification. Held-key repeat events are excluded from timing; focus/visibility breaks reset the preceding-event state. Only the immediately preceding delta/time and running totals are held locally, not a movement or typing trail. These patterns are not proof of automation or screenshot capture.

When explicitly passed to the feature extractor, the existing webdriver observation can enter private operator/learning evidence as a numeric 0/1 value. No extra browser API is queried. Operator thresholds and report policy identifiers may be stored and exported for reproducibility; they contain configuration, not event content.

## What is never collected by the library

No raw IP addresses, geolocation, actual keystrokes, passwords, text inputs, form values, stored mouse coordinates, camera, microphone, browsing history, referrer, URL history or third-party tracking identifiers are collected from the browser. The current application origin is used locally to enforce same-origin delivery, not stored as a fingerprint feature. The library does not read IP-related request headers. Network infrastructure naturally receives connection metadata; configure hosting/access logs separately because they are outside this library's control.

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

Optional trusted request context can contain an authentication method/time, an allowlisted action, and Cloudflare's available bot score, verified-bot and signed-agent flags with observation time. It is returned privately by `assess()` or Phoenix assigns, never in browser JSON, even when public scores are enabled. Janitor does not persist this envelope or send it to Jev. Applications decide whether to retain it. The Cloudflare helper only reads the original Worker's available metadata; it does not collect IP addresses, location, JA3 or forwarded headers. The explicit `{ transport: true }` option adds an available, validated JA4 transport fingerprint to this private envelope. It does not change matching or send it to Jev.

With `evidence` enabled, server management APIs can record nine narrow login, verification, recovery and sensitive-action event categories. Records contain server ingestion time, optional action category, opaque subject/actor/visitor references and HMAC event/session references. They accept no arbitrary properties, URLs, form values or credentials. Default event retention is seven days, configurable from 1–30. Activity summaries count retained events for one account/session/actor and a bounded time window; erasing an event immediately removes it from later summaries.

Explicit verified device associations store opaque subject/visitor IDs, the verification method, verifier name, HMAC proof reference, verification/creation/expiry times and optional revocation reason/time/verifier/HMAC reference. Verifier names should identify the authentication system, not a person or email. Associations expire within 90 days. Revoked/expired records remain for a configurable 1–365 days (default 90) for audit, then cleanup removes up to 100 per call. They are historical associations, not physical-device authentication or automatic anonymous account links. No added field is sent to Jev or analytics automatically.

Use `evidence.deleteSession` / `Janitor.Evidence.delete_session` for session events and `deleteSubjectEvents` / `delete_subject_events` for events involving a subject as principal or actor. Existing subject/visitor erasure cascades related events and device links. Evidence cleanup respects the application's namespace and retention. HMAC references remain linkable personal data; include them, backups and any separate application exports in disclosure/erasure. Disabling collection does not erase old records. See [the guide](docs/HARDENING.md) for configuration and bounded maintenance. These options are available in v0.7.0.

## Optional API activity

When an implementer explicitly configures `activity`, server middleware can aggregate selected API operations for an application-issued session or authenticated actor. It stores an application-scoped HMAC key, a configured route template, window start and expiry, request/401–403/4xx/5xx counts, total/max handler duration, first/last completion times and the number of same-route completion gaps below 100ms. No body, header, credential, raw ID, raw IP, query value or actual resource URL is read by this middleware. Route templates must be static application configuration. There is no browser network interception or cross-application tracking.

The default counter window is one minute and retention is one day, configurable from 1–30 days. Only up to 128 rows from the latest five windows are loaded for an assessment. With Jev enabled, that compact summary, configured route/sensitivity and optional verified actor kind/delegation status go to the evaluator. HMAC keys and underlying account/session IDs do not. This transfer is separate from browser observation and cross-device learning. Shared evaluation leases and a one-minute default cache limit repeated calls; cached records contain the private assessment and compact summary.

Existing cleanup removes up to 100 expired rows from each new table per call. Stop collection and coordinate in-flight requests, then use `activity.deleteKey` / `Janitor.Activity.delete_key` to erase counters and caches for an actor or session. Browser/subject deletion does not automatically find these separately derived keys; applications must include them in account/session erasure. Disabling collection does not delete existing rows. These pseudonymous records remain linkable data; disclose collection, provider transfers, retention and erasure, and apply the application's collection policy before supplying middleware context.

The explicit server analytics bridge can additionally export API risk status, evaluated scores, evaluation/expiry times, cache and truncation flags, window size and request totals. It excludes route history and does not export API activity automatically. Nothing is added to browser responses, even if browser-score disclosure is enabled. See [API activity](docs/API-ACTIVITY.md) for configuration and operational limits.

## Score disclosure

HTTP responses omit risk, confidence, account attribution and diagnostics by default. These stay on the implementer's server. Applications can explicitly expose the full result, and should document that choice. Optional result receipts encrypt evidence rather than exposing readable JWT claims. Analytics containing private risk scores should be sent server-to-server. See [security configuration](docs/SECURITY.md).

## New integrations and local preferences

Amplitude and RudderStack receive only the explicit analytics fields described above, when the implementer connects them. Portable warehouse rows have the same allowlisted identity/risk summaries plus an application-owned actor ID, event ID and timestamp. These identifiers are pseudonymous, not anonymous; apply deletion, access and retention policies in downstream warehouses too. These integrations send no telemetry to a central Janitor service. The separate optional learning network described below requires its own explicit configuration.

Python and Go clients forward browser measurement payloads and that request's cookie/origin context only to the implementer's fixed, application-owned Janitor endpoint. They have no shared cookie jar, do not log payloads, and project only the public identity response. Website theme and documentation-language preferences are stored locally and are not analytics events.

## Optional shared learning service

`@janitor/network` is an independent, server-side integration. Its three controls are remote evaluation, contribution, and training eligibility. All participant preferences start disabled. The contribution client additionally requires local enablement and an application-specific reference secret. Its default sampling rate is 1%; the implementer can change it. Operator approval is also required before a participant can enable training. Existing browser/identity/analytics integrations and the public site do not enable this service automatically.

The exact allowlisted feature schema contains request count, denied/error ratios, rounded mean handler duration, short-gap fraction, seven configured operation-category shares, 49 category-transition frequencies, a repeated-transition ratio, rounded request-arrival mean/variability, and optional rounded mouse speed/turn/pause ratios and interaction interval mean/variability. Raw route names, full device fingerprints, IPs, emails, keys, bodies, URLs, coordinates and keystrokes are excluded. The optional server sequence tracker retains bounded counters plus the preceding category/time for one session, never an event trail. It stops accepting events after 256 observations. Missing APIs remain unknown; values are not reconstructed.

Contribution stores a random participant ID, an immutable sample ID, a daily rotating HMAC session reference, minute-rounded observation time, optional evaluation cohort, numeric features, training eligibility and expiry. Feedback adds a target/outcome, a narrow provenance category, an HMAC evidence reference and server confirmation time. Cohort tags should come from independently known evaluation context, not guesses about disability or privacy practices. A hashed reference or behavioral summary is not guaranteed anonymous.

Default contributed-data retention is 30 days, configurable to 1–30 days per participant. `erase(sampleId)` removes one snapshot and its labels; `erase()` removes all contributions for that participant. Stopping contribution through server preferences deletes its stored samples and labels. Disabling only training removes existing samples' eligibility irreversibly; re-enabling applies to new contributions. Stop sending and coordinate in-flight work before opt-out. Retain the sample-ID mapping locally to honor account/session deletion. Cleanup is bounded; applications/operators must run it often enough for their volume and apply separate backup/export deletion policies.

The pilot conservatively invalidates model revisions after contributed training data is erased, training is revoked or labels conflict. Models expire within seven days or before source evidence expires. They retain rule predicates, aggregate evaluation statistics and a dataset digest, without the original samples. Rebuild after revocation. This is not a promise to untrain separately exported or external models.

Evaluation-only requests do not enter the contribution dataset. A short-lived, tenant-scoped hash cache stores the private assessment and matched aggregate rules, not the request's feature payload. SQL quotas retain tenant references and counters; cached results normally expire after one minute. When configured, the evaluator sends the allowlisted numeric feature vector and activated aggregate pattern evidence to Jev. The service does not send participant keys, session/evidence references, sample IDs, raw labels or account IDs to Jev. Provider/infrastructure retention is separate from these application tables. Review provider terms and access logs before deployment; the Cloudflare example disables request observability logs by default.

The shared service learns patterns across approved applications without building a cross-customer identity graph. It returns private assessments and never changes permissions, merges accounts, or automatically challenges users. Disclose each enabled data transfer, collection purpose, provider, retention period and withdrawal/deletion path. See [the learning service guide](docs/LEARNING-NETWORK.md).

### Optional classifier training artifacts

Operator-only dataset exports contain the already opted-in numeric features, application/session/evidence pseudonyms, independently supplied outcome provenance, cohort, timestamps and expiry. These are pseudonymous data, not anonymous data. Exports are capped, hashed and sealed; local files are mode 0600 and excluded from Git. Only numeric feature vectors are sent for optional Jev enrichment. Labels, pseudonyms, cohort tags and evidence references are excluded from Jev requests and predictor inputs.

No Jev enrichment, training or promotion runs automatically. The supplied demo uses generated data and simulated features with no external model calls. Real export/enrichment requires approved participation and explicit operator actions. The operator is responsible for lawful use, disclosure, label review and provider terms.

Deleting or withdrawing eligible evidence invalidates centrally stored classifiers and cached predictions through the dataset revision. Models expire within seven days or their earliest source expiry. Operators must also delete affected downloaded exports, caches, budget ledgers and model artifacts; remote erasure cannot remove offline copies. A standalone local predictor enforces expiry but cannot know central revocation. Prefer the authenticated classification service for centrally enforced withdrawal. Keep score/label access on the server and apply appropriate retention to any analytics or audit copies.

### Offline public-data benchmarks

The optional research commands explicitly download third-party datasets into the local, Git-ignored `artifacts/external/` directory. Those source files contain fields Janitor does not collect, including network information, text and absolute cursor positions. The offline importers discard those fields from the projected benchmark data and reduce recordings to existing aggregate features; pseudonymous grouping identifiers remain local. Only aggregate results are published. These downloads do not change browser collection, enroll participants, contribute production training data or call Jev. Treat local research inputs as potentially identifying data, respect their source terms and delete the research directory when it is no longer needed. See [the methodology and source terms](docs/EXTERNAL-BENCHMARKS.md).

The separate `benchmark:jev --live --max-calls 120` command explicitly permits a bounded external inference pilot. Agent cases send five existing numeric behavior features; identity cases send compact current and historical browser observations. Source labels, dataset identifiers, account keys and raw recordings are excluded. The transport sends per-request headers disabling Cloudflare gateway logs and payload logs; provider retention terms remain separate. Request digests, typed responses, token counts and latency remain in a private local cache/ledger. Default cache-only replay cannot make paid requests. These research measurements do not enter the shared learning service or train/promote a production model.

## Optional operator attribution

With `operators` enabled, an implementer can explicitly submit short, closed activity windows containing the documented numeric behavior/API features, observation duration and sample counts. Janitor stores namespace-scoped hashed account/session/browser references, window times, a payload digest, evidence source, model and reference versions, numerical assessments, and candidate-window links in the implementer's D1 or Postgres database. The default retention is 30 days (configurable from 1 to 90). Enabling operators alone adds no collector or page element. The separately configured experimental probes below can supply additional numeric evidence; no screenshot monitor, raw cursor path or keystroke recording is added.

Jev receives a bounded projection of those numeric measurements and optional independently labeled family reference examples. Persistent references and family names stay local. Features can still be identifying and must not be described as guaranteed anonymous. The feature does not contribute data to a Janitor-operated learning service. Reference fitting uses only explicitly training-allowed controlled runs, excluding held-out and duplicate runs.

Use `operators.deleteAccount`, `deleteSession` or `deleteBrowser` after stopping collection and in-flight submissions, and `janitor.cleanup()` for expiry. Selective session/browser erasure also clears retained account comparison links and invalidates pending evaluations. Browser-history or identity-directory deletion alone does not erase operator records. Remove exported analytics rows and reference artifacts separately; deleting a source record cannot undo a model trained elsewhere. Analytics exports contain inference scores and report metadata, not the measurement vectors. Their IDs remain separate from authenticated users.

## Explicit experimental probes

All `detection` options default off and are separate from extended behavior. `fonts` tries twelve named local families (Arial, Times New Roman, Courier New, Verdana, Georgia, Trebuchet MS, Helvetica Neue, Menlo, Segoe UI, Consolas, Roboto, Noto Sans) using unattached, local-only `FontFace` loads. Only a version and 12 availability bits are stored in observation JSON. No fonts are downloaded, page font faces added, local-font inventory enumerated, canvas image read or browser restriction bypassed. This small set can still help fingerprint an environment and requires disclosure. The default deterministic font weight is zero; applications can configure it. Jev can receive the set with compact observations. Fonts do not establish person or cross-device ownership.

`pageFonts` counts loaded/loading/failed statuses among at most 100 page faces, without reading their names or URLs. `runtime` checks descriptors for eight fixed automation marker names and an own `navigator.webdriver` property; it neither enumerates all globals nor runs their getters. `permissions` reads Notifications and Permissions API states without requesting permission or registering state-change listeners. Font and permission work has a 250 ms deadline; late results cannot send an identification after pause/reset. Missing or blocked APIs remain unknown.

`targets` transiently reads mouse press coordinates and element rectangles, reduces them immediately to eligible/center/top-left counts and retains neither coordinates, rectangles, elements, selectors nor text. This differs from the ordinary extended mode, which does not read absolute coordinates or targets. `focus` counts captured focus/blur events and inputs while the document lacks focus; it does not observe screenshots. `decoy` explicitly creates a hidden, inert button with no navigation, form submission or other action, counts programmatic activations and removes it on pause/reset/destroy. Counters are capped at one million. No actual keys or form data are read. See [the full contract and experimental controls](docs/EXPERIMENTAL-DETECTION.md).

These additions follow observation retention/deletion and evaluator settings. The numeric feature extractor may project marker/own-webdriver/permission-mismatch flags, supported target ratios, focus summaries and decoy counts into separately opted-in operator or learning requests. Font sets and full fingerprints are not included in that shared numeric feature schema. No new probe is enabled on the public live playground.

## Optional linked API activity

With `activity.correlation` enabled, server code can supply up to three group references with linkage basis and confidence. The correlation helper HMACs up to four bounded application-selected components within the implementer's namespace; it does not read a request body, IP address or raw credential. Never supply passwords or bearer tokens. Session/actor aggregates remain separate. Shared group counters retain configured route, window, status and timing summaries, following activity retention (default one day). Private cached assessments can contain related summaries, confidence and basis, not raw identifiers. Jev receives bounded summaries with overlapping-count and uncertainty instructions, without group IDs or HMAC input components.

Groups are hypotheses, not verified users or analytics identity merges. `deleteCorrelation` erases the whole aggregate group, since individual contributions cannot be subtracted from counters. Also delete affected session/actor keys to erase their cached summaries; otherwise those expire with the assessment cache (default one minute). Stop collection first. [Linked activity](docs/LINKED-ACTIVITY.md) documents the lifecycle. No data is contributed to a Janitor-operated service automatically.
