# Changelog

## 0.13.0 — One identity context

- Added `createDoorman` for Node, Vercel and Cloudflare, plus the equivalent native Phoenix configuration. One server-owned authentication object records browser/user/account/actor associations.
- Added authenticated, remembered, inferred, ambiguous and unknown private context. The recommended flow keeps missing-cookie matches as suggestions and creates a fresh browser ID. Cross-device learning remains explicitly enabled and never merges analytics identities.
- Extended the browser client with an optional collection profile, session/account context and supported PostHog/Mixpanel super-properties. Existing SDK events inherit safe context; logout and account switches clear it.
- Added optional bounded AbuseIPDB checks with shared database quotas, caching and no raw IP persistence or model disclosure. Server-owned risk evidence is excluded from identity questions.
- Added optional human/assistant/script questions to the existing Jev risk call, with sparse-evidence abstention. These are uncalibrated estimates, not validated person counts or agent-brand detection.
- Added migration `0010_browser_associations.sql`, retention/erasure, updated examples and a unified integration guide. Existing lower-level APIs remain available.

Upgrade: apply the new migration before using the unified context constructor. Phoenix applications use `Doorman.Migration.upgrade_context()` in an Ecto migration. No live accuracy or capacity improvement is claimed by this release.

## 0.12.0 — 2026-09-24

- Rename the product to Doorman. JavaScript packages use `@aarondovturkel/doorman-*`; the Hex package is `doorman_identity` and its modules are `Doorman.*`.
- Add `createDoormanClient` for the unified browser and analytics lifecycle. Update examples, protocol field names, analytics properties and SDK imports to the new name.
- Separate Jev identity evidence from automation/risk evidence and account for the two provider calls in shared budgets.
- Add bounded Node HTTP admission before request-body allocation and verify recovery from 200,000-connection bursts. Most burst requests receive controlled overload responses.
- Include adjustable scoring, aggregate detection signals, operator attribution and opt-in classifier experiments. Public-data results continue to show accuracy limitations; the rename does not establish new detection accuracy.
- Publish all eight JavaScript packages to npm and the native Elixir package with HexDocs to Hex. Verify fresh registry installs.
- Redesign the public website with cream and black surfaces, a selectable pixel-doorway animation, new light/dark Doorman logos and updated documentation.

### Operator attribution pilot

- Add private activity-window labels and bounded account-scoped operator comparisons to the TypeScript adapters, backed by D1/Postgres migration 0009.
- Add shared Jev/Workers AI operator questions, immutable evaluation caching, existing shared budgets, unknown/failure states and account/session/browser erasure.
- Add controlled-run family reference fitting, holdout exclusion, reference expiry and explicit uncalibrated score semantics.
- Export separate window, summary and inferred-profile events through the existing analytics bridges and warehouse projection; preserve authenticated analytics identities.
- Retain aggregate observation duration and mouse/interaction sample counts for better evidence-volume context.
- Document incomplete comparisons, report limits and the runtime/interaction detection research backlog. No detector from that backlog is enabled.

## 0.7.0 — 2026-09-23

- Coordinate PostHog and Mixpanel anonymous-to-authenticated transitions, profile
  updates, user switches and logout with `createIdentityAnalytics`. Verified users,
  delegated agents, browser environments and account context remain distinct.
- Export private account/actor dimensions from TypeScript and native Elixir,
  including browserless agents. Add reporting recipes for shared accounts and
  multiple verified users associated with a browser.
- Add optional database-shared measurement quotas, evaluator budgets, concurrency
  leases and circuit recovery. Bound per-handler in-flight requests and support
  sharded global allowances.
- Add trusted evidence, idempotent application events, bounded activity counts,
  and verified, expiring, revocable device associations. These do not authenticate
  an operator from browser signals or automatically block anyone.
- Publish reproducible synthetic database and 200,000-connection load measurements,
  including overload responses and limitations. This is not a production SLA or
  a claim of 200,000 simultaneous successful identifications.
- Redesign the public site with a new logo and a native Tesseract hero film,
  consistent documentation styling and accessible playback fallbacks.

Existing SQL installations must apply `0005_protection.sql` and `0006_evidence.sql`
after earlier migrations before enabling the corresponding features. Native Elixir
applications use `Doorman.Migration.upgrade_security()` in an application-owned Ecto
migration. See [the upgrade guide](docs/HARDENING.md).

Install the JavaScript archives or the native Elixir Git dependency from the
[v0.7.0 GitHub release](https://github.com/Holy-Coders/doorman/releases/tag/v0.7.0).
npm registry publishing requires authenticator verification (`EOTP`); Hex registry
publishing requires account authentication. The attached Hex-format archive is
not a Hex registry publication. See [installation options](docs/LANGUAGES.md).
