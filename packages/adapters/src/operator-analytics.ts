import { agentFamily, operatorLabel, operatorPolicy } from "@aarondovturkel/doorman-core";
import type {
  OperatorWindow,
  OperatorSummary,
  OperatorProfile,
} from "@aarondovturkel/doorman-core";

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
      doorman_schema_version: 1,
      doorman_account_id: boundedId(context.accountId),
      doorman_operator_window_id: window.id,
      doorman_operator_window_start: window.startedAt,
      doorman_operator_window_end: window.endedAt,
      doorman_operator_status: window.status,
      doorman_operator_basis: "model-inference",
      doorman_operator_score_kind: "uncalibrated",
      doorman_operator_scoring_policy: operatorPolicy(window.thresholds),
      doorman_operator_kind: operatorLabel(evaluation, window.thresholds),
      doorman_operator_model_version: evaluation?.modelVersion,
      doorman_operator_human_score: evaluation?.scores.human,
      doorman_operator_assistant_score: evaluation?.scores.assistant,
      doorman_operator_automation_score: evaluation?.scores.automation,
      doorman_operator_abuse_score: evaluation?.abuse,
      doorman_operator_family: family?.family,
      doorman_operator_family_score: family?.score,
      doorman_operator_family_reference: family
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
    doorman_schema_version: 1,
    doorman_account_id: boundedId(context.accountId),
    doorman_resolution_revision: boundedId(context.revisionId),
    doorman_resolution_version: summary.resolutionVersion,
    doorman_operator_score_kind: summary.scoreKind,
    doorman_operator_scoring_policy: summary.scoringPolicy,
    doorman_operator_basis: "model-inference",
    doorman_report_since: summary.window.since,
    doorman_report_until: summary.window.until,
    doorman_report_complete: summary.complete,
    doorman_observed_browser_ids: summary.observedBrowserIds,
    doorman_observed_windows: summary.observedWindows,
    doorman_evaluated_windows: summary.evaluatedWindows,
    doorman_unresolved_windows: summary.unresolvedWindows,
    doorman_compared_pairs: summary.comparedPairs,
    doorman_possible_pairs: summary.possiblePairs,
    ...Object.fromEntries(
      Object.entries(summary.estimates).flatMap(([kind, e]) =>
        e.likely === null
          ? []
          : [
              [`doorman_estimated_${kind}_profiles`, e.likely],
              [`doorman_${kind}_sensitivity_min`, e.thresholdSensitivity!.min],
              [`doorman_${kind}_sensitivity_max`, e.thresholdSensitivity!.max],
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
    doorman_schema_version: 1,
    doorman_account_id: boundedId(context.accountId),
    doorman_resolution_revision: boundedId(context.revisionId),
    doorman_resolution_version: summary.resolutionVersion,
    doorman_operator_score_kind: summary.scoreKind,
    doorman_operator_scoring_policy: summary.scoringPolicy,
    doorman_operator_basis: "model-inference",
    doorman_report_since: summary.window.since,
    doorman_report_until: summary.window.until,
    doorman_report_complete: summary.complete,
    doorman_inferred_operator_id: profile.id,
    doorman_operator_kind: profile.kind,
    doorman_operator_label_score: profile.labelScore,
    doorman_operator_browser_count: profile.browserCount,
    doorman_operator_window_count: profile.windowIds.length,
    ...(profile.family
      ? {
          doorman_operator_family: profile.family.family,
          doorman_operator_family_score: profile.family.score,
        }
      : {}),
  };
}
