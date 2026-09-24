# What is Doorman?

Doorman helps your app remember browsers and understand who is using an account. It connects visits to users after your server verifies their login, then adds that context to analytics such as PostHog or Mixpanel.

It runs inside your application, using your Postgres or Cloudflare D1 database. You keep your login system and analytics tools. There is no Doorman account or hosted service to sign up for.

**Start with the [local quickstart](GETTING-STARTED.md).** It needs no AI key. These guides describe the upcoming 0.13 release, available [from source](LANGUAGES.md) while publication finishes.

## What it helps you answer

| Question                                      | What Doorman can tell you                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Has this browser visited before?              | A first-party cookie connects it to its stored browser ID.                                                                                    |
| Which account used this browser before login? | A private record of earlier verified logins, including multiple possible users on a shared browser.                                           |
| Is this the same user on another device?      | A verified login connects the user. Optional matching can suggest a connection before login, with uncertainty.                                |
| Is an assistant using the account?            | Your server can supply a verified agent identity. Optional AI scoring estimates whether activity looks human, assistant-operated or scripted. |
| Can I use this in a funnel?                   | Doorman coordinates analytics identification at login and adds browser, session and account properties to events.                             |

## One account, several people and agents

Alex and Sam share a workspace. Alex uses a phone and a laptop; an assistant uses its own credential. Your app verifies each identity. Doorman keeps those users, browsers and the assistant separate, so four browsers do not become four people in your reports.

If someone returns on Alex's laptop before login, Doorman can remember the earlier relationship. It does not sign them in or identify them to analytics as Alex. If both Alex and Sam used that browser, it reports the uncertainty.

## Three pieces to install

1. **Browser client:** sends a small set of browser signals to your own endpoint.
2. **Server module:** reads cookies, accepts the user your login system verified, and produces a private assessment.
3. **Your database:** holds browser history and verified relationships. Doorman sets up its tables automatically.

The browser receives only a browser ID, a session ID and a returning-visit flag. Scores and possible user matches stay on your server. [See the complete setup](IDENTITY-CONTEXT.md).

## Add scoring when you need it

Jev is an optional AI model from TypeSafe. It compares browser history and evaluates activity. Human, assistant and script labels are separate from suspicious behavior: an authorized assistant can be automated and legitimate.

These are experimental estimates, not proof of who's at the keyboard. Doorman cannot reliably count people sharing one password or name an agent's brand from its movements. [Our measured results](EXTERNAL-BENCHMARKS.md) include errors and coverage gaps.

Doorman never automatically blocks a user or displays a CAPTCHA. Your application decides how to use a result. If AI is unavailable, browser identification continues and the result says the risk was not assessed.

## Start small

Run the [quickstart](GETTING-STARTED.md), connect [your login](IDENTITY-CONTEXT.md), then add [analytics](ANALYTICS.md). Extra detection, request monitoring, cross-device learning and model training are optional.

Collection does not capture form values, actual keys, mouse-coordinate trails or session recordings. Your own analytics may have separate recording settings. [Read the full signal and privacy guide](../PRIVACY.md).
