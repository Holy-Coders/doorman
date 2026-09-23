# Browsers, people & agents

Doorman keeps a few kinds of identity separate. Understanding the difference will help you choose the right ID for a browser, a user profile or an account report.

## One example, three IDs

Alex and Sam work in a shared design workspace. Alex uses a laptop and a phone, and has given an AI assistant permission to read the workspace calendar.

| Thing you want to identify | Example | What identifies it |
| --- | --- | --- |
| A browser | Alex’s laptop browser | Doorman’s `visitorId` |
| A person or agent | Alex, Sam, or Alex’s assistant | A verified identity registered by your server |
| A shared workspace | The design studio | Your application’s existing account or workspace ID |

Alex’s phone gets its own browser ID. It can still belong to the same signed-in user. If Sam borrows Alex’s laptop, the browser ID can stay the same while the user changes.

## Visitor

A **visitor** is a browser environment with a stored history. Doorman assigns it an opaque, random ID beginning with `vis_`. A cookie usually preserves that ID. Browser-signal matching is the fallback when the cookie is missing.

`isReturning` means Doorman found an existing visitor record. It does not mean the current user has an account, is authenticated, or is the same person who used the browser previously.

## Observation

An **observation** is a small snapshot of browser signals, such as browser family, language, screen size and timezone. All fields are optional. A visitor has several recent observations, which lets Doorman tolerate ordinary changes.

Doorman stores observations in your database. They are never encoded into the visitor ID. See the [signal inventory](../PRIVACY.md).

## Subject and actor

In the identity API, a **subject** is a registered person or agent. Your server registers it after your authentication system verifies its identity.

For a particular request, the **subject** is the identity being represented and the **actor** is the person or agent making the request:

| Request | Subject | Actor |
| --- | --- | --- |
| Alex opens their calendar | Alex | Alex |
| Alex’s assistant reads that calendar | Alex | Alex’s assistant |
| Sam uses permission Alex granted | Alex | Sam |

An actor is not inferred from a low automation score. If your server has not established who is acting, Doorman reports the actor as unknown.

Some references use **principal** for a registered identity, especially the identity granting permission. It is an identity record, not another kind of browser ID.

## Delegation

A **delegation** is permission for one actor to act for another identity. It names the allowed service, actions and expiry time.

For example, Alex can let the assistant perform `events:read` for `calendar-api` for one hour. Doorman checks that the stored permission matches the request and has not expired or been revoked. Your application uses that result to allow or reject the action.

A delegation ID is a reference to a permission record. The assistant still needs its own authenticated credential.

## Confidence and risk

**Confidence** describes browser continuity. Cookie-based continuity returns `1`; a recovered match returns its comparison score; a new visitor ID returns `0` because no past link was established. These values do not measure how trustworthy a person is.

**Risk** describes technical evidence from the current visit:

- `automation`: how consistent the available evidence is with browser automation.
- `suspicious`: how inconsistent or unusual the technical signals look.

These are separate scores. An authorized AI assistant can be automated. A familiar browser can be compromised. Always check `riskStatus`: a zero returned when evaluation is disabled or unavailable is not an assessment of safety.

## Which ID should analytics use?

Use your authenticated **user ID** to identify a person in PostHog or Mixpanel. Use your **workspace ID** to group shared-account activity. Keep Doorman’s **visitor ID** as browser context rather than replacing a person’s analytics identity with it.

The [analytics guide](ANALYTICS.md) shows login, user switching, logout and reports. The [people and agents guide](AGENTIC-IDENTITY.md) shows how to register identities and permissions.
