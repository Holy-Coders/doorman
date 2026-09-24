# Storage and retention

Use Postgres for Node, Next.js or Phoenix, or D1 for a Cloudflare Worker. The database must already exist. Doorman creates its own tables and indexes automatically on first use.

## Automatic setup

The recommended `createDoorman` adapter and native `Doorman.new` need no migration commands. Setup records the schema version, preserves existing data and runs only when needed. Concurrent starts are safe: Postgres uses a transaction and a database lock; D1 applies the schema as an atomic batch.

Your database connection needs permission to create the tables and indexes. Phoenix also creates its dedicated `doorman` schema. Give each application a separate database or schema; `namespace` separates user labels, not the browser-history tables.

You can prepare the tables during your normal startup or readiness check, instead of waiting for the first visit:

```ts
await doorman.ready();
```

```elixir
Doorman.ready(config)
```

This is optional. A failed setup is not marked complete. HTTP identification returns a controlled 503, and a later request can try again. TypeScript limits repeated setup attempts with a five-second cooldown. Review deployment logs and database privileges if setup fails.

For an organization that requires a separate schema owner, run readiness with a privileged connection during deployment, then use `autoMigrate: false` (Elixir: `auto_migrate: false`) with the restricted runtime connection. This is an advanced option, not part of normal installation. The underlying [D1](../../packages/storage/d1/migrations) and [Postgres](../../packages/storage/postgres/migrations) SQL remains available for review. Large existing databases may need planned index changes; see [database scaling](../../docs/SCALING.md).

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
const visitor = createDoorman({
  db,
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
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

## Account relationships and optional data

Remembered browser/account relationships refresh after verified login and expire with the configured observation retention. `forgetUser(rawUserId)` removes a user's associations and dependent login feedback; use `deleteVisitor(visitorId)` for browser history. These are separate erasure operations, not authentication decisions.

Optional cross-device feedback defaults to 30 days and up to 20 confirmed sessions per person. [Cross-device suggestions](../../docs/LEARNING.md) explains collection. Optional API aggregates default to one day and have separate session/actor keys; include [activity deletion](../../docs/API-ACTIVITY.md) in your account-erasure flow.

`cleanup()` handles enabled modules' expired rows. Also remove exported copies from analytics and apply your backup-retention policy. No separate learning service or model storage is needed for the recommended integration.
