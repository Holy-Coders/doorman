import { agentFamily, operatorLabel, operatorPolicy } from "@janitor/core";
import type {
  OperatorWindow,
  OperatorSummary,
  OperatorProfile,
} from "@janitor/core";

export type OperatorAnalyticsContext = { accountId: string };
export type OperatorReportContext = OperatorAnalyticsContext & {
  revisionId: string;
};
const boundedId = (value: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new Error("Operator analytics context required");
  return value;
};
/** All fields are inference-specific. Credential attribution and analytics distinct IDs stay untouched. */
export function operatorWindowProperties(
  window: OperatorWindow,
  context: OperatorAnalyticsContext,
) {
  const evaluation =
    window.status === "evaluated" ? window.evaluation : undefined;
  const family = agentFamily(evaluation, window.thresholds);
  return Object.fromEntries(
    Object.entries({
      janitor_schema_version: 1,
      janitor_account_id: boundedId(context.accountId),
      janitor_operator_window_id: window.id,
      janitor_operator_window_start: window.startedAt,
      janitor_operator_window_end: window.endedAt,
      janitor_operator_status: window.status,
      janitor_operator_basis: "model-inference",
      janitor_operator_score_kind: "uncalibrated",
      janitor_operator_scoring_policy: operatorPolicy(window.thresholds),
      janitor_operator_kind: operatorLabel(evaluation, window.thresholds),
      janitor_operator_model_version: evaluation?.modelVersion,
      janitor_operator_human_score: evaluation?.scores.human,
      janitor_operator_assistant_score: evaluation?.scores.assistant,
      janitor_operator_automation_score: evaluation?.scores.automation,
      janitor_operator_abuse_score: evaluation?.abuse,
      janitor_operator_family: family?.family,
      janitor_operator_family_score: family?.score,
      janitor_operator_family_reference: family
        ? window.referenceVersions?.[family.family]
        : undefined,
    }).filter(([, v]) => v !== undefined),
  );
}
export function operatorSummaryProperties(
  summary: OperatorSummary,
  context: OperatorReportContext,
) {
  return {
    janitor_schema_version: 1,
    janitor_account_id: boundedId(context.accountId),
    janitor_resolution_revision: boundedId(context.revisionId),
    janitor_resolution_version: summary.resolutionVersion,
    janitor_operator_score_kind: summary.scoreKind,
    janitor_operator_scoring_policy: summary.scoringPolicy,
    janitor_operator_basis: "model-inference",
    janitor_report_since: summary.window.since,
    janitor_report_until: summary.window.until,
    janitor_report_complete: summary.complete,
    janitor_observed_browser_ids: summary.observedBrowserIds,
    janitor_observed_windows: summary.observedWindows,
    janitor_evaluated_windows: summary.evaluatedWindows,
    janitor_unresolved_windows: summary.unresolvedWindows,
    janitor_compared_pairs: summary.comparedPairs,
    janitor_possible_pairs: summary.possiblePairs,
    ...Object.fromEntries(
      Object.entries(summary.estimates).flatMap(([kind, e]) =>
        e.likely === null
          ? []
          : [
              [`janitor_estimated_${kind}_profiles`, e.likely],
              [`janitor_${kind}_sensitivity_min`, e.thresholdSensitivity!.min],
              [`janitor_${kind}_sensitivity_max`, e.thresholdSensitivity!.max],
            ],
      ),
    ),
  };
}
export function operatorProfileProperties(
  profile: OperatorProfile,
  summary: OperatorSummary,
  context: OperatorReportContext,
) {
  if (!summary.profiles.some((p) => p === profile))
    throw new Error("Profile must belong to this report");
  return {
    janitor_schema_version: 1,
    janitor_account_id: boundedId(context.accountId),
    janitor_resolution_revision: boundedId(context.revisionId),
    janitor_resolution_version: summary.resolutionVersion,
    janitor_operator_score_kind: summary.scoreKind,
    janitor_operator_scoring_policy: summary.scoringPolicy,
    janitor_operator_basis: "model-inference",
    janitor_report_since: summary.window.since,
    janitor_report_until: summary.window.until,
    janitor_report_complete: summary.complete,
    janitor_inferred_operator_id: profile.id,
    janitor_operator_kind: profile.kind,
    janitor_operator_label_score: profile.labelScore,
    janitor_operator_browser_count: profile.browserCount,
    janitor_operator_window_count: profile.windowIds.length,
    ...(profile.family
      ? {
          janitor_operator_family: profile.family.family,
          janitor_operator_family_score: profile.family.score,
        }
      : {}),
  };
}
