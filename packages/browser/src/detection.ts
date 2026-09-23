import type { BrowserBehavior, BrowserObservation } from "@aarondovturkel/doorman-core";

/** Each probe is separately opt-in. No permission prompts, network requests or hidden-value recovery. */
export type DetectionOptions = {
  fonts?: boolean;
  pageFonts?: boolean;
  runtime?: boolean;
  permissions?: boolean;
  targets?: boolean;
  focus?: boolean;
  decoy?: boolean;
};
export const FONT_PROBES = Object.freeze([
  "Arial",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Georgia",
  "Trebuchet MS",
  "Helvetica Neue",
  "Menlo",
  "Segoe UI",
  "Consolas",
  "Roboto",
  "Noto Sans",
]);
// A fixed, deliberately small sample, not a scan of global names or getters.
const MARKERS = [
  "_phantom",
  "callPhantom",
  "__nightmare",
  "domAutomation",
  "domAutomationController",
  "_Selenium_IDE_Recorder",
  "__webdriver_script_fn",
  "cdc_adoQpoasnfa76pfcZLmcfl_Array",
];
const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};
const DEADLINE_MS = 250;
async function bounded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(fn)
        .catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** local() resolves only locally available fonts. No FontFace is added to the page. */
async function collectFonts(): Promise<BrowserObservation["fonts"]> {
  return bounded(async () => {
    if (typeof FontFace !== "function") return undefined;
    const results = await Promise.all(
      FONT_PROBES.map(async (name) => {
        // Construction errors are unknown; a rejected local lookup is unavailable.
        const face = new FontFace("doorman-local-probe", `local("${name}")`);
        try {
          await face.load();
          return "1";
        } catch {
          return "0";
        }
      }),
    );
    return { version: "local-12-v1" as const, available: results.join("") };
  });
}
export async function collectDetectionSignals(
  options: DetectionOptions = {},
): Promise<BrowserObservation> {
  const environment: NonNullable<BrowserObservation["environment"]> = {};
  if (options.runtime) {
    const count = safe(
      () =>
        MARKERS.filter(
          (name) => Object.getOwnPropertyDescriptor(window, name) !== undefined,
        ).length,
    );
    if (count !== undefined) environment.runtimeMarkerCount = count;
    const own = safe(
      () =>
        Object.getOwnPropertyDescriptor(navigator, "webdriver") !== undefined,
    );
    if (own !== undefined) environment.webdriverOwnProperty = own;
  }
  if (options.pageFonts) {
    const counts = safe(() => {
      let visited = 0,
        loaded = 0,
        loading = 0,
        failed = 0;
      for (const face of document.fonts) {
        if (visited++ >= 100) break;
        if (face.status === "loaded") loaded++;
        if (face.status === "loading") loading++;
        if (face.status === "error") failed++;
      }
      return {
        pageFontsLoaded: loaded,
        pageFontsLoading: loading,
        pageFontsFailed: failed,
      };
    });
    Object.assign(environment, counts);
  }
  const [fonts] = await Promise.all([
    options.fonts ? collectFonts() : undefined,
    options.permissions
      ? bounded(async () => {
          // Neither API requests permission. Read only after query resolves, without retaining status/listeners.
          const status = await navigator.permissions.query({
            name: "notifications",
          });
          const permission = Notification.permission;
          if (["default", "granted", "denied"].includes(permission))
            environment.notificationPermission = permission;
          if (["prompt", "granted", "denied"].includes(status.state))
            environment.notificationQuery = status.state;
        })
      : undefined,
  ]);
  return {
    ...(fonts ? { fonts } : {}),
    ...(Object.keys(environment).length
      ? { environment: { ...environment } }
      : {}),
  };
}

/** Explicit inert test control. Hidden from rendering, tab order and the accessibility tree. */
export function createInteractionDecoy(container?: HTMLElement) {
  let count = 0;
  const button = safe(() => {
    const node = document.createElement("button");
    node.type = "button";
    node.hidden = true;
    node.inert = true;
    node.tabIndex = -1;
    node.setAttribute("aria-hidden", "true");
    node.dataset.doormanDecoy = "diagnostic";
    node.textContent = "Doorman diagnostic control";
    (container ?? document.body).append(node);
    return node;
  });
  const click = () => {
    count = Math.min(1_000_000, count + 1);
  };
  safe(() => button?.addEventListener("click", click));
  return {
    snapshot: () => ({ decoyActivationCount: count }),
    destroy() {
      safe(() => button?.removeEventListener("click", click));
      safe(() => button?.remove());
    },
  };
}

export function createDetectionTracker(options: DetectionOptions = {}) {
  const counts: Partial<BrowserBehavior> = {};
  const removers: (() => void)[] = [];
  const add = (target: EventTarget, name: string, fn: (e: Event) => void) => {
    const listener = (e: Event) => {
      safe(() => fn(e));
    };
    target.addEventListener(name, listener, { passive: true, capture: true });
    removers.push(() =>
      target.removeEventListener(name, listener, { capture: true }),
    );
  };
  const inc = (key: keyof BrowserBehavior) => {
    counts[key] = Math.min(1_000_000, (counts[key] ?? 0) + 1);
  };
  if (options.targets)
    safe(() => {
      Object.assign(counts, {
        targetSampleCount: 0,
        targetCenterCount: 0,
        targetCornerCount: 0,
      });
      add(document, "pointerdown", (e) => {
        const p = e as PointerEvent;
        if (
          p.pointerType !== "mouse" ||
          p.button !== 0 ||
          !(p.target instanceof Element)
        )
          return;
        // Read coordinates transiently only in this explicit mode. No selectors, text or target identities.
        const r = p.target.getBoundingClientRect();
        if (
          ![r.width, r.height, p.clientX, p.clientY, r.left, r.top].every(
            Number.isFinite,
          ) ||
          r.width < 16 ||
          r.height < 16
        )
          return;
        const x = (p.clientX - r.left) / r.width,
          y = (p.clientY - r.top) / r.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        inc("targetSampleCount");
        if (Math.abs(x - 0.5) <= 0.05 && Math.abs(y - 0.5) <= 0.05)
          inc("targetCenterCount");
        if (x <= 0.05 && y <= 0.05) inc("targetCornerCount");
      });
    });
  if (options.focus)
    safe(() => {
      Object.assign(counts, {
        focusChangeCount: 0,
        focusSampleCount: 0,
        unfocusedInputCount: 0,
      });
      for (const name of ["focus", "blur"])
        add(window, name, () => inc("focusChangeCount"));
      for (const name of ["pointerdown", "keydown"])
        add(document, name, () => {
          const focused = document.hasFocus();
          inc("focusSampleCount");
          if (!focused) inc("unfocusedInputCount");
        });
    });
  const decoy = options.decoy ? createInteractionDecoy() : undefined;
  return {
    snapshot: () => ({ ...counts, ...decoy?.snapshot() }),
    destroy() {
      removers.splice(0).forEach((fn) => safe(fn));
      decoy?.destroy();
    },
  };
}
