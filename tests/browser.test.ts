import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectBrowserSignals,
  createBehaviorTracker,
  createVisitorClient,
  createDoormanClient,
} from "@aarondovturkel/doorman-browser";
import { createVisitorId } from "@aarondovturkel/doorman-core";
const identity = {
  visitorId: createVisitorId(),
  confidence: 0.95,
  isReturning: true,
  risk: { automation: 0.1, suspicious: 0.1 },
  riskStatus: "evaluated",
};
afterEach(() => vi.unstubAllGlobals());
function documentStub() {
  const document = new EventTarget();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    location: {
      href: "https://example.com/page",
      origin: "https://example.com",
    },
    innerWidth: 1000,
    innerHeight: 800,
    devicePixelRatio: 2,
  });
  return document;
}
describe("browser collection and lifecycle", () => {
  it("collects safely when all browser APIs are unavailable", () => {
    for (const name of ["window", "document", "navigator", "screen"])
      vi.stubGlobal(name, undefined);
    expect(() => collectBrowserSignals()).not.toThrow();
    expect(collectBrowserSignals().graphics).toBeUndefined();
  });
  it("isolates throwing getters without losing independent fields", () => {
    vi.stubGlobal("navigator", {
      get userAgent() {
        throw new Error("blocked");
      },
      platform: "MacIntel",
      languages: ["en"],
      webdriver: true,
    });
    const signals = collectBrowserSignals();
    expect(signals.userAgent).toBeUndefined();
    expect(signals.platform).toBe("MacIntel");
    expect(signals.automation?.webdriver).toBe(true);
  });
  it("counts events without accessing their contents and removes listeners", () => {
    const document = documentStub();
    const tracker = createBehaviorTracker();
    const event = new Event("keydown");
    Object.defineProperty(event, "key", {
      get() {
        throw new Error("Must never inspect key");
      },
    });
    document.dispatchEvent(event);
    document.dispatchEvent(new Event("mousemove"));
    expect(tracker.snapshot()).toMatchObject({
      keyDownCount: 1,
      mouseMoveCount: 1,
    });
    expect(Object.keys(tracker.snapshot())).toHaveLength(6);
    tracker.destroy();
    document.dispatchEvent(new Event("keydown"));
    expect(tracker.snapshot().keyDownCount).toBe(1);
  });
  it("sends same-origin credentials and coalesces concurrent identify requests", async () => {
    documentStub();
    const fetch = vi.fn(async () => Response.json(identity));
    vi.stubGlobal("fetch", fetch);
    const visitor = createVisitorClient();
    const first = visitor.identify();
    const second = visitor.identify();
    expect(first).toBe(second);
    expect(await first).toEqual(identity);
    expect(fetch).toHaveBeenCalledOnce();
    const options = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]?.[1];
    expect(options?.credentials).toBe("same-origin");
    expect(JSON.parse(String(options?.body)).debug).toBeUndefined();
    visitor.destroy();
    await expect(visitor.identify()).rejects.toThrow("destroyed");
  });
  it("rejects third-party endpoints and malformed responses", async () => {
    documentStub();
    const fetch = vi.fn(async () => Response.json({ visitorId: "oops" }));
    vi.stubGlobal("fetch", fetch);
    const thirdParty = createVisitorClient({
      endpoint: "https://tracker.example/api/visitor",
    });
    await expect(thirdParty.identify()).rejects.toThrow("same-origin");
    expect(fetch).not.toHaveBeenCalled();
    thirdParty.destroy();
    const client = createVisitorClient();
    await expect(client.identify()).rejects.toThrow("Invalid visitor response");
    client.destroy();
    fetch.mockImplementation(async () =>
      Response.json({ ...identity, riskStatus: "safe" }),
    );
    const invalidStatus = createVisitorClient();
    await expect(invalidStatus.identify()).rejects.toThrow(
      "Invalid visitor response",
    );
    invalidStatus.destroy();
  });
});

it("accepts masked or absent graphics values and never requests an unmasking extension", () => {
  const getExtension = vi.fn(() => undefined);
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        VENDOR: 1,
        RENDERER: 2,
        getParameter: (name: number) => (name === 1 ? "WebKit" : null),
        getExtension,
      }),
    }),
  });
  expect(collectBrowserSignals().graphics).toEqual({
    webglVendor: "WebKit",
    webglRenderer: undefined,
  });
  expect(getExtension).toHaveBeenCalledExactlyOnceWith("WEBGL_lose_context");
});

