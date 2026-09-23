# Changelog

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
applications use `Janitor.Migration.upgrade_security()` in an application-owned Ecto
migration. See [the upgrade guide](docs/HARDENING.md).

Install the JavaScript archives or the native Elixir Git dependency from the
[v0.7.0 GitHub release](https://github.com/Holy-Coders/janitor/releases/tag/v0.7.0).
npm registry publishing requires authenticator verification (`EOTP`); Hex registry
publishing requires account authentication. The attached Hex-format archive is
not a Hex registry publication. See [installation options](docs/LANGUAGES.md).
