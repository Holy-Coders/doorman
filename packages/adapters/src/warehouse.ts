import {
  operatorSummaryProperties,
  operatorWindowProperties,
  operatorProfileProperties,
} from "./operator-analytics.js";
import type {
  OperatorReportContext,
  OperatorAnalyticsContext,
} from "./operator-analytics.js";
import type { OperatorSummary, OperatorWindow } from "@janitor/core";
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
  "janitor_operator_window_id",
  "janitor_operator_window_start",
  "janitor_operator_window_end",
  "janitor_operator_status",
  "janitor_operator_basis",
  "janitor_operator_score_kind",
  "janitor_operator_kind",
  "janitor_operator_model_version",
  "janitor_operator_human_score",
  "janitor_operator_assistant_score",
  "janitor_operator_automation_score",
  "janitor_operator_abuse_score",
  "janitor_operator_family",
  "janitor_operator_family_score",
  "janitor_operator_family_reference",
  "janitor_resolution_revision",
  "janitor_resolution_version",
  "janitor_report_since",
  "janitor_report_until",
  "janitor_report_complete",
  "janitor_observed_browser_ids",
  "janitor_observed_windows",
  "janitor_evaluated_windows",
  "janitor_unresolved_windows",
  "janitor_compared_pairs",
  "janitor_possible_pairs",
  "janitor_inferred_operator_id",
  "janitor_operator_label_score",
  "janitor_operator_browser_count",
  "janitor_operator_window_count",
  "janitor_estimated_human_profiles",
  "janitor_human_sensitivity_min",
  "janitor_human_sensitivity_max",
  "janitor_estimated_assistant_profiles",
  "janitor_assistant_sensitivity_min",
  "janitor_assistant_sensitivity_max",
  "janitor_estimated_automation_profiles",
  "janitor_automation_sensitivity_min",
  "janitor_automation_sensitivity_max",

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

/** Account report plus profile rows; pass to warehouseJSONL and your existing sink. */
export function warehouseOperatorReport(
  summary: OperatorSummary,
  authenticatedId: string,
  options: OperatorReportContext & { eventId: string; occurredAt: Date },
) {
  const base = operatorEnvelope(authenticatedId, options);
  return [
    {
      ...base,
      event_name: "janitor operators summarized",
      ...operatorSummaryProperties(summary, options),
    },
    ...summary.profiles.map((profile, index) => ({
      ...base,
      event_id: `${options.eventId}:${index}`,
      event_name: "janitor operator profile",
      ...operatorProfileProperties(profile, summary, options),
    })),
  ];
}
export function warehouseOperatorWindow(
  window: OperatorWindow,
  authenticatedId: string,
  options: OperatorAnalyticsContext & { eventId: string; occurredAt: Date },
) {
  return {
    ...operatorEnvelope(authenticatedId, options),
    event_name: "janitor operator assessed",
    ...operatorWindowProperties(window, options),
  };
}
function operatorEnvelope(
  authenticatedId: string,
  options: { eventId: string; occurredAt: Date },
) {
  if (
    [authenticatedId, options.eventId].some(
      (v) => typeof v !== "string" || !v.trim() || v.length > 480,
    ) ||
    !(options.occurredAt instanceof Date) ||
    !Number.isFinite(options.occurredAt.getTime())
  )
    throw new Error("Invalid operator warehouse envelope");
  return {
    event_id: options.eventId,
    occurred_at: options.occurredAt.toISOString(),
    authenticated_id: authenticatedId,
  };
}
