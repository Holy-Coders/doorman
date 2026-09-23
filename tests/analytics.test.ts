import { expect, it, vi } from "vitest";
import { createIdentityAnalytics } from "@aarondovturkel/doorman-browser";
import {
  analyticsProperties,
  createAnalyticsBridge,
} from "@aarondovturkel/doorman-adapters/analytics";
import type { ApiActivityAssessment, VisitorIdentity } from "@aarondovturkel/doorman-core";

function browser() {
  const calls: string[] = [];
  const posthog = {
    identify: vi.fn((id: string) => {
      calls.push(`ph:${id}`);
    }),
    reset: vi.fn(() => {
      calls.push("ph:reset");
    }),
  };
  const mixpanel = {
    identify: vi.fn((id: string) => {
      calls.push(`mp:${id}`);
    }),
    reset: vi.fn(() => {
      calls.push("mp:reset");
    }),
    track: vi.fn(() => {
      calls.push("mp:event");
    }),
    people: { set: vi.fn() },
  };
  const visitor = { reset: vi.fn() };
  return {
    calls,
    posthog,
    mixpanel,
    visitor,
    analytics: createIdentityAnalytics({ posthog, mixpanel, visitor }),
  };
}
it("joins an anonymous journey at login, updates profiles, and deduplicates repeated auth renders", () => {
  const b = browser();
  expect(b.calls).toEqual([]);
  expect(
    b.analytics.identifyUser("user-a", {
      email: "a@example.test",
      plan: "pro",
    }),
  ).toEqual({ posthog: "queued", mixpanel: "queued" });
  expect(b.calls).toEqual(["ph:user-a", "mp:user-a", "mp:event"]);
  expect(b.mixpanel.people.set).toHaveBeenCalledWith({
    $email: "a@example.test",
    plan: "pro",
  });
  expect(
    b.analytics.identifyUser("user-a", {
      email: "a@example.test",
      plan: "pro",
    }),
  ).toEqual({ posthog: "skipped", mixpanel: "skipped" });
  b.analytics.identifyUser("user-a", { plan: "team" });
  expect(b.mixpanel.track).toHaveBeenCalledOnce();
  expect(b.mixpanel.people.set).toHaveBeenLastCalledWith({ plan: "team" });
  expect(b.visitor.reset).toHaveBeenCalledOnce();
});
it("keeps two people on one browser separate and resets on logout", () => {
  const b = browser();
  b.analytics.identifyUser("user-a");
  b.analytics.identifyUser("user-b");
  expect(b.calls).toEqual([
    "ph:user-a",
    "mp:user-a",
    "mp:event",
    "ph:reset",
    "ph:user-b",
    "mp:reset",
    "mp:user-b",
    "mp:event",
  ]);
  b.analytics.reset();
  expect(b.calls.slice(-2)).toEqual(["ph:reset", "mp:reset"]);
  b.analytics.identifyUser("user-c");
  expect(b.calls.slice(-3)).toEqual(["ph:user-c", "mp:user-c", "mp:event"]);
  expect(b.visitor.reset).toHaveBeenCalledTimes(4);
});
it("isolates SDK failures and retries a failed reset before attaching another identity", () => {
  const b = browser();
  b.analytics.identifyUser("user-a");
  b.posthog.reset.mockImplementationOnce(() => {
    throw Error("blocked");
  });
  expect(b.analytics.reset()).toEqual({
    posthog: "unavailable",
    mixpanel: "queued",
  });
  b.analytics.identifyUser("user-b");
  expect(b.posthog.reset).toHaveBeenCalledTimes(2);
  expect(b.posthog.identify).toHaveBeenLastCalledWith("user-b", {});
  expect(b.mixpanel.identify).toHaveBeenLastCalledWith("user-b");
});
it("never accepts a fuzzy browser ID as a person or forwards extra fields to browser analytics", () => {
  const b = browser();
  expect(() => b.analytics.identifyUser("vis_" + "a".repeat(48))).toThrow(
    "authenticated",
  );
  expect(() => b.analytics.identifyUser(" ")).toThrow();
  expect(() =>
    b.analytics.identifyUser("a", { email: "a".repeat(257) }),
  ).toThrow();
  b.analytics.identifyUser("user-a", {
    name: "A",
    risk: { automation: 1 },
    signals: "private",
  } as { name: string });
  expect(b.posthog.identify).toHaveBeenCalledWith("user-a", { name: "A" });
  expect(b.mixpanel.people.set).toHaveBeenCalledWith({ $name: "A" });
});

