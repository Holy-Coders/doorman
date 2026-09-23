import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectBrowserSignals,
  createBehaviorTracker,
  createVisitorClient,
} from "@janitor/browser";
import { createVisitorId } from "@janitor/core";
const identity = {
  visitorId: createVisitorId(),
  confidence: 0.95,
  isReturning: true,
  risk: { automation: 0.1, suspicious: 0.1 },
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
