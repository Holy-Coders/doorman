import {
  createVisitorEngine,
  createVisitorId,
  normalizeObservation,
} from "@aarondovturkel/doorman-core";
import type {
  BrowserObservation,
  NormalizedObservation,
  VisitorStorage,
} from "@aarondovturkel/doorman-core";
const base: BrowserObservation = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  platform: "MacIntel",
  languages: ["en-US", "he"],
  timezone: "Asia/Jerusalem",
  screen: { width: 1440, height: 900, colorDepth: 24, pixelRatio: 2 },
  viewport: { width: 1280, height: 720 },
  hardware: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 },
  graphics: { webglVendor: "WebKit", webglRenderer: "WebKit WebGL" },
  automation: { webdriver: false },
};
const phone: BrowserObservation = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  languages: ["en-US"],
  timezone: "Asia/Jerusalem",
  screen: { width: 390, height: 844, pixelRatio: 3 },
  viewport: { width: 390, height: 700 },
  hardware: { hardwareConcurrency: 6, maxTouchPoints: 5 },
  graphics: { webglVendor: "WebKit", webglRenderer: "WebKit WebGL" },
};
const explanations: Record<string, string> = {
  cookie:
    "The retained cookie identifies the visitor. No global candidate search is needed.",
  clear:
    "The cookie is gone. Strong historical similarity restores the same visitor ID.",
  update:
    "Browser versions change; the normalized family stays familiar. Identity is restored.",
  resize:
    "The viewport changed. Its small weight preserves a strong historical match.",
  timezone:
    "The timezone changed. Confidence dips, but the remaining evidence is strong.",
  webgl:
    "Hidden WebGL values are missing evidence, not a mismatch. Identity is restored.",
  device:
    "A different platform and hardware environment contradict the saved history. A new ID is created.",
};
function createMemoryStorage(originalId: string): VisitorStorage {
  const rows = new Map<string, NormalizedObservation[]>([
    [originalId, [normalizeObservation(base)]],
  ]);
  return {
    async findCandidates(_observation, limit) {
      return [...rows.keys()]
        .slice(0, limit)
        .map((visitorId) => ({ visitorId, lastSeenAt: Date.now() }));
    },
    async getRecentObservations(id, limit) {
      return rows.get(id)?.slice(-limit).reverse() ?? [];
    },
    async createVisitor() {
      const id = createVisitorId();
      rows.set(id, []);
      return id;
    },
    async saveObservation(id, observation) {
      rows.get(id)?.push(observation);
    },
    async touchVisitor() {},
  };
}
document.querySelectorAll<HTMLElement>("[data-playground]").forEach((lab) => {
  const originalId = createVisitorId();
  const buttons = Array.from(
    lab.querySelectorAll<HTMLButtonElement>("[data-scenario]"),
  );
  const set = (selector: string, value: string) => {
    const element = lab.querySelector(selector);
    if (element) element.textContent = value;
  };
  async function run(scenario: string) {
    buttons.forEach((button) => {
      button.disabled = true;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scenario === scenario),
      );
    });
    const signals = structuredClone(scenario === "device" ? phone : base);
    if (scenario === "update")
      signals.userAgent = base.userAgent?.replace("130.0", "131.1");
    if (scenario === "resize") signals.viewport = { width: 450, height: 600 };
    if (scenario === "timezone") signals.timezone = "Europe/London";
    if (scenario === "webgl") delete signals.graphics;
    try {
      const engine = createVisitorEngine({
        storage: createMemoryStorage(originalId),
      });
      const identity = await engine.identify({
        signals,
        visitorId: scenario === "cookie" ? originalId : undefined,
      });
      set(
        "[data-result-id]",
        identity.visitorId.slice(0, 12) + "…" + identity.visitorId.slice(-5),
      );
      set(
        "[data-result-badge]",
        identity.isReturning ? "Same visitor" : "New visitor",
      );
      lab
        .querySelector("[data-result-badge]")
        ?.classList.toggle("new-visitor", !identity.isReturning);
      set("[data-result-explanation]", explanations[scenario] ?? "");
      set("[data-confidence-label]", identity.confidence.toFixed(2));
      const bar = lab.querySelector<HTMLElement>("[data-confidence-bar]");
      if (bar) bar.style.width = `${identity.confidence * 100}%`;
      set(
        "[data-device-label]",
        scenario === "device" ? "Safari on iOS" : "Chrome on macOS",
      );
      set(
        "[data-screen-label]",
        scenario === "device" ? "390 × 844 · 6 cores" : "1440 × 900 · 8 cores",
      );
      set(
        "[data-result-json]",
        JSON.stringify(
          { ...identity, confidence: Number(identity.confidence.toFixed(4)) },
          null,
          2,
        ),
      );
    } catch {
      set(
        "[data-result-explanation]",
        "The simulation could not run. Reload this page to try again.",
      );
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  }
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      void run(button.dataset.scenario ?? "cookie");
    }),
  );
  void run("cookie");
});