const identity: VisitorIdentity = {
  visitorId: "vis_" + "a".repeat(48),
  confidence: 0.98,
  isReturning: true,
  risk: { automation: 0.01, suspicious: 0.01 },
  riskStatus: "evaluated",
  attribution: {
    subject: { id: "sub_" + "b".repeat(64), status: "verified" },
    actor: {
      id: "sub_" + "c".repeat(64),
      kind: "agent",
      basis: "verified-credential",
    },
    delegation: { status: "none" },
  },
};
it("exports API risk separately through existing SDKs without route history or model identity claims", async () => {
  const apiActivity: ApiActivityAssessment = {
    source: "application-api",
    evaluatedAt: 100,
    expiresAt: 200,
    cached: false,
    riskStatus: "evaluated",
    risk: { automation: 0.9, suspicious: 0.1 },
    summary: {
      source: "application-api",
      observedAt: 100,
      windowMs: 60000,
      truncated: false,
      buckets: [
        {
          windowStart: 0,
          route: "GET /private/:id",
          requests: 10,
          denied: 1,
          clientErrors: 1,
          serverErrors: 0,
          durationTotalMs: 100,
          durationMaxMs: 10,
          firstSeenAt: 0,
          lastSeenAt: 100,
          shortGaps: 1,
        },
      ],
    },
  };
  const assessment = { attribution: identity.attribution!, apiActivity };
  const properties = analyticsProperties(assessment, { accountId: "account" });
  expect(properties).toMatchObject({
    doorman_actor_kind: "agent",
    doorman_api_risk_status: "evaluated",
    doorman_api_automation: 0.9,
    doorman_api_requests: 10,
  });
  expect(properties).not.toHaveProperty("doorman_automation");
  expect(properties).not.toHaveProperty("doorman_visitor_id");
  expect(JSON.stringify(properties)).not.toContain("/private");
  const ph = { capture: vi.fn(), identify: vi.fn() };
  const mp = { track: vi.fn(), people: { set: vi.fn() } };
  const sg = { track: vi.fn(), identify: vi.fn() };
  await createAnalyticsBridge({ provider: "posthog", client: ph }).capture(
    assessment,
    "agent-id",
  );
  await createAnalyticsBridge({ provider: "mixpanel", client: mp }).capture(
    assessment,
    "agent-id",
  );
  await createAnalyticsBridge({ provider: "segment", client: sg }).capture(
    assessment,
    "agent-id",
  );
  for (const client of [ph.capture, mp.track, sg.track])
    expect(JSON.stringify(client.mock.calls)).toContain(
      "doorman_api_automation",
    );
  expect(
    analyticsProperties({
      ...assessment,
      apiActivity: { ...apiActivity, riskStatus: "unavailable" },
    }),
  ).not.toHaveProperty("doorman_api_automation");
});
it("exports independent account, actor and browser dimensions without inferring a human from low risk", () => {
  expect(
    analyticsProperties(identity, { accountId: "workspace-a" }),
  ).toMatchObject({
    doorman_account_id: "workspace-a",
    doorman_actor_id: identity.attribution!.actor.id,
    doorman_actor_kind: "agent",
    doorman_schema_version: 1,
  });
  const unknown = analyticsProperties({ ...identity, attribution: undefined });
  expect(unknown.doorman_actor_kind).toBe("unknown");
  expect(unknown).not.toHaveProperty("doorman_actor_id");
  expect(unknown).not.toHaveProperty("doorman_account_id");
});
it("attaches account groups per event without changing the actor's analytics distinct ID", async () => {
  const capture = vi.fn(),
    track = vi.fn();
  const ph = createAnalyticsBridge({
    provider: "posthog",
    accountGroup: "account",
    client: { capture, identify: vi.fn() },
  });
  const mp = createAnalyticsBridge({
    provider: "mixpanel",
    accountGroup: "account",
    client: { track, people: { set: vi.fn() } },
  });
  await ph.capture(identity, "agent:a", { accountId: "workspace-a" });
  await mp.capture(identity, "agent:a", { accountId: "workspace-a" });
  expect(capture).toHaveBeenCalledWith(
    expect.objectContaining({
      distinctId: "agent:a",
      groups: { account: "workspace-a" },
    }),
  );
  expect(track).toHaveBeenCalledWith(
    "doorman identified",
    expect.objectContaining({
      distinct_id: "agent:a",
      $user_id: "agent:a",
      account: "workspace-a",
    }),
  );
  await mp.capture(identity, "agent:a", { accountId: "workspace-b" });
  await mp.capture(identity, "agent:a");
  expect(track.mock.calls[1]![1].account).toBe("workspace-b");
  expect(track.mock.calls[2]![1]).not.toHaveProperty("account");
});
it("supports original Mixpanel projects and refuses reserved group keys", async () => {
  const track = vi.fn(),
    client = { track, people: { set: vi.fn() } };
  await createAnalyticsBridge({
    provider: "mixpanel",
    identityMerge: "original",
    client,
  }).capture(identity, "user:a");
  expect(track.mock.calls[0]![1]).not.toHaveProperty("$user_id");
  for (const accountGroup of [
    "distinct_id",
    "token",
    "time",
    "doorman_actor_kind",
    "$user_id",
  ])
    expect(() =>
      createAnalyticsBridge({ provider: "mixpanel", accountGroup, client }),
    ).toThrow();
  expect(() => analyticsProperties(identity, { accountId: "" })).toThrow();
});

it("records a server agent without manufacturing browser identity or a zero risk score", () => {
  const properties = analyticsProperties(
    { attribution: identity.attribution! },
    { accountId: "workspace-a" },
  );
  expect(properties.doorman_actor_kind).toBe("agent");
  expect(properties.doorman_actor_id).toBe(identity.attribution!.actor.id);
  for (const field of [
    "doorman_visitor_id",
    "doorman_confidence",
    "doorman_automation",
    "doorman_risk_status",
  ])
    expect(properties).not.toHaveProperty(field);
});

it("serializes asynchronous Segment resets and drops events racing with logout", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const segment = {
    identify: vi.fn(async (id: string) => {
      calls.push(id);
    }),
    reset: vi.fn(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      calls.push("reset");
    }),
    track: vi.fn(),
  };
  const bridge = createIdentityAnalytics({ segment });
  bridge.identifyUser("alex");
  await bridge.flush();
  bridge.identifyUser("sam");
  await Promise.resolve();
  expect(calls).toEqual(["alex"]);
  release();
  await bridge.flush();
  expect(calls).toEqual(["alex", "reset", "sam"]);
  const pending = bridge.track("old account event");
  bridge.reset();
  expect(await pending).toEqual({ segment: "skipped" });
  expect(segment.track).not.toHaveBeenCalled();
  await Promise.resolve();
  release();
  await bridge.flush();
});
