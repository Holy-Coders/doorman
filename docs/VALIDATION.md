# Testing and limitations

Janitor’s tests check whether the implementation behaves as documented: matching, cookies, database queries, failure handling and the privacy boundary between browser and server. They do not tell us how accurately Jev detects bots or how often browser recovery will be correct on your traffic.

## What is verified

The v0.7.0 release passed these checks on September 23, 2026:

| Area | Evidence |
| --- | --- |
| TypeScript library | 204 tests across twelve files, plus strict typechecking and lint. |
| Native Elixir | 51 tests against Postgres, plus a Phoenix endpoint test. |
| Browser integration | Two Chromium tests, including real PostHog and Mixpanel browser SDKs with analytics traffic intercepted locally. |
| Public site | Browser tests cover matching demos, navigation, copy controls, mobile layout and motion fallbacks. |
| Examples | Next.js production build, Cloudflare dry-run build and native Phoenix migrations pass. |
| Installation | All seven JavaScript archives install in isolated npm, pnpm and Bun projects. The Elixir package builds as a Hex-format archive. |

The database contract tests execute real SQL using embedded Postgres (PGlite) and Cloudflare’s local D1 runtime (Miniflare). Core matching is not mocked. External Jev and analytics responses are mocked or intercepted so automated tests do not make paid inference calls or send test users to analytics projects.

The September 23 website and documentation refresh also passed 13 browser tests, including the introductory reading path and internal links across all documentation pages. The static build produces 31 HTML pages.

See the [latest CI runs](https://github.com/Holy-Coders/janitor/actions) and [detailed dated records](VALIDATION-HISTORY.md) for exact commands, environments and historical counts.

## What the benchmarks show

The benchmarks answer different questions. Keep their results separate:

| Benchmark | What it tests | What it does not establish |
| --- | --- | --- |
| [Controlled browser visits](BENCHMARKS.md) | Browser signals and recovery after controlled changes. | Accuracy across a representative real-user population. |
| [Millions of stored observations](SCALING.md) | Indexed candidate lookup and history-read latency. | Sustained production throughput or correct person identity. |
| [Connection and workload tests](CAPACITY.md) | Open connections, successful responses, overload and recovery. | 200,000 simultaneous successful identifications or real Jev capacity. |

The browser experiment includes a false match between indistinguishable profiles. The connection experiment includes controlled `503` overload responses. Those are part of the findings, not successes hidden inside headline counts.

## What still needs real-world testing

Before using a score to trigger extra verification, test with independently labeled traffic from your application. Include ordinary browser updates, common identical device profiles, privacy browsers, accessibility tools, touch-only users, authorized agents and actual automation.

Measure at least:

- **False matches:** distinct browsers incorrectly assigned the same ID.
- **Missed matches:** a returning browser assigned a new ID.
- **False risk alerts:** ordinary activity flagged by your chosen threshold.
- **Abstention and availability:** how often Janitor cannot make a useful match or risk assessment.
- **Latency and cost:** the complete request path, including your database and actual AI provider.

Compare built-in matching with AI-assisted matching on the same held-out visits. Do not use Janitor’s own guessed IDs as the truth labels. Anonymous cross-device prediction needs a separate evaluation; see [testing a learning model](EVALUATION.md).

## Run the checks yourself

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm exec playwright install chromium
pnpm test:e2e
pnpm site:check
pnpm site:test
```

The [Elixir guide](../packages/elixir/README.md) explains its Postgres test setup. Each framework example has its own build and run instructions.

## What is published

The public source, documentation site and [v0.7.0 GitHub archives](https://github.com/Holy-Coders/janitor/releases/tag/v0.7.0) are available. npm publication requires release-account verification, and Hex publication requires an authenticated account; neither registry is claimed as published. Use the [documented GitHub installation paths](LANGUAGES.md).

Installing the library does not create a hosted identity endpoint or configure your analytics project. Those run in your application. Live provider ingestion, real-user risk calibration and your production capacity need verification in that environment.
