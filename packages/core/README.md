# @aarondovturkel/doorman-core

Provider-independent browser identity, similarity matching and private risk assessment.

Part of [Doorman](https://github.com/Holy-Coders/doorman), an application-owned identity layer for browser context, verified users and agents, and analytics integration.

## Installation

```sh
npm install @aarondovturkel/doorman-core
# pnpm add @aarondovturkel/doorman-core
# bun add @aarondovturkel/doorman-core
```

See the [usage guide](https://github.com/Holy-Coders/doorman/blob/main/docs/MATCHING.md) and [API documentation](https://doorman.holycoders.io/docs/). This package uses ESM and includes TypeScript declarations.

## Developer preview

Cookie-based browser continuity and verified login IDs support analytics integration. Cookieless matching, anonymous cross-device suggestions and inferred human/agent scores are experimental; they must not authenticate users or automatically merge accounts. See the [measured limitations](https://github.com/Holy-Coders/doorman/blob/main/docs/DETECTION-VALIDATION.md). Doorman never automatically blocks a user or displays a CAPTCHA.

MIT licensed.
