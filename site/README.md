# Janitor public website

The public home, searchable documentation, and synthetic matching playground at https://janitor.holycoders.io. Astro generates static HTML; Cloudflare Workers serves the assets. No visitor observations, analytics, or AI calls are collected by this site.

From the repository root, with Node 22.12+ and pnpm 9:

```sh
pnpm install
pnpm build
pnpm site:dev
```

Astro prints the local URL. To stop its development daemon:

```sh
pnpm --filter @janitor/site exec astro dev stop
```

```sh
pnpm site:check
pnpm site:test
pnpm site:build
pnpm --filter @janitor/site exec wrangler deploy
```

Deployment requires Cloudflare access to the Holy Coders account and `holycoders.io` zone. `wrangler.jsonc` binds only `janitor.holycoders.io` to the `janitor-docs` static asset Worker.

`public/_headers` sets `Cache-Control: no-transform` to prevent Cloudflare from automatically injecting its Web Analytics beacon into this analytics-free site. This is Cloudflare's [documented opt-out for automatic injection](https://developers.cloudflare.com/web-analytics/get-started/); keep it when changing cache settings.

The documentation sync script builds pages and a local search index from the library's README, reference docs, privacy document, and example guides. Edit those original files; generated copies are ignored by Git. Storage documentation lives in `content/storage.md`.

The playground imports the real `@janitor/core` engine, uses fabricated observations with ephemeral in-memory storage, and disables the evaluator. Its output demonstrates the matching algorithm, not real-world recognition accuracy.
