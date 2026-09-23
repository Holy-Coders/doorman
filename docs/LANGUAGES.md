# Install Doorman

Choose the package for the code that runs on your server. TypeScript applications use `@aarondovturkel/doorman-*`; Phoenix applications use the native `doorman` Mix dependency. Both can serve the same browser client.

Doorman 0.12.0 is a developer preview. Install the JavaScript packages from npm or the native Elixir package from Hex. You do not need a Doorman API key. Optional Jev evaluation uses credentials for your chosen AI provider.

The npm packages use the `@aarondovturkel/doorman-*` scope. The Hex package is `doorman_identity`, with `Doorman` modules. The unscoped name `doorman` belongs to unrelated packages on both registries.

Want to try it before adding dependencies to an existing app? Follow [your first visitor ID](GETTING-STARTED.md).

## npm, Bun or pnpm

```sh
# Browser client plus the server adapters. Pick your package manager:
npm install @aarondovturkel/doorman-browser @aarondovturkel/doorman-adapters
# pnpm add @aarondovturkel/doorman-browser @aarondovturkel/doorman-adapters
# bun add @aarondovturkel/doorman-browser @aarondovturkel/doorman-adapters
```

Each package contains ESM JavaScript and TypeScript declarations. Sibling dependencies resolve from npm normally; no local overrides are needed. Install `pg` in Node/Next.js applications that use Postgres. Cloudflare uses its existing D1 and Workers AI bindings.

Use Node 22.12+ for Node/Next.js examples. Bun can install and import the Web API packages; individual hosting frameworks and Postgres drivers have their own runtime requirements.

Advanced composition is available through `@aarondovturkel/doorman-core`, `doorman-storage-d1`, `doorman-storage-postgres`, `doorman-evaluator-jev`, `doorman-evaluator-cloudflare-jev` and the optional `doorman-network` package, all under the same npm scope.

## Elixir / Mix / Phoenix

```elixir
{:doorman_identity, "~> 0.12.0"}
```

```sh
mix deps.get
mix ecto.gen.migration add_doorman
# Add Doorman.Migration.up()/down() to the generated migration.
mix ecto.migrate
```

The package includes its browser client and migrations. See the [native guide](../packages/elixir/README.md) and [runnable Phoenix example](../examples/phoenix/README.md). The Elixir runtime does not need a Node service.

## Language-neutral HTTP

The browser SDK is independent of the application's server language. A first-party `/api/visitor` route accepts bounded JSON and returns JSON plus Set-Cookie. The [OpenAPI 3.1 contract](../protocol/openapi.json) and [JSON payload schema](../protocol/payload.schema.json) can generate clients in Python, Go, Ruby, PHP, Java and other languages. There is no central Doorman cloud endpoint or API key.

The built-in matching engines are TypeScript and native Elixir. A generated HTTP client in another language **calls an existing Doorman route; it does not become a native matching/storage implementation**. Mount Doorman in your existing Worker, Node or Phoenix application, or reverse-proxy a same-origin route to one if your deployment already supports that arrangement. Preserve Cookie/Set-Cookie and trusted original origin information; never forward client-supplied account/actor claims as server-verified context. An internal gateway must have application-owned authentication, request limits and tenant isolation before forwarding verified context.

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

Native matching engines exist for TypeScript and Elixir. The repository also includes tested [Python](../packages/python/README.md) and [Go](../packages/go/README.md) HTTP clients with runnable examples. They preserve per-request cookies, bound transport and project only public identity fields; they call your application-owned engine rather than duplicating matching or storage. Neither sends data to a central Doorman service.

The documentation's global language selector keeps your installation, setup, API and analytics guides together. Shared matching, privacy and research concepts apply across languages; engine-specific reference code is labeled where relevant.
