import type { BrowserObservation } from "@janitor/core";
export const signals: BrowserObservation = {
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
export const phone: BrowserObservation = {
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
export const evaluation = {
  sameVisitor: 0.99,
  automation: 0.12,
  suspicious: 0.08,
};
