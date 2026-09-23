# Storage and retention

Doorman stores a random visitor ID and a short history of browser observations in your database. Use Postgres for Node, Next.js or Elixir, or D1 for a Cloudflare Worker. Cloudflare can also use the shared Postgres adapter.

Each application should have its own database or schema. Sharing these tables makes visitor history available to every application using them.

## Apply the migrations

For local Cloudflare development, run this from the example directory:

```sh
pnpm exec wrangler d1 migrations apply VISITORS --local
```

The Node and Next.js examples include a migration command:

```sh
pnpm migrate
```

For an existing application, use your migration runner to apply the SQL files in the [D1](../../packages/storage/d1/migrations) or [Postgres](../../packages/storage/postgres/migrations) package, in order. The v0.12.0 release includes all nine:

| Migration                   | Creates or changes                                              |
| --------------------------- | --------------------------------------------------------------- |
| `0001_visitors.sql`         | Visitor records and browser observations.                       |
| `0002_identity.sql`         | People, agents, verified keys and delegations.                  |
| `0003_learning.sql`         | Optional pre-login feedback sessions.                           |
| `0004_candidate_lookup.sql` | Indexes for finding plausible previous visitors efficiently.    |
| `0005_protection.sql`       | Shared request counters and evaluator budgets.                  |
| `0006_evidence.sql`         | Verified application events and device associations.            |
| `0007_learning_lookup.sql`  | Indexed retrieval of login-confirmed sessions for Jev learning. |
| `0008_api_activity.sql`     | Optional aggregate API counters and private assessment cache.   |
| `0009_operators.sql`        | Private operator windows, profiles and assessment reports.      |

Creating an optional feature’s tables does not enable that feature. For an existing large Postgres installation, read the [index migration instructions](../../docs/SCALING.md) before applying lookup indexes to a busy table.

Native Elixir applications use `Doorman.Migration.up()` for a fresh installation. Existing installations use the upgrade functions in the [Phoenix guide](../../packages/elixir/README.md).

## What the browser tables contain

`visitors` holds the random ID, creation time and last-seen time. `observations` holds the normalized browser signals, timestamp and visitor ID. A few columns are indexed so Doorman can find candidates without comparing every visitor:

| Field                        | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `platform`, `browser`        | Find broadly compatible browser environments.                                 |
| `timezone`, `webgl_renderer` | Narrow the lookup when these values are available.                            |
| `signals_json`               | Keep the complete normalized observation, including optional behavior totals. |
| `seen_at`                    | Select recent history and enforce retention.                                  |

D1 stores JSON as text. Postgres uses JSONB. Both delete a visitor’s observations when the visitor record is erased.

## Choose how much history to keep

The defaults are 90 days and at most ten observations per visitor. Matching reads only the latest five retained observations. You can shorten retention:

```ts
const visitor = createNodeVisitor({
  db,
  observationRetentionDays: 30,
  maxObservationsPerVisitor: 10,
});
```

Expired observations stop participating in matching immediately, even if cleanup has not physically deleted them yet. Each saved visit also prunes that visitor’s old history.

## Run cleanup from existing maintenance

Doorman does not install a scheduler. Call cleanup from a maintenance task you already run:

```ts
const page = await visitor.cleanup({ batchSize: 100 });

// Save this cursor for the next maintenance batch.
const nextVisitorId = page?.nextVisitorId;
// Next call: visitor.cleanup({ batchSize: 100, afterVisitorId: nextVisitorId })
```

Continue through visitor pages using `nextVisitorId`, and run further expiration batches while `hasMoreExpired` is true. This limits work per call. [Scale and maintenance](../../docs/SCALING.md) covers cursor handling in more detail.

D1 inserts and prunes in one atomic batch. Postgres uses separate committed statements; cleanup or a later visit repairs interrupted pruning. Include database backups and exports in your own retention process.

## Delete a visitor

From a server operation your application has authorized:

```ts
await visitor.deleteVisitor(visitorId);
```

Also stop browser collection and clear the visitor cookie. Keep the application’s opt-out active on later visits so a new observation is not immediately collected. See [the complete deletion procedure](../../PRIVACY.md).

## Optional data has its own lifecycle

- **Identity directory:** subjects and verified keys remain until you remove them. Deleting a subject removes its keys and delegations. Browser history is separate.
- **Learning:** pre-login feedback defaults to 30 days, with up to 20 verified sessions per subject. Collection must be enabled and allowed by the chosen [collection policy](../../docs/LEARNING.md).
- **Application events:** default retention is seven days. Verified device links have their own expiry and revocation records. See [trusted events and device associations](../../docs/HARDENING.md).

`cleanup()` handles the enabled modules’ expired rows as documented in those guides. Account deletion should also remove your application’s own associations and any copies exported to analytics.
