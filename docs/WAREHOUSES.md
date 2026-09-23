# Snowflake and data warehouses

Keep Janitor's identity context in the warehouse you already use. You can route server events through RudderStack, or write flat JSONL rows into your existing ingestion pipeline. Janitor does not provision a warehouse or send data anywhere unless you wire up an export.

## Use an existing RudderStack pipeline

Connect Janitor's server analytics bridge to your initialized RudderStack SDK:

```ts
const bridge = createAnalyticsBridge({
  provider: "rudderstack",
  client: analytics,
});
await bridge.capture(identity, authenticatedActor.id, {
  accountId: account.id,
});
```

Import `createAnalyticsBridge` from `@janitor/adapters/analytics`. Configure Snowflake or BigQuery as a destination in your RudderStack project. Use your existing region, source, schema and service credentials. RudderStack owns batching, retries and warehouse delivery. Its warehouse schema is managed by RudderStack; it is not the flat-file schema below. [Snowflake destination](https://www.rudderstack.com/docs/destinations/warehouse-destinations/snowflake/), [BigQuery destination](https://www.rudderstack.com/docs/destinations/warehouse-destinations/bigquery/).

Use one delivery path per destination. Sending a Janitor event directly to Amplitude and routing the same event there through RudderStack can double-count it. Provider acceptance also does not prove every downstream destination accepted the event.

## Export rows into your own pipeline

```ts
import { warehouseEvent, warehouseJSONL } from "@janitor/adapters/warehouse";

const row = warehouseEvent(identity, authenticatedActor.id, {
  accountId: account.id,
  eventId: existingEvent.id,
  occurredAt: existingEvent.createdAt,
});
for (const line of warehouseJSONL([row])) {
  await existingSink.write(line);
}
```

Supply the same event ID and occurrence time when retrying. The exporter streams lines and projects allowlisted scalar properties; it creates no worker, connection or retry queue. Store and deliver them with your existing S3, GCS, lakehouse or batch pipeline. The data remains private server data.

In Elixir:

```elixir
row = Janitor.Warehouse.event(identity, current_actor.id,
  account_id: account.id, event_id: event.id, occurred_at: event.created_at)
line = Janitor.Warehouse.encode(row)
```

Rows include `event_id`, ISO `occurred_at`, `event_name`, `authenticated_id`, `janitor_schema_version`, and the same identity/risk summary fields used by the analytics bridges. The account and authenticated ID come from your application, not an AI guess. Raw fingerprints, route histories, request bodies, tokens, IPs and debug data are excluded. Identifiers still make this **pseudonymous personal data**, not anonymous telemetry.

## Load JSONL into Snowflake

The following uses an **existing** stage named `janitor_stage` containing your JSONL files. Create stage credentials and retention policies through your normal warehouse administration process.

```sql
CREATE TABLE IF NOT EXISTS janitor_events_raw (record VARIANT);
COPY INTO janitor_events_raw
  FROM @janitor_stage
  FILE_FORMAT = (TYPE = JSON STRIP_OUTER_ARRAY = FALSE)
  ON_ERROR = ABORT_STATEMENT;

CREATE OR REPLACE VIEW janitor_events AS
SELECT
  record:event_id::STRING AS event_id,
  record:occurred_at::TIMESTAMP_TZ AS occurred_at,
  record:janitor_account_id::STRING AS account_id,
  record:janitor_actor_id::STRING AS actor_id,
  record:janitor_actor_basis::STRING AS actor_basis,
  record:janitor_actor_kind::STRING AS actor_kind
FROM janitor_events_raw
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY record:event_id::STRING
  ORDER BY record:occurred_at::TIMESTAMP_TZ DESC
) = 1;
```

Keep `event_id` globally unique in your export or include tenant scope in the deduplication key. Load only your controlled export prefix. Snowflake tracks previously loaded files, but event-level deduplication still matters when retries create new filenames. These SQL recipes follow [Snowflake's JSON load contract](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table); they have not been executed in a paid warehouse.

## Load JSONL into BigQuery

Use newline-delimited JSON, one complete object per line:

```sh
bq load --source_format=NEWLINE_DELIMITED_JSON --autodetect \
  YOUR_PROJECT:YOUR_DATASET.janitor_events \
  'gs://YOUR_BUCKET/janitor/*.jsonl'
```

Autodetection is useful for a development load; declare a stable schema, partition `occurred_at`, and cluster by account/actor for production. Optional properties are absent when unknown. Deduplicate retries by `event_id` before producing account reports. Configure dataset location, bucket region, access and costs in your own project. [BigQuery's JSON loading guide](https://docs.cloud.google.com/bigquery/docs/loading-data-cloud-storage-json).

Other warehouses and lakehouses can consume the same JSONL. This release includes the exporter and documented Snowflake/BigQuery ingestion paths, not native drivers or verified connectors for every warehouse.

## Ask useful questions

For each authorized account and time window, count distinct `janitor_actor_id` where `janitor_actor_basis = 'verified-credential'`, grouped by `janitor_actor_kind`. Keep event counts, browsers, authenticated people, agents and delegated actions as separate metrics. A shared account can have several people and agents. A high automation score alone does not identify an attacker.

Apply row-level tenant access and retention to the derived tables, not just the raw bucket. When a user is erased, delete their associated analytics and warehouse records as well. Janitor's database cleanup cannot delete downstream exports.
