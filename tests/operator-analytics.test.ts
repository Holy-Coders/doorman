import { expect, it, vi } from "vitest";
import {
  createAnalyticsBridge,
  operatorWindowProperties,
  operatorSummaryProperties,
} from "@aarondovturkel/doorman-adapters/analytics";
import {
  warehouseOperatorReport,
  warehouseOperatorWindow,
  warehouseJSONL,
} from "@aarondovturkel/doorman-adapters/warehouse";
import { summarizeOperators } from "@aarondovturkel/doorman-core";
import { window } from "./helpers/operators.js";
const range = { since: 0, until: 1000 };
const context = { accountId: "account-example", revisionId: "revision-1" };
it("exports private inference fields without browser measurements or credential attribution", () => {
  const w = window("sample");
  const properties = operatorWindowProperties(w, context);
  expect(properties.doorman_operator_assistant_score).toBe(0.97);
  expect(properties.doorman_operator_abuse_score).toBe(0.02);
  expect(properties).not.toHaveProperty("doorman_actor_id");
  expect(JSON.stringify(properties)).not.toMatch(
    /api_gap_cv|api_request_count|sessionKey|inputDigest|browserKey/,
  );
  expect(
    operatorWindowProperties({ ...w, status: "unavailable" }, context),
  ).not.toHaveProperty("doorman_operator_human_score");
});
it("sends summaries and profiles through PostHog and Mixpanel without identify or profile merges", async () => {
  const summary = summarizeOperators([window("sample")], range);
  const posthog = { capture: vi.fn(), identify: vi.fn() };
  const mixpanel = { track: vi.fn(), people: { set: vi.fn() } };
  const ph = createAnalyticsBridge({
    provider: "posthog",
    client: posthog,
    accountGroup: "account",
  });
  const mp = createAnalyticsBridge({
    provider: "mixpanel",
    client: mixpanel,
    accountGroup: "account",
  });
  for (const bridge of [ph, mp]) {
    expect(
      await bridge.captureOperatorWindow(
        window("sample"),
        "authenticated-user",
        context,
      ),
    ).toEqual({ status: "queued" });
    await bridge.captureOperatorSummary(summary, "authenticated-user", context);
    await bridge.captureOperatorProfile(
      summary.profiles[0]!,
      summary,
      "authenticated-user",
      context,
    );
  }
  expect(posthog.capture.mock.calls[1]![0]).toMatchObject({
    distinctId: "authenticated-user",
    event: "doorman operators summarized",
    groups: { account: "account-example" },
    properties: {
      doorman_resolution_revision: "revision-1",
      doorman_estimated_assistant_profiles: 1,
    },
  });
  expect(mixpanel.track.mock.calls[2]![1]).toMatchObject({
    distinct_id: "authenticated-user",
    doorman_operator_basis: "model-inference",
    doorman_inferred_operator_id: "op_sample",
  });
  expect(posthog.identify).not.toHaveBeenCalled();
  expect(mixpanel.people.set).not.toHaveBeenCalled();
});
it("projects versioned warehouse rows and omits unavailable totals", () => {
  const summary = summarizeOperators([window("sample")], range);
  const options = {
    ...context,
    eventId: "event-1",
    occurredAt: new Date(1000),
  };
  const rows = warehouseOperatorReport(summary, "authenticated-user", options);
  const json = [
    ...warehouseJSONL([
      ...rows,
      warehouseOperatorWindow(window("sample"), "authenticated-user", options),
    ]),
  ].join("");
  expect(rows).toHaveLength(2);
  expect(json).toContain('"doorman_resolution_revision":"revision-1"');
  expect(json).not.toContain("api_gap_cv");
  const incomplete = summarizeOperators([window("a"), window("b")], range);
  expect(operatorSummaryProperties(incomplete, context)).not.toHaveProperty(
    "doorman_estimated_assistant_profiles",
  );
});
