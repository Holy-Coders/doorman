import {
  operatorSummaryProperties,
  operatorWindowProperties,
  operatorProfileProperties,
} from "./operator-analytics.js";
import type {
  OperatorReportContext,
  OperatorAnalyticsContext,
} from "./operator-analytics.js";
import type { OperatorSummary, OperatorWindow } from "@aarondovturkel/doorman-core";
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
    event_name: "doorman identified",
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
  "doorman_operator_window_id",
  "doorman_operator_window_start",
  "doorman_operator_window_end",
  "doorman_operator_status",
  "doorman_operator_basis",
  "doorman_operator_score_kind",
  "doorman_operator_kind",
  "doorman_operator_model_version",
  "doorman_operator_human_score",
  "doorman_operator_assistant_score",
  "doorman_operator_automation_score",
  "doorman_operator_abuse_score",
  "doorman_operator_family",
  "doorman_operator_family_score",
  "doorman_operator_family_reference",
  "doorman_resolution_revision",
  "doorman_resolution_version",
  "doorman_report_since",
  "doorman_report_until",
  "doorman_report_complete",
  "doorman_observed_browser_ids",
  "doorman_observed_windows",
  "doorman_evaluated_windows",
  "doorman_unresolved_windows",
  "doorman_compared_pairs",
  "doorman_possible_pairs",
  "doorman_inferred_operator_id",
  "doorman_operator_label_score",
  "doorman_operator_browser_count",
  "doorman_operator_window_count",
  "doorman_estimated_human_profiles",
  "doorman_human_sensitivity_min",
  "doorman_human_sensitivity_max",
  "doorman_estimated_assistant_profiles",
  "doorman_assistant_sensitivity_min",
  "doorman_assistant_sensitivity_max",
  "doorman_estimated_automation_profiles",
  "doorman_automation_sensitivity_min",
  "doorman_automation_sensitivity_max",

  "doorman_schema_version",
  "doorman_account_id",
  "doorman_subject_id",
  "doorman_subject_status",
  "doorman_actor_id",
  "doorman_actor_basis",
  "doorman_visitor_id",
  "doorman_confidence",
  "doorman_returning",
  "doorman_automation",
  "doorman_suspicious",
  "doorman_risk_status",
  "doorman_actor_kind",
  "doorman_delegation_status",
  "doorman_api_risk_status",
  "doorman_api_automation",
  "doorman_api_suspicious",
  "doorman_api_evaluated_at",
  "doorman_api_expires_at",
  "doorman_api_cached",
  "doorman_api_window_ms",
  "doorman_api_requests",
  "doorman_api_truncated",
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
      event_name: "doorman operators summarized",
      ...operatorSummaryProperties(summary, options),
    },
    ...summary.profiles.map((profile, index) => ({
      ...base,
      event_id: `${options.eventId}:${index}`,
      event_name: "doorman operator profile",
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
    event_name: "doorman operator assessed",
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
