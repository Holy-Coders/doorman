# Testing and limitations

Implementation tests answer whether Doorman behaves as documented. They do not establish how accurately a model recognizes a person, an assistant or an attacker on your traffic.

## What the released integration was checked against

The 0.13.0 release record includes 432 TypeScript tests, 76 native Elixir tests, two Phoenix endpoint tests, three browser/analytics integration tests and 17 public-site checks. These are dated release results; see [CI](https://github.com/Holy-Coders/doorman/actions) for the current revision.

Clean npm and Hex consumers exercised automatic table setup, authenticated and remembered context, private browser responses and user deletion against Postgres 17. SQL contract tests also use local D1 and embedded Postgres. External responses are mocked or intercepted in the regular suite; tests do not send fabricated users into your analytics project or make paid model calls.

Analytics SDK acceptance does not prove ingestion, profile merging or dashboard counts in your project. Validate anonymous visit → login → second device → logout → different user in a development project.

## What remains experimental

| Capability                    | What is established                                                 | What is not established                                                  |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Cookie continuity             | A retained visitor cookie refers to a stored browser record.        | Which person or agent currently operates it.                             |
| Remembered login context      | Your server previously authenticated an identity with that browser. | Current authentication or permission.                                    |
| Missing-cookie similarity     | Bounded comparison can find plausible historical browsers.          | Unique browser identity; similar devices can collide.                    |
| Cross-device suggestions      | Confirmed login history can be compared through Jev.                | Calibrated probabilities that anonymous visits belong to one person.     |
| Human/assistant/script scores | Typed private assessments, evidence gates and unavailable states.   | Reliable agent brands, physical-human counts or universal bot detection. |
| Suspicious activity           | Request denials and related activity can contribute evidence.       | Proof that a particular individual is malicious.                         |

The recommended API gives a new ID when the cookie is missing and keeps possible matches private. It does not silently restore a guessed account or merge analytics profiles.

## What earlier experiments found

Recorded public-data and live Jev experiments exposed false matches and weak discrimination. An 80-session human/agent panel had AUC 0.504, with every operator label remaining unknown. Synthetic linked denials increased suspicion, but some sparse retry scenarios also received elevated scores.

Historical browser-recovery experiments used a lower-level API that could restore guessed IDs. Their false-restoration rates are not measurements of the current private-suggestion flow. They remain useful evidence that browser similarity is fallible.

The large-database and connection experiments measured different workloads. Millions of stored observations and 200,000 open connections do not establish that many successful concurrent identifications or AI calls. See [deployment and scale](SCALING.md).

The [research archive](archive/README.md) preserves dated methods, datasets and raw results. It is contributor evidence, not an installation checklist. Normal use needs no training jobs, model promotion, telemetry contribution or learning-network service.

## Evaluate on your application

Use independent truth such as authenticated logins, controlled agent runs and reviewed incidents. Keep later visits and new users/environments separate from examples used to choose thresholds. Include privacy browsers, accessibility tools, keyboard/touch-only users, remote desktops, ordinary retries and authorized assistants.

Measure false links, missed links, false risk alerts, unknown/unavailable rates, latency and cost. Count verified actors separately from inferred labels. Do not use Doorman's own prediction as the label proving that prediction correct.

Start with observation and reporting. Your application owns any additional verification policy. No universal score threshold has been validated for blocking users.

## Run implementation checks

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

Native Elixir checks need the local Postgres test configuration. Each example documents its own startup. Full research benchmarks are separate, opt-in developer tools; they are not needed to deploy Doorman.
