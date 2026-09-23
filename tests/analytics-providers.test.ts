import { it, expect, vi } from "vitest";
import { createIdentityAnalytics } from "@janitor/browser";
import {
  createAnalyticsBridge,
  type AnalyticsAssessment,
} from "@janitor/adapters/analytics";
import { warehouseEvent, warehouseJSONL } from "@janitor/adapters/warehouse";
import * as amplitude from "@amplitude/analytics-browser";
import * as amplitudeNode from "@amplitude/analytics-node";
import { RudderAnalytics } from "@rudderstack/analytics-js";
import Analytics from "@rudderstack/rudder-sdk-node";

// Compile against the real installed SDKs, without initializing network transports.
it("accepts the current Amplitude and RudderStack SDK types", () => {
  expect(
    createIdentityAnalytics({
      amplitude,
      rudderstack: Object.create(RudderAnalytics.prototype) as RudderAnalytics,
    }),
  ).toBeDefined();
  expect(
    createAnalyticsBridge({ provider: "amplitude", client: amplitudeNode }),
  ).toBeDefined();
  const client = new Analytics("test-write-key", {
    dataPlaneUrl: "https://example.test",
    flushAt: 100,
  });
  expect(
    createAnalyticsBridge({ provider: "rudderstack", client }),
  ).toBeDefined();
});
const identity: AnalyticsAssessment = {
  visitorId: "vis_" + "a".repeat(48),
  isReturning: true,
  confidence: 0.9,
  risk: { automation: 0.5, suspicious: 0.1 },
  riskStatus: "evaluated",
};
it("rotates RudderStack anonymous IDs and clears custom context between accounts", async () => {
  const calls: unknown[] = [];
  const rudderstack = {
    identify: vi.fn((id: string, props: unknown) => {
      calls.push([id, props]);
    }),
    track: vi.fn(),
    reset: vi.fn((options: unknown) => {
      calls.push(options);
    }),
    clearCustomContext: vi.fn(),
  };
  const analytics = createIdentityAnalytics({ rudderstack });
  analytics.identifyUser("person-a", { plan: "pro" });
  await analytics.flush();
  analytics.identifyUser("person-b");
  await analytics.flush();
  expect(rudderstack.clearCustomContext).toHaveBeenCalledOnce();
  expect(rudderstack.reset).toHaveBeenCalledWith({
    entries: {
      anonymousId: true,
      initialReferrer: true,
      initialReferringDomain: true,
    },
  });
  expect(calls.at(-1)).toEqual(["person-b", {}]);
  analytics.reset();
  await analytics.flush();
  expect(rudderstack.reset).toHaveBeenCalledTimes(2);
});
it("waits for Amplitude profile processing and skips an event overtaken by logout", async () => {
  let complete!: (result: unknown) => void;
  const promise = new Promise((resolve) => {
    complete = resolve;
  });
  const sdk = {
    setUserId: vi.fn(),
    reset: vi.fn(),
    track: vi.fn().mockReturnValueOnce({ promise }),
  };
  const analytics = createIdentityAnalytics({ amplitude: sdk });
  analytics.identifyUser("person-a", { plan: "pro" });
  const tracking = analytics.track("private workspace opened");
  analytics.reset();
  complete({ code: 200 });
  await analytics.flush();
  expect(await tracking).toEqual({ amplitude: "skipped" });
  expect(sdk.track).toHaveBeenCalledWith({
    event_type: "$identify",
    user_properties: { $set: { plan: "pro" } },
  });
  expect(sdk.reset).toHaveBeenCalledOnce();
});
it("isolates failed SDK profiles and resets before retrying", async () => {
  const sdk = {
    setUserId: vi.fn(),
    reset: vi.fn(),
    track: vi
      .fn()
      .mockReturnValueOnce({ promise: Promise.resolve({ code: 400 }) }),
  };
  const analytics = createIdentityAnalytics({ amplitude: sdk });
  analytics.identifyUser("person-a");
  await analytics.flush();
  expect(await analytics.track("opened")).toEqual({ amplitude: "unavailable" });
  analytics.identifyUser("person-a");
  await analytics.flush();
  expect(sdk.reset).toHaveBeenCalledOnce();
});
it("sends Amplitude private properties using HTTP V2 event and profile semantics", async () => {
  const client = {
    track: vi.fn(() => ({ promise: Promise.resolve({ code: 200 }) })),
  };
  const bridge = createAnalyticsBridge({
    provider: "amplitude",
    client,
    accountGroup: "account",
  });
  expect(
    await bridge.capture(identity, "agent-a", { accountId: "team-a" }),
  ).toEqual({ status: "queued" });
  expect(client.track).toHaveBeenCalledWith(
    expect.objectContaining({
      event_type: "janitor identified",
      user_id: "agent-a",
      groups: { account: "team-a" },
      ip: "0.0.0.0",
    }),
  );
  await bridge.identifyUser("agent-a", { plan: "pro" });
  expect(client.track).toHaveBeenLastCalledWith(
    expect.objectContaining({
      event_type: "$identify",
      user_properties: { $set: { plan: "pro" } },
    }),
  );
  client.track.mockReturnValueOnce({ promise: Promise.resolve({ code: 429 }) });
  expect(await bridge.capture(identity, "agent-a")).toEqual({
    status: "unavailable",
  });
});
it("routes identity events to RudderStack without raw browser data", async () => {
  const client = { track: vi.fn(), identify: vi.fn() };
  const bridge = createAnalyticsBridge({ provider: "rudderstack", client });
  await bridge.capture(
    {
      ...identity,
      debug: { collectedSignals: { userAgent: "private" } },
    } as AnalyticsAssessment,
    "person-a",
    { accountId: "team-a" },
  );
  expect(client.track).toHaveBeenCalledWith({
    userId: "person-a",
    event: "janitor identified",
    properties: expect.objectContaining({ janitor_account_id: "team-a" }),
  });
  expect(JSON.stringify(client.track.mock.calls)).not.toContain("private");
  await bridge.identifyUser("person-a", { plan: "pro" });
  expect(client.identify).toHaveBeenCalledWith({
    userId: "person-a",
    traits: { plan: "pro" },
  });
});
it("exports bounded flat JSONL, preserves stable event keys and rejects nested data", () => {
  const row = warehouseEvent(identity, "person-a", {
    eventId: "event-a",
    occurredAt: new Date("2026-09-23T00:00:00Z"),
    accountId: "team-a",
  });
  const lines = [
    ...warehouseJSONL([{ ...row, debug: { signals: "secret" } } as typeof row]),
  ];
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/\n$/);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event_id: "event-a",
    authenticated_id: "person-a",
    janitor_actor_kind: "unknown",
  });
  expect(lines[0]).not.toContain("secret");
  expect(() => [
    ...warehouseJSONL([
      { ...row, janitor_account_id: { nested: true } } as never,
    ]),
  ]).toThrow("scalar");
  expect(() =>
    warehouseEvent(identity, "", { eventId: "x", occurredAt: new Date() }),
  ).toThrow();
});
