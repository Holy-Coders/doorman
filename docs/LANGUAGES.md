# Install Janitor

Choose the package for the code that runs on your server. TypeScript applications use `@janitor/*`; Phoenix applications use the native `janitor` Mix dependency. Both can serve the same browser client.

Janitor v0.9.0 is a developer preview distributed through GitHub. The packages are not yet published to npm or Hex, so use the release archive or Git dependency below. You do not need a Janitor API key. An optional Jev evaluation uses credentials for your chosen AI provider.

Want to try it before adding dependencies to an existing app? Follow [your first visitor ID](GETTING-STARTED.md).

## npm, Bun or pnpm

```sh
mkdir janitor-packages && cd janitor-packages
curl -fL https://github.com/Holy-Coders/janitor/releases/download/v0.9.0/janitor-0.9.0.tar.gz -o janitor.tar.gz
tar -xzf janitor.tar.gz
# Choose your package manager:
npm install
# bun install
# pnpm install
```

The archive extracts seven compiled JavaScript packages and a ready-to-use `package.json`. The commands above create a small standalone project where you can import Janitor.

### Add it to an existing app

The bundled packages depend on each other. Until they are on npm, your package manager needs local overrides for those dependencies. The supplied manifest already contains them.
npm/Bun use its `overrides`; pnpm uses `pnpm.overrides`. Both maps point all Janitor sibling dependencies at local archives. In an existing app, copy the archives into a vendor directory and merge `dependencies` plus the matching override map into your existing manifest, updating **every** `file:` path. Keep your application's own scripts/dependencies. Do not run `npm install @janitor/browser` against the public registry yet. These managers install the distributed packages; the source monorepo itself uses pnpm.

Use Node 22.12+ for Node/Next.js examples. Bun can install and import the same Web API packages. This is not a claim that all third-party hosting frameworks are tested on Bun. `pg` remains the application's connection pool, and its supported runtime applies.

## Elixir / Mix / Phoenix

```elixir
{:janitor, github: "Holy-Coders/janitor", tag: "v0.9.0", sparse: "packages/elixir"}
```

```sh
mix deps.get
mix ecto.gen.migration add_janitor
# Add Janitor.Migration.up()/down() to the generated migration.
mix ecto.migrate
```

The package includes its browser client and migrations. See [the native guide](../packages/elixir/README.md) and [runnable Phoenix example](../examples/phoenix/README.md). The Git tag is the supported install path; a Hex-format archive is attached for inspection, not proof of Hex publication.

## Language-neutral HTTP

The browser SDK is independent of the application's server language. A first-party `/api/visitor` route accepts bounded JSON and returns JSON plus Set-Cookie. The [OpenAPI 3.1 contract](../protocol/openapi.json) and [JSON payload schema](../protocol/payload.schema.json) can generate clients in Python, Go, Ruby, PHP, Java and other languages. There is no central Janitor cloud endpoint or API key.

The built-in matching engines are TypeScript and native Elixir. A generated HTTP client in another language **calls an existing Janitor route; it does not become a native matching/storage implementation**. Mount Janitor in your existing Worker, Node or Phoenix application, or reverse-proxy a same-origin route to one if your deployment already supports that arrangement. Preserve Cookie/Set-Cookie and trusted original origin information; never forward client-supplied account/actor claims as server-verified context. An internal gateway must have application-owned authentication, request limits and tenant isolation before forwarding verified context.

A protocol smoke test works from any language. Send measurements obtained from your application's browser, not attributes of the backend server:

```python
# Python standard library; no pip package required.
import http.cookiejar, json, urllib.request
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
request = urllib.request.Request(
    "https://your-app.example/api/visitor",
    data=json.dumps({"signals": {}}).encode(),
    headers={"Content-Type": "application/json"}, method="POST")
with client.open(request, timeout=10) as response:
    identity = json.load(response)
```

```go
// Go standard library; an HTTP contract call, not browser signal collection.
jar, _ := cookiejar.New(nil)
client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
req, _ := http.NewRequest("POST", "https://your-app.example/api/visitor",
    strings.NewReader(`{"signals":{}}`))
req.Header.Set("Content-Type", "application/json")
resp, err := client.Do(req)
// Handle err, check status, limit/decode the body, close it.
```

Empty observations make these transport checks, not useful identity benchmarks. Phoenix's browser route additionally requires its session and CSRF token. For actual website integration use the browser client, which collects signals, carries same-origin cookies and supports CSRF headers. The TypeScript adapters use standard Web Request/Response and can also be mounted on a host/framework that supports those APIs.

Native matching engines exist for TypeScript and Elixir. Version 0.9.0 also includes packaged, tested [Python](../packages/python/README.md) and [Go](../packages/go/README.md) HTTP clients with runnable examples. They preserve per-request cookies, bound transport and project only public identity fields; they call your application-owned engine rather than duplicating matching or storage. Neither sends data to a central Janitor service.

The documentation's global language selector keeps your installation, setup, API and analytics guides together. Shared matching, privacy and research concepts apply across languages; engine-specific reference code is labeled where relevant.
