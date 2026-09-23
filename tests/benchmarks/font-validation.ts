/** Same-host environmental controls; fresh browser contexts are not distinct people. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import type { BrowserObservation } from "@janitor/core";
type Fixture = Window & { capture: () => Promise<BrowserObservation> };
const server = createServer((req, res) => {
  const file =
    req.url === "/collector.js"
      ? "artifacts/browser-benchmark/collector.js"
      : req.url === "/app.woff2"
        ? "site/node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2"
        : undefined;
  if (file)
    void readFile(file)
      .then((b) =>
        res
          .writeHead(200, {
            "Content-Type": file.endsWith("woff2")
              ? "font/woff2"
              : "text/javascript",
          })
          .end(b),
      )
      .catch(() => res.writeHead(500).end());
  else
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        `<!doctype html><title>Janitor font controls</title><script type="module">import{collectDetectionSignals}from'/collector.js';window.capture=()=>collectDetectionSignals({fonts:true,pageFonts:true,permissions:true});</script>`,
      );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const rows = [];
try {
  for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch(
      engine === "chromium"
        ? { executablePath: chromium.executablePath() }
        : {},
    );
    const masks: string[] = [];
    let nonlocalRequests = 0;
    try {
      for (let i = 0; i < 6; i++) {
        const context = await browser.newContext({
          locale: i % 2 ? "he-IL" : "en-US",
          timezoneId: i % 2 ? "Asia/Jerusalem" : "UTC",
          viewport:
            i % 2 ? { width: 640, height: 800 } : { width: 1280, height: 720 },
        });
        try {
          await context.route("**/*", (route) => {
            if (new URL(route.request().url()).origin !== origin) {
              nonlocalRequests++;
              return route.abort();
            }
            return route.continue();
          });
          const page = await context.newPage();
          await page.goto(origin);
          await page.waitForFunction(
            () => typeof (window as unknown as Fixture).capture === "function",
          );
          const capture = () =>
            page.evaluate(() => (window as unknown as Fixture).capture());
          const before = await capture();
          await page.evaluate(async () => {
            const face = new FontFace(
              "JanitorDownloadFixture",
              "url(/app.woff2)",
            );
            document.fonts.add(face);
            await face.load();
          });
          const downloaded = await capture();
          assert.equal(downloaded.environment?.pageFontsLoaded, 1);
          assert.deepEqual(
            before.fonts,
            downloaded.fonts,
            "App font download must not change fixed local font probe",
          );
          if (before.fonts) masks.push(before.fonts.available);
          let permissionGrantSupported = true;
          try {
            await context.grantPermissions(["notifications"], { origin });
          } catch {
            permissionGrantSupported = false;
          }
          const granted = await capture();
          await context.clearPermissions();
          const reset = await capture();
          rows.push({
            engine,
            context: i,
            fontProbeAvailable: !!before.fonts,
            downloadedFontCount: downloaded.environment?.pageFontsLoaded,
            localFontsUnchangedAfterDownload: true,
            permissionGrantSupported,
            permissions: {
              initial: before.environment,
              granted: granted.environment,
              reset: reset.environment,
            },
          });
        } finally {
          await context.close();
        }
      }
      rows.push({
        engine,
        contexts: 6,
        measuredFontMasks: masks.length,
        distinctFontMasks: new Set(masks).size,
        nonlocalRequests,
      });
      assert.equal(nonlocalRequests, 0);
    } finally {
      await browser.close();
    }
  }
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    contexts: 18,
    hostCount: 1,
    rows,
    limitations: [
      "Same host and installed fonts; fresh contexts are not independent physical devices or people.",
      "Successful permission overrides are test controls, not an enterprise-policy or real-user permission study.",
      "No detection accuracy, cross-device identity or local-font inventory bypass established.",
    ],
    productionPromoted: false,
  };
  await writeFile(
    "artifacts/browser-benchmark/font-validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
