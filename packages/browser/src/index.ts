import {
  collectDetectionSignals,
  createDetectionTracker,
} from "./detection.js";
import type { DetectionOptions } from "./detection.js";
export {
  collectDetectionSignals,
  createInteractionDecoy,
  FONT_PROBES,
} from "./detection.js";
export type { DetectionOptions } from "./detection.js";
import { isIdentityAttribution } from "@janitor/core";
import { createExtendedBehavior } from "./behavior.js";
import { createIdentityAnalytics } from "./analytics.js";
import type { IdentityAnalyticsOptions, Profile } from "./analytics.js";
export { createIdentityAnalytics } from "./analytics.js";
export type {
  IdentityAnalyticsOptions,
  AnalyticsResult,
  Profile,
} from "./analytics.js";
import type {
  BrowserBehavior,
  BrowserObservation,
  VisitorClientIdentity,
} from "@janitor/core";
export type {
  BrowserBehavior,
  BrowserObservation,
  VisitorIdentity,
  VisitorClientIdentity,
} from "@janitor/core";

export function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function collectBrowserSignals(): BrowserObservation {
  const graphics = safe(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    if (!gl) return undefined;
    const parameter = (name: number) =>
      safe(() => {
        const value: unknown = gl.getParameter(name);
        return typeof value === "string" ? value.slice(0, 512) : undefined;
      });
    try {
      // Standard masked values only. Do not enable debug/unmasking extensions.
      return {
        webglVendor: parameter(gl.VENDOR),
        webglRenderer: parameter(gl.RENDERER),
      };
    } finally {
      safe(() => gl.getExtension("WEBGL_lose_context")?.loseContext());
    }
  });
  return {
    userAgent: safe(() => navigator.userAgent.slice(0, 512)),
    platform: safe(() => navigator.platform.slice(0, 128)),
    languages: safe(() =>
      Array.from(navigator.languages)
        .slice(0, 20)
        .map((language) => language.slice(0, 64)),
    ),
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    screen: {
      width: safe(() => screen.width),
      height: safe(() => screen.height),
      colorDepth: safe(() => screen.colorDepth),
      pixelRatio: safe(() => window.devicePixelRatio),
    },
    viewport: {
      width: safe(() => window.innerWidth),
      height: safe(() => window.innerHeight),
    },
    hardware: {
      hardwareConcurrency: safe(() => navigator.hardwareConcurrency),
      deviceMemory: safe(
        () => (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      ),
      maxTouchPoints: safe(() => navigator.maxTouchPoints),
    },
    automation: { webdriver: safe(() => navigator.webdriver) },
    graphics,
  };
}