it("summarizes motion and press timing without reading coordinates, key values or targets", () => {
  const document = documentStub();
  let time = 0;
  vi.stubGlobal("performance", { now: () => time });
  const tracker = createBehaviorTracker({ extended: true });
  const emit = (
    type: string,
    at: number,
    values: Record<string, number> = {},
  ) => {
    time = at;
    const event = Object.assign(new Event(type), values);
    for (const name of ["clientX", "clientY", "key", "target"])
      Object.defineProperty(event, name, {
        get() {
          throw new Error("Private event content accessed");
        },
      });
    document.dispatchEvent(event);
  };
  emit("mousemove", 0, { movementX: 3, movementY: 4 });
  emit("mousemove", 100, { movementX: -3, movementY: -4 });
  emit("mousemove", 1200, { movementX: 0, movementY: 5 });
  emit("wheel", 1250, { deltaY: 120, deltaMode: 0 });
  emit("wheel", 1300, { deltaY: -40, deltaMode: 0 });
  emit("wheel", 1350, { deltaY: 20, deltaMode: 1 });
  emit("keydown", 1400);
  emit("pointerdown", 1600);
  emit("keydown", 2000);
  expect(tracker.snapshot()).toMatchObject({
    mouseDistancePx: 15,
    mouseActiveMs: 100,
    mouseDirectionChanges: 1,
    mousePauseCount: 1,
    scrollDistancePx: 160,
    scrollDirectionChanges: 1,
    interactionIntervalCount: 2,
    interactionIntervalMeanMs: 300,
    interactionIntervalStdDevMs: 100,
  });
  const before = tracker.snapshot();
  tracker.destroy();
  emit("wheel", 2100, { deltaY: 400, deltaMode: 0 });
  expect(tracker.snapshot().scrollDistancePx).toBe(before.scrollDistancePx);
});

it("does not manufacture motion evidence from missing APIs or timing across visibility gaps", () => {
  const document = documentStub();
  let time = 0;
  vi.stubGlobal("performance", { now: () => time });
  const tracker = createBehaviorTracker({ extended: true });
  document.dispatchEvent(new Event("mousemove"));
  document.dispatchEvent(new Event("keydown"));
  time = 100;
  document.dispatchEvent(new Event("visibilitychange"));
  time = 200;
  document.dispatchEvent(new Event("keydown"));
  expect(tracker.snapshot()).toMatchObject({
    mouseDistancePx: 0,
    interactionIntervalCount: 0,
  });
  expect(tracker.snapshot().interactionIntervalMeanMs).toBeUndefined();
  tracker.destroy();
});

it("validates actor attribution and rejects malformed delegation answers", async () => {
  documentStub();
  const attribution = {
    subject: { id: "sub_" + "a".repeat(64), status: "verified" },
    actor: {
      id: "sub_" + "b".repeat(64),
      kind: "agent",
      basis: "verified-credential",
    },
    delegation: {
      id: "dlg_" + "c".repeat(48),
      status: "valid",
      scopes: ["calendar:read"],
      expiresAt: Date.now() + 60000,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ...identity, attribution })),
  );
  const client = createVisitorClient();
  expect((await client.identify()).attribution?.actor.kind).toBe("agent");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...identity,
        attribution: { ...attribution, delegation: { status: "valid" } },
      }),
    ),
  );
  await expect(client.identify()).rejects.toThrow("Invalid visitor response");
  client.destroy();
});

it("pauses collection, resets aggregates on logout and attaches framework CSRF headers", async () => {
  const document = documentStub();
  const fetch = vi.fn<(url: URL, options: RequestInit) => Promise<Response>>(
    async () => Response.json(identity),
  );
  vi.stubGlobal("fetch", fetch);
  const client = createVisitorClient({
    enabled: false,
    headers: () => ({ "x-csrf-token": "csrf" }),
  });
  document.dispatchEvent(new Event("mousemove"));
  await expect(client.identify()).rejects.toThrow("paused");
  expect(fetch).not.toHaveBeenCalled();
  client.setEnabled(true);
  document.dispatchEvent(new Event("mousemove"));
  await client.identify();
  expect(
    JSON.parse(String(fetch.mock.calls[0]![1].body)).behavior.mouseMoveCount,
  ).toBe(1);
  expect(fetch.mock.calls[0]![1].headers).toMatchObject({
    "x-csrf-token": "csrf",
  });
  client.reset();
  await client.identify();
  expect(
    JSON.parse(String(fetch.mock.calls[1]![1].body)).behavior.mouseMoveCount,
  ).toBe(0);
  client.setEnabled(false);
  await expect(client.identify()).rejects.toThrow("paused");
  client.destroy();
});

it("discards stale responses after a reset even when transport ignores abort", async () => {
  documentStub();
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  const client = createVisitorClient();
  const pending = client.identify();
  client.reset();
  resolve(Response.json(identity));
  await expect(pending).rejects.toThrow("reset");
  client.destroy();
});

it("accepts private-score responses and rejects partially exposed scores", async () => {
  documentStub();
  const minimal = { visitorId: identity.visitorId, isReturning: true };
  const fetch = vi.fn(async () => Response.json(minimal));
  vi.stubGlobal("fetch", fetch);
  const visitor = createVisitorClient();
  expect(await visitor.identify()).toEqual(minimal);
  fetch.mockImplementation(async () =>
    Response.json({ ...minimal, confidence: 0.9 }),
  );
  await expect(visitor.identify()).rejects.toThrow("Invalid visitor response");
  visitor.destroy();
});

