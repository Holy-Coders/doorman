import { isIdentityAttribution } from "@janitor/core";
import { createExtendedBehavior } from "./behavior.js";
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

export function createBehaviorTracker(options: { extended?: boolean } = {}) {
  const extended = options.extended ? createExtendedBehavior() : undefined;
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
      pageAgeMs: Math.min(604_800_000, Math.max(0, Date.now() - started)),
    }),
    destroy: () => {
      removers.splice(0).forEach((remove) => safe(remove));
      extended?.clear();
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
    /** Start paused when the application controls collection permission. */
    enabled?: boolean;
    /** For framework CSRF tokens; evaluated again for each request. */
    headers?: () => Record<string, string>;
  } = {},
) {
  const newTracker = () =>
    createBehaviorTracker({ extended: options.behavior === "extended" });
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
          const response = await fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              ...options.headers?.(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              signals: collectBrowserSignals(),
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
