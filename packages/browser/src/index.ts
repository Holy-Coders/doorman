import { createExtendedBehavior } from "./behavior.js";
import type {
  BrowserBehavior,
  BrowserObservation,
  VisitorIdentity,
} from "@janitor/core";
export type {
  BrowserBehavior,
  BrowserObservation,
  VisitorIdentity,
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
function validIdentity(value: unknown): value is VisitorIdentity {
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
    typeof v.isReturning === "boolean" &&
    probability(v.confidence) &&
    !!risk &&
    probability(risk.automation) &&
    probability(risk.suspicious)
  );
}
export function createVisitorClient(
  options: {
    endpoint?: string;
    debug?: boolean;
    behavior?: "counts" | "extended";
  } = {},
) {
  const tracker = createBehaviorTracker({
    extended: options.behavior === "extended",
  });
  let pending: Promise<VisitorIdentity> | undefined;
  let destroyed = false;
  let controller: AbortController | undefined;
  return {
    identify(): Promise<VisitorIdentity> {
      if (destroyed)
        return Promise.reject(new Error("Visitor client has been destroyed"));
      if (pending) return pending;
      pending = (async () => {
        const endpoint = new URL(
          options.endpoint ?? "/api/visitor",
          window.location.href,
        );
        if (endpoint.origin !== window.location.origin)
          throw new Error("Visitor endpoint must be same-origin");
        controller = new AbortController();
        const timer = setTimeout(() => controller?.abort(), 10_000);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signals: collectBrowserSignals(),
              behavior: tracker.snapshot(),
              ...(options.debug ? { debug: true } : {}),
            }),
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error(
              `Visitor identification failed (${response.status})`,
            );
          const identity: unknown = await response.json();
          if (!validIdentity(identity))
            throw new Error("Invalid visitor response");
          return identity;
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    destroy() {
      destroyed = true;
      tracker.destroy();
      controller?.abort();
    },
  };
}