describe("Doorman identity lifecycle", () => {
  it("owns identify, profile updates, events and logout across destinations", async () => {
    documentStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ visitorId: identity.visitorId, isReturning: false }),
      ),
    );
    const posthog = { identify: vi.fn(), reset: vi.fn(), capture: vi.fn() };
    const mixpanel = {
      identify: vi.fn(),
      reset: vi.fn(),
      track: vi.fn(),
      people: { set: vi.fn() },
    };
    const segment = { identify: vi.fn(), reset: vi.fn(), track: vi.fn() };
    const doorman = createDoormanClient({
      analytics: { posthog, mixpanel, segment },
    });
    await doorman.identify();
    expect(posthog.identify).not.toHaveBeenCalled();
    await doorman.track("page viewed", { page: "pricing" });
    expect(segment.track).toHaveBeenCalledWith("page viewed", {
      page: "pricing",
      doorman_visitor_id: identity.visitorId,
    });
    await doorman.identify("alex", { plan: "free" });
    await doorman.update({ plan: "pro" });
    expect(segment.identify).toHaveBeenLastCalledWith("alex", { plan: "pro" });
    await doorman.identify("sam");
    expect(posthog.reset).toHaveBeenCalledOnce();
    await doorman.reset();
    expect(segment.reset).toHaveBeenCalledTimes(2);
    await expect(doorman.update({ name: "forgot login" })).rejects.toThrow(
      "authenticated",
    );
    doorman.destroy();
  });
  it("does not publish while paused and isolates failed destinations", async () => {
    documentStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ visitorId: identity.visitorId, isReturning: false }),
      ),
    );
    const posthog = {
      identify: vi.fn(),
      reset: vi.fn(),
      capture: vi.fn(() => {
        throw Error("blocked");
      }),
    };
    const segment = { identify: vi.fn(), reset: vi.fn(), track: vi.fn() };
    const doorman = createDoormanClient({
      enabled: false,
      analytics: { posthog, segment },
    });
    await expect(doorman.identify("alex")).rejects.toThrow("paused");
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(() => doorman.track("page")).toThrow("paused");
    doorman.setEnabled(true);
    await doorman.identify("alex");
    expect(await doorman.track("page")).toEqual({
      posthog: "unavailable",
      segment: "queued",
    });
    expect(() => doorman.track("page", { distinct_id: "other" })).toThrow(
      "Reserved",
    );
    expect(() => doorman.track("page", { doorman_confidence: 0.9 })).toThrow(
      "Reserved",
    );
    doorman.destroy();
  });
  it("discards measurements racing with an account switch", async () => {
    documentStub();
    const replies: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            replies.push(resolve);
          }),
      ),
    );
    const doorman = createDoormanClient();
    const old = doorman.identify("alex");
    await Promise.resolve();
    const discarded = expect(old).rejects.toThrow("reset");
    const next = doorman.identify("sam");
    await Promise.resolve();
    replies[0]!(
      Response.json({ visitorId: identity.visitorId, isReturning: false }),
    );
    await discarded;
    const nextId = createVisitorId();
    replies[1]!(Response.json({ visitorId: nextId, isReturning: false }));
    expect((await next).visitorId).toBe(nextId);
    doorman.destroy();
  });
});

it("adds safe context to existing SDK calls and clears it across account changes, pause and logout", async () => {
  documentStub();
  const sessionId = "ses_" + "a".repeat(48);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        visitorId: identity.visitorId,
        sessionId,
        isReturning: true,
        candidateSubjectId: "must-never-reach-analytics",
      }),
    ),
  );
  const props: Record<string, unknown> = {};
  const posthog = {
    identify: vi.fn(),
    reset: vi.fn(),
    capture: vi.fn(),
    register: vi.fn((p: Record<string, unknown>) => Object.assign(props, p)),
    unregister: vi.fn((k: string) => {
      delete props[k];
    }),
  };
  const client = createDoormanClient({
    collection: "extended",
    analytics: { posthog },
  });
  await client.identify({ userId: "alice", accountId: "home" });
  expect(props).toEqual({
    doorman_visitor_id: identity.visitorId,
    doorman_session_id: sessionId,
    doorman_account_id: "home",
  });
  await client.track("opened settings");
  expect(posthog.capture).toHaveBeenCalledWith("opened settings", props);
  await client.identify({ userId: "alice", accountId: "work" });
  expect(props.doorman_account_id).toBe("work");
  client.setEnabled(false);
  expect(props).toEqual({});
  client.setEnabled(true);
  await client.identify();
  await client.reset();
  expect(props).toEqual({});
  client.destroy();
});

it("discards a queued analytics event if account context changes before dispatch", async () => {
  documentStub();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ visitorId: identity.visitorId, isReturning: true }),
    ),
  );
  const posthog = {
    identify: vi.fn(),
    reset: vi.fn(),
    capture: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  };
  const client = createDoormanClient({ analytics: { posthog } });
  await client.identify({ userId: "alice", accountId: "home" });
  const event = client.track("old account event");
  await client.identify({ userId: "alice", accountId: "work" });
  expect((await event).posthog).toBe("skipped");
  expect(posthog.capture).not.toHaveBeenCalled();
  client.destroy();
});