export function createBehaviorTracker(
  options: { extended?: boolean; detection?: DetectionOptions } = {},
) {
  const extended = options.extended ? createExtendedBehavior() : undefined;
  const detection = options.detection
    ? createDetectionTracker(options.detection)
    : undefined;
  const started = Date.now();
  const counts = {
    mouseMoveCount: 0,
    pointerDownCount: 0,
    keyDownCount: 0,
    scrollCount: 0,
    visibilityChangeCount: 0,
  };
  const removers: (() => void)[] = [];
  for (const [event, field] of [
    ["mousemove", "mouseMoveCount"],
    ["pointerdown", "pointerDownCount"],
    ["keydown", "keyDownCount"],
    ["scroll", "scrollCount"],
    ["visibilitychange", "visibilityChangeCount"],
  ] as const) {
    safe(() => {
      const listener = (event: Event) => {
        counts[field] = Math.min(1_000_000, counts[field] + 1);
        safe(() => extended?.observe(event));
      };
      document.addEventListener(event, listener, {
        passive: true,
        capture: true,
      });
      removers.push(() =>
        document.removeEventListener(event, listener, { capture: true }),
      );
    });
  }
  if (extended)
    for (const event of ["wheel", "blur"])
      safe(() => {
        const listener = (event: Event) => {
          safe(() => extended.observe(event));
        };
        document.addEventListener(event, listener, {
          passive: true,
          capture: true,
        });
        removers.push(() =>
          document.removeEventListener(event, listener, { capture: true }),
        );
      });
  return {
    snapshot: (): BrowserBehavior => ({
      ...counts,
      ...extended?.snapshot(),
      ...detection?.snapshot(),
      pageAgeMs: Math.min(604_800_000, Math.max(0, Date.now() - started)),
    }),
    destroy: () => {
      removers.splice(0).forEach((remove) => safe(remove));
      extended?.clear();
      detection?.destroy();
    },
  };
}
function validIdentity(value: unknown): value is VisitorClientIdentity {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const probability = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  const risk = v.risk as Record<string, unknown> | undefined;
  return (
    typeof v.visitorId === "string" &&
    /^vis_[a-f0-9]{48}$/.test(v.visitorId) &&
    (v.subjectId === undefined ||
      (typeof v.subjectId === "string" &&
        /^sub_[a-f0-9]{64}$/.test(v.subjectId))) &&
    (v.attribution === undefined || isIdentityAttribution(v.attribution)) &&
    typeof v.isReturning === "boolean" &&
    ((v.confidence === undefined &&
      v.risk === undefined &&
      v.riskStatus === undefined) ||
      (probability(v.confidence) &&
        ["evaluated", "unavailable", "disabled"].includes(
          String(v.riskStatus),
        ) &&
        !!risk &&
        probability(risk.automation) &&
        probability(risk.suspicious)))
  );
}
export function createVisitorClient(
  options: {
    endpoint?: string;
    debug?: boolean;
    behavior?: "counts" | "extended";
    detection?: DetectionOptions;
    /** Start paused when the application controls collection permission. */
    enabled?: boolean;
    /** For framework CSRF tokens; evaluated again for each request. */
    headers?: () => Record<string, string>;
  } = {},
) {
  const detection = options.detection ? { ...options.detection } : undefined;
  const newTracker = () =>
    createBehaviorTracker({
      extended: options.behavior === "extended",
      detection,
    });
  let enabled = options.enabled !== false;
  let tracker = enabled ? newTracker() : undefined;
  let generation = 0;
  let pending: Promise<VisitorClientIdentity> | undefined;
  let destroyed = false;
  let controller: AbortController | undefined;
  return {
    identify(): Promise<VisitorClientIdentity> {
      if (destroyed)
        return Promise.reject(new Error("Visitor client has been destroyed"));
      if (!enabled)
        return Promise.reject(new Error("Visitor collection is paused"));
      if (pending) return pending;
      const currentGeneration = generation;
      pending = (async () => {
        const endpoint = new URL(
          options.endpoint ?? "/api/visitor",
          window.location.href,
        );
        if (endpoint.origin !== window.location.origin)
          throw new Error("Visitor endpoint must be same-origin");
        controller = new AbortController();
        const requestController = controller;
        const timer = setTimeout(() => requestController.abort(), 10_000);
        try {
          const signals = collectBrowserSignals();
          if (detection)
            Object.assign(signals, await collectDetectionSignals(detection));
          if (
            currentGeneration !== generation ||
            destroyed ||
            !enabled ||
            requestController.signal.aborted
          )
            throw new Error("Visitor request was reset");
          const response = await fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              ...options.headers?.(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              signals,
              behavior: tracker?.snapshot(),
              ...(options.debug ? { debug: true } : {}),
            }),
            signal: requestController.signal,
          });
          if (!response.ok)
            throw new Error(
              `Visitor identification failed (${response.status})`,
            );
          const identity: unknown = await response.json();
          if (!validIdentity(identity))
            throw new Error("Invalid visitor response");
          if (currentGeneration !== generation || destroyed || !enabled)
            throw new Error("Visitor request was reset");
          return identity;
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => {
        if (currentGeneration === generation) pending = undefined;
      });
      return pending;
    },
    /** Pausing removes listeners and discards in-flight results. No cookie is changed. */
    setEnabled(value: boolean) {
      if (destroyed) throw new Error("Visitor client has been destroyed");
      if (enabled === value) return;
      enabled = value;
      generation++;
      controller?.abort();
      pending = undefined;
      tracker?.destroy();
      tracker = value ? newTracker() : undefined;
    },
    /** Call on logout/account change; clears aggregate behavior, not HttpOnly cookies. */
    reset() {
      if (destroyed) throw new Error("Visitor client has been destroyed");
      generation++;
      controller?.abort();
      pending = undefined;
      tracker?.destroy();
      tracker = enabled ? newTracker() : undefined;
    },
    destroy() {
      destroyed = true;
      generation++;
      tracker?.destroy();
      controller?.abort();
    },
  };
}

