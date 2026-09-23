/** Local, controlled probe experiments. No population inference and no external model calls. */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "@playwright/test";
import type { BrowserBehavior, BrowserObservation } from "@janitor/core";
import { calculateSimilarity } from "@janitor/core";

type Sample = {
  signals: BrowserObservation;
  behavior: BrowserBehavior;
  timingMs: number;
};
type Harness = Window & {
  capture: () => Promise<Sample>;
  tracker: { snapshot: () => BrowserBehavior; destroy: () => void };
};
const token = crypto.randomUUID();
let deliver: ((sample: Sample) => void) | undefined;
const script = `import {collectBrowserSignals,collectDetectionSignals,createBehaviorTracker} from '/collector.js';
const detection={fonts:true,pageFonts:true,runtime:true,permissions:true,targets:true,focus:true,decoy:true};
window.tracker=createBehaviorTracker({extended:true,detection});
window.capture=async()=>{const start=performance.now();for(let i=0;i<1000;i++)Object.getOwnPropertyDescriptor(navigator,'webdriver');const timingMs=Math.round((performance.now()-start)*10)/10;return {signals:{...collectBrowserSignals(),...await collectDetectionSignals(detection)},behavior:tracker.snapshot(),timingMs};};
if(location.pathname==='/native')for(let i=0;i<5;i++){await fetch('/native-result?token=${token}',{method:'POST',body:JSON.stringify(await capture())});}`;
const server = createServer((req, res) => {
  if (req.url === `/native-result?token=${token}` && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
      if (body.length > 16_384) req.destroy();
    });
    req.on("end", () => {
      try {
        deliver?.(JSON.parse(body));
        res.end("ok");
      } catch {
        res.writeHead(400).end();
      }
    });
  } else if (req.url === "/collector.js") {
    void readFile("artifacts/browser-benchmark/collector.js")
      .then((body) =>
        res.writeHead(200, { "Content-Type": "text/javascript" }).end(body),
      )
      .catch(() => res.writeHead(500).end());
  } else if (req.url === "/missing.woff2") res.writeHead(404).end();
  else
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        `<!doctype html><title>Local detection experiment</title><button id="visible" style="width:200px;height:100px">Test</button><script type="module">${script}</script>`,
      );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const rows: Record<string, unknown>[] = [];
