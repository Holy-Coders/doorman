# @aarondovturkel/doorman-adapters

Cloudflare, Node and Vercel adapters for Doorman browser identity and private risk.

Part of [Doorman](https://github.com/Holy-Coders/doorman), an application-owned identity layer for browser context, verified users and agents, and analytics integration.

## Installation

```sh
npm install @aarondovturkel/doorman-adapters
# pnpm add @aarondovturkel/doorman-adapters
# bun add @aarondovturkel/doorman-adapters
```

See the [usage guide](https://github.com/Holy-Coders/doorman/blob/main/docs/GETTING-STARTED.md) and [API documentation](https://doorman.holycoders.io/docs/). This package uses ESM and includes TypeScript declarations.

## Developer preview

Cookie-based browser continuity and verified login IDs support analytics integration. Cookieless matching, anonymous cross-device suggestions and inferred human/agent scores are experimental; they must not authenticate users or automatically merge accounts. See the [measured limitations](https://doorman.holycoders.io/docs/validation/). Doorman never automatically blocks a user or displays a CAPTCHA.

MIT licensed.
