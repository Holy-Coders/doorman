# Install Doorman

These docs cover **Doorman 0.13**, available on npm and Hex. Choose your package manager below, or [run the source example](GETTING-STARTED.md). The commands select the version used in these guides.

## TypeScript: npm, pnpm or Bun

Install the browser client and the adapter for your server:

```sh
npm install @aarondovturkel/doorman-browser@^0.13.0 @aarondovturkel/doorman-adapters@^0.13.0
# Or:
pnpm add @aarondovturkel/doorman-browser@^0.13.0 @aarondovturkel/doorman-adapters@^0.13.0
# Or:
bun add @aarondovturkel/doorman-browser@^0.13.0 @aarondovturkel/doorman-adapters@^0.13.0
```

For Node or Next.js with Postgres, also install your database driver:

```sh
npm install pg
# Or: pnpm add pg
# Or: bun add pg
```

Packages contain ESM JavaScript and TypeScript declarations. The examples use Node.js 22.12+. Cloudflare uses its D1 binding instead of a database driver.

## Elixir / Phoenix

Add this dependency to `mix.exs`:

```elixir
{:doorman_identity, "~> 0.13.0"}
```

Then run `mix deps.get` and follow the [Phoenix setup](../packages/elixir/README.md). Doorman uses your Ecto Postgres repo and includes the browser JavaScript. You do not need a Node service or a JavaScript build.

The unscoped `doorman` packages on npm and Hex are unrelated. Use the package names above.

## No migration commands

Give Doorman a database connection and a stable server secret. It creates its own tables on first use and checks its schema when a new handler or application instance starts. You do not copy SQL files, generate Ecto migrations or run a separate migration step.

The database must already exist, and its connection needs permission to create Doorman's tables and indexes. See [storage setup](../site/content/storage.md) for database ownership and production startup.

## Run from source

```sh
git clone https://github.com/Holy-Coders/doorman.git
cd doorman
corepack enable
pnpm install
pnpm build
```

The repository uses pnpm 9.12.0 and links its own packages locally. Continue with the [local quickstart](GETTING-STARTED.md). The Phoenix example can run directly with Mix, without these JavaScript build steps.

## Choose your server

| Application       | Doorman runs in                                                              | Storage                                |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| Cloudflare Worker | Your Worker                                                                  | D1 or a compatible Postgres connection |
| Next.js / Vercel  | A Node route                                                                 | Postgres                               |
| Node / Fastify    | Your Node process                                                            | Postgres                               |
| Elixir / Phoenix  | Your Elixir app                                                              | Your Ecto Postgres repo                |
| Python / Go       | An application-owned TypeScript or Elixir endpoint, called by an HTTP client | Managed by that endpoint               |

The [Python](../packages/python/README.md) and [Go](../packages/go/README.md) packages are HTTP clients, not separate matching engines. Other languages can use the [HTTP contract](../protocol/openapi.json). Keep the browser endpoint on your application's origin and preserve its cookies when proxying.

Use the language picker for language-specific setup. Shared concepts and privacy guidance apply to every language.
