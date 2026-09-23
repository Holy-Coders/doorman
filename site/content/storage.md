# Storage & retention

Janitor stores a stable ID and a short history of normalized observations. Use a dedicated database or schema per application; sharing these tables shares the identity namespace.

## Two tables

`visitors` contains the opaque ID, creation time and last-seen time. `observations` contains the visitor link, timestamp, coarse candidate lookup fields and full normalized JSON.

| Field                 | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `platform`, `browser` | Coarse device/browser lookup             |
| `timezone`            | Additional coarse candidate retrieval    |
| `webgl_renderer`      | Graphics environment candidate retrieval |
| `signals_json`        | The complete normalized observation      |
| `seen_at`             | Recency and retention                    |

D1 uses integer timestamps and JSON text. Postgres uses bigint timestamps and JSONB. Both index the candidate fields and visitor observation recency, with cascading observation deletion.

## Apply a migration

Cloudflare D1, from the example directory:

```sh
pnpm exec wrangler d1 migrations apply VISITORS --local
```

For Postgres, the examples include an idempotent migration command:

```sh
pnpm migrate
```

For an existing application, apply the SQL from the [D1 migration](../../packages/storage/d1/migrations/0001_visitors.sql) or [Postgres migration](../../packages/storage/postgres/migrations/0001_visitors.sql) with your migration runner.

## Keep a small history

```ts
const visitor = createNodeVisitor({
  db,
  observationRetentionDays: 90,
  maxObservationsPerVisitor: 10,
});

await visitor.cleanup();
```

Each save prunes that visitor's history. Matching reads only the last five retained observations. Expired history is excluded from matching even before cleanup physically removes it. Run cleanup from your existing maintenance task; Janitor installs no scheduler, worker or queue.

D1 batches insertion and pruning atomically. Postgres performs separate committed insertion and pruning statements; cleanup or the next save repairs interrupted pruning.

## Delete a visitor

```ts
// In an application-authorized server operation:
await visitor.deleteVisitor(visitorId);
```

Deletion cascades through that visitor's observations. Also clear the cookie, stop the browser client with `destroy()`, and respect the application's opt-out on later visits. Do not expose an unauthenticated endpoint accepting arbitrary visitor IDs for deletion.

See [Privacy & signals](/docs/privacy/) for the complete erasure procedure and data inventory.

## Optional identity directory

Enable `identity: { secret, namespace }` to add verified subjects, identity-key associations and delegation. Apply the storage package's `0002_identity.sql` migration after `0001_visitors.sql`. Example migration commands apply both.

The directory adds three tables: `identity_subjects`, `identity_keys`, and `identity_delegations`. Key digests are unique; references cascade on subject erasure. Grant expiry, principal and actor columns are indexed. Full records use JSONB in Postgres and JSON text in D1.

- [D1 identity migration](../../packages/storage/d1/migrations/0002_identity.sql)
- [Postgres identity migration](../../packages/storage/postgres/migrations/0002_identity.sql)

`cleanup()` removes expired grants alongside browser-history maintenance. Subject/key records require explicit removal and should follow the application's account lifecycle. Deleting a subject removes its keys and grants but leaves browser histories independent. See [the identity directory guide](../../docs/AGENTIC-IDENTITY.md).
