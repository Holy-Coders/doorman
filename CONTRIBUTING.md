# Contributing

Use Node 22.12+ and pnpm 9.12.0.

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm site:check
pnpm site:test
```

Keep changes small and the public API simple. Core stays provider-independent. Identity and risk remain separate. Browser collection must respect hidden signals and never capture input contents or coordinates. Mock external AI calls in tests; do not include secrets or real browser histories in issues or fixtures.

For a behavior change, explain its trigger and expected result and add a practical regression test. For matching changes, document confidence and false-positive tradeoffs. Passing synthetic tests is not evidence of production accuracy.

See `site/README.md` for documentation and website development. The project uses the MIT license.
