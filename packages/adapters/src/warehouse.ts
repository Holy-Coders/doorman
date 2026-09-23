import {
  analyticsProperties,
  type AnalyticsAssessment,
  type AnalyticsContext,
} from "./analytics.js";

/** Flat, versioned rows for customer-owned warehouse ingestion. Never sends data. */
export function warehouseEvent(
  assessment: AnalyticsAssessment,
  authenticatedId: string,
  options: AnalyticsContext & { eventId: string; occurredAt: Date },
) {
  for (const value of [authenticatedId, options.eventId])
    if (typeof value !== "string" || !value.trim() || value.length > 512)
      throw new Error("Warehouse actor and event IDs are required");
  if (
    !(options.occurredAt instanceof Date) ||
    !Number.isFinite(options.occurredAt.getTime())
  )
    throw new Error("Valid event time required");
  return {
    event_id: options.eventId,
    occurred_at: options.occurredAt.toISOString(),
    event_name: "janitor identified",
    authenticated_id: authenticatedId,
    ...analyticsProperties(assessment, options),
  };
}
/** Iterate into your existing sink; no in-memory batch, retry loop, or network dependency. */
export function* warehouseJSONL(
  rows: Iterable<ReturnType<typeof warehouseEvent>>,
): Generator<string> {
  for (const row of rows) {
    // Re-project public input to the documented flat schema, excluding arbitrary fields.
    const clean = Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          [
            "event_id",
            "occurred_at",
            "event_name",
            "authenticated_id",
          ].includes(key) || WAREHOUSE_PROPERTIES.has(key),
      ),
    );
    for (const value of Object.values(clean))
      if (!(
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.length <= 512)
      ))
        throw new Error("Warehouse rows must contain bounded scalar values");
    yield JSON.stringify(clean) + "\n";
  }
}
const WAREHOUSE_PROPERTIES = new Set([
  "janitor_schema_version",
  "janitor_account_id",
  "janitor_subject_id",
  "janitor_subject_status",
  "janitor_actor_id",
  "janitor_actor_basis",
  "janitor_visitor_id",
  "janitor_confidence",
  "janitor_returning",
  "janitor_automation",
  "janitor_suspicious",
  "janitor_risk_status",
  "janitor_actor_kind",
  "janitor_delegation_status",
  "janitor_api_risk_status",
  "janitor_api_automation",
  "janitor_api_suspicious",
  "janitor_api_evaluated_at",
  "janitor_api_expires_at",
  "janitor_api_cached",
  "janitor_api_window_ms",
  "janitor_api_requests",
  "janitor_api_truncated",
]);