/** One identity lifecycle for your application and its existing analytics SDKs. */
export function createJanitorClient(
  options: NonNullable<Parameters<typeof createVisitorClient>[0]> & {
    analytics?: Omit<IdentityAnalyticsOptions, "visitor">;
  } = {},
) {
  const visitor = createVisitorClient(options);
  const analytics = createIdentityAnalytics({ ...options.analytics, visitor });
  let collecting = options.enabled !== false;
  let userId: string | undefined;
  let visitorId: string | undefined;
  let generation = 0;
  let destroyed = false;
  const active = () => {
    if (destroyed) throw new Error("Janitor client has been destroyed");
  };
  return {
    /** With a user ID: call after your application has authenticated that user. */
    async identify(id?: string, traits: Profile = {}) {
      active();
      if (!collecting) throw new Error("Janitor collection is paused");
      if (id !== undefined) {
        analytics.identifyUser(id, traits);
        if (userId !== id) {
          generation++;
          visitorId = undefined;
        }
        userId = id;
      }
      const current = generation;
      const identity = await visitor.identify();
      if (current !== generation || destroyed)
        throw new Error("Janitor identity changed during request");
      visitorId = identity.visitorId;
      return identity;
    },
    async update(traits: Profile) {
      active();
      if (!collecting) throw new Error("Janitor collection is paused");
      if (!userId)
        throw new Error(
          "Identify an authenticated user before updating a profile",
        );
      const result = analytics.identifyUser(userId, traits);
      await analytics.flush();
      return result;
    },
    track(
      event: string,
      properties: Record<string, string | number | boolean | null> = {},
    ) {
      active();
      if (!collecting) throw new Error("Janitor collection is paused");
      if (
        typeof event !== "string" ||
        !event.trim() ||
        event.length > 200 ||
        Object.keys(properties).length > 50
      )
        throw new Error("Invalid analytics event");
      const clean: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (
          !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
          key.startsWith("janitor_") ||
          [
            "distinct_id",
            "user_id",
            "anonymous_id",
            "token",
            "ip",
            "risk",
            "signals",
            "confidence",
            "__proto__",
            "constructor",
            "prototype",
          ].includes(key)
        )
          throw new Error("Reserved analytics property");
        if (
          value !== null &&
          typeof value !== "boolean" &&
          !(typeof value === "string" && value.length <= 1024) &&
          !(typeof value === "number" && Number.isFinite(value))
        )
          throw new Error("Invalid analytics property");
        clean[key] = value;
      }
      return analytics.track(event, {
        ...clean,
        ...(visitorId ? { janitor_visitor_id: visitorId } : {}),
      });
    },
    async reset() {
      active();
      generation++;
      userId = undefined;
      visitorId = undefined;
      const result = analytics.reset();
      await analytics.flush();
      return result;
    },
    setEnabled(enabled: boolean) {
      active();
      generation++;
      visitorId = undefined;
      collecting = enabled;
      visitor.setEnabled(enabled);
    },
    destroy() {
      generation++;
      destroyed = true;
      visitorId = undefined;
      visitor.destroy();
    },
  };
}