const versions: Record<string, string> = {};
const jevCases: { engine: string; scenario: string; sample: Sample }[] = [];
try {
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch(
      name === "chromium" ? { executablePath: chromium.executablePath() } : {},
    );
    versions[name] = browser.version();
    try {
      const page = await browser.newPage();
      let nonlocalRequests = 0;
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          nonlocalRequests++;
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(origin);
      const capture = async () => {
        await page.waitForFunction(
          () => typeof (window as unknown as Harness).capture === "function",
        );
        return page.evaluate(() => (window as unknown as Harness).capture());
      };
      const baseline = await capture();
      jevCases.push({ engine: name, scenario: "baseline", sample: baseline });
      await page.reload();
      const repeated = await capture();
      const beforeScreenshot = repeated.behavior;
      for (let i = 0; i < 20; i++) await page.screenshot(); // Not saved; no real user page.
      const afterScreenshot = await capture();
      const screenshotFocusChanges =
        (afterScreenshot.behavior.focusChangeCount ?? 0) -
        (beforeScreenshot.focusChangeCount ?? 0);
      const screenshotVisibilityChanges =
        afterScreenshot.behavior.visibilityChangeCount -
        beforeScreenshot.visibilityChangeCount;
      for (let i = 0; i < 12; i++) await page.locator("#visible").click();
      const centers = await capture();
      jevCases.push({
        engine: name,
        scenario: "centered-script",
        sample: centers,
      });
      assert.equal(centers.behavior.targetSampleCount, 12);
      assert.equal(centers.behavior.targetCenterCount, 12);
      for (let i = 0; i < 12; i++) await page.keyboard.press("Enter");
      const keyboard = await capture();
      jevCases.push({
        engine: name,
        scenario: "keyboard-script",
        sample: keyboard,
      });
      assert.equal(
        keyboard.behavior.targetSampleCount,
        12,
        "keyboard clicks are not mouse alignment samples",
      );
      assert.equal(
        await page.locator("[data-janitor-decoy]").isVisible(),
        false,
      );
      assert(
        !(await page.locator("body").ariaSnapshot()).includes(
          "Janitor diagnostic",
        ),
      );
      assert.equal(keyboard.behavior.decoyActivationCount, 0);
      await page
        .locator("[data-janitor-decoy]")
        .evaluate((node) => (node as HTMLElement).click());
      assert.equal((await capture()).behavior.decoyActivationCount, 1);
      await page.evaluate(async () => {
        const font = new FontFace("JanitorWebFont", "url(/missing.woff2)");
        document.fonts.add(font);
        try {
          await font.load();
        } catch {
          /* A failed app font is ordinary, not automation. */
        }
      });
      const failedDownload = await capture();
      jevCases.push({
        engine: name,
        scenario: "failed-app-font",
        sample: failedDownload,
      });
      assert.equal(failedDownload.signals.environment?.pageFontsFailed, 1);
      await page.evaluate(() => {
        Object.defineProperty(window, "_phantom", {
          configurable: true,
          get() {
            throw Error("do not invoke");
          },
        });
      });
      const marked = await capture();
      jevCases.push({
        engine: name,
        scenario: "injected-test-marker",
        sample: marked,
      });
      assert.equal(marked.signals.environment?.runtimeMarkerCount, 1);
      await page.evaluate(() => {
        Object.defineProperty(window, "FontFace", {
          value: undefined,
          configurable: true,
        });
      });
      const missing = await capture();
      jevCases.push({
        engine: name,
        scenario: "unavailable-font-api",
        sample: missing,
      });
      assert.equal(missing.signals.fonts, undefined);
      await page.evaluate(() =>
        (window as unknown as Harness).tracker.destroy(),
      );
      const stopped = await page.evaluate(() =>
        (window as unknown as Harness).tracker.snapshot(),
      );
      await page.locator("#visible").click();
      const after = await page.evaluate(() =>
        (window as unknown as Harness).tracker.snapshot(),
      );
      assert.equal(after.targetSampleCount, stopped.targetSampleCount);
      assert.equal(await page.locator("[data-janitor-decoy]").count(), 0);
      assert.equal(nonlocalRequests, 0);
      rows.push({
        engine: name,
        repeatedFontProbeEqual:
          JSON.stringify(baseline.signals.fonts) ===
          JSON.stringify(repeated.signals.fonts),
        fontProbeAvailable: !!baseline.signals.fonts,
        matchedFontSimilarity:
          calculateSimilarity(baseline.signals, repeated.signals).features
            .fontSimilarity ?? null,
        screenshotCaptures: 20,
        screenshotFocusChanges,
        screenshotVisibilityChanges,
        centeredMouseSamples: centers.behavior.targetSampleCount,
        keyboardAddedMouseSamples: 0,
        inertDecoyHiddenFromAccessibilityTree: true,
        normalDecoyActivations: 0,
        scriptedDecoyActivations: 1,
        fontDownloadFailureCount:
          failedDownload.signals.environment?.pageFontsFailed,
        unavailableFontApiOmitted: true,
        listenersAndDecoyRemoved: true,
        nonlocalRequests,
        runtimeTimingMs: [
          baseline.timingMs,
          repeated.timingMs,
          afterScreenshot.timingMs,
          centers.timingMs,
          keyboard.timingMs,
        ],
        runtimeMarkerCount: baseline.signals.environment?.runtimeMarkerCount,
      });
    } finally {
      await browser.close();
    }
  }
  // Same Chromium executable without a debugging port/pipe or Playwright connection.
  // Still headless, not a human baseline or evidence of an uninstrumented physical user.
  const profile = await mkdtemp(join(tmpdir(), "janitor-no-cdp-"));
  const native: Sample[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const received = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(Error("Native control timed out")), 20_000);
    deliver = (sample) => {
      native.push(sample);
      if (native.length === 5) resolve();
    };
  });
  const child = spawn(
    chromium.executablePath(),
    [
      "--headless",
      "--use-mock-keychain",
      "--password-store=basic",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-features=HttpsUpgrades",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--user-data-dir=${profile}`,
      `${origin}/native`,
    ],
    { stdio: "ignore" },
  );
  try {
    await received;
    rows.push({
      engine: "chromium-without-cdp",
      captures: native.length,
      runtimeTimingMs: native.map((s) => s.timingMs),
      runtimeMarkerCounts: native.map(
        (s) => s.signals.environment?.runtimeMarkerCount,
      ),
      repeatedFontProbeEqual: native.every(
        (s) =>
          JSON.stringify(s.signals.fonts) ===
          JSON.stringify(native[0]!.signals.fonts),
      ),
    });
  } catch {
    rows.push({
      engine: "chromium-without-cdp",
      status: "unavailable",
      captures: native.length,
      reason:
        "Control did not complete within 20 seconds; no CDP timing conclusion is supported",
    });
  } finally {
    clearTimeout(timer);
    deliver = undefined;
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else {
        const force = setTimeout(() => child.kill("SIGKILL"), 3000);
        child.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
      }
    });
    await rm(profile, { recursive: true, force: true });
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const report = {
  generatedAt: new Date().toISOString(),
  kind: "controlled-experimental-probes",
  hostCount: 1,
  versions,
  newJevCalls: 0,
  limitations: [
    "All browser interactions are scripted, with no independently labeled humans or assistant brands",
    "Headless CDP/no-CDP controls differ in launch defaults and do not isolate every confounder",
    "Runtime timing is an experiment only, excluded from collector and scoring",
    "Same-host fonts do not identify a person or establish cross-device identity",
    "No accuracy claim for new features: third-party datasets do not contain these new probes",
    "No CDP or screenshot detection rule is promoted",
  ],
  rows,
};
await mkdir("docs/benchmarks", { recursive: true });
await writeFile(
  "artifacts/browser-benchmark/experimental-probes-validation.json",
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  "artifacts/browser-benchmark/jev-cases.json",
  JSON.stringify(jevCases),
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
