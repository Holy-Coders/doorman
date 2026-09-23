import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStorage } from "@janitor/storage-postgres";
import { createVisitorEngine, normalizeObservation } from "@janitor/core";
import type { BrowserObservation, BrowserBehavior } from "@janitor/core";

type Capture = { signals: BrowserObservation; behavior: BrowserBehavior };
type Sample = Capture & { engine: string; profile: string; scenario: string };
type CollectorWindow = Window & { capture: () => Capture };
const samples: Sample[] = [];
const versions: Record<string, string> = {};
const server = createServer((request, response) => {
  if (request.url === "/collector.js") {
    void readFile(
      new URL(
        "../../artifacts/browser-benchmark/collector.js",
        import.meta.url,
      ),
    )
      .then((body) => {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.end(body);
      })
      .catch(() => {
        response.writeHead(500);
        response.end();
      });
  } else {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      `<!doctype html><title>Janitor controlled benchmark</title><style>body{height:4000px}</style><button>Test interaction</button><script type="module">import{collectBrowserSignals,createBehaviorTracker}from'/collector.js';const tracker=createBehaviorTracker({extended:true});window.capture=()=>({signals:collectBrowserSignals(),behavior:tracker.snapshot()});</script>`,
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Missing local address");
const origin = `http://127.0.0.1:${address.port}`;
const capture = async (page: Page) => {
  await page.waitForFunction(
    () => typeof (window as unknown as CollectorWindow).capture === "function",
  );
  return page.evaluate(() => (window as unknown as CollectorWindow).capture());
};
try {
  for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch();
    versions[engine] = browser.version();
    try {
      for (const suffix of ["a", "b"]) {
        const profile = `${engine}-${suffix}`;
        const options = {
          locale: "en-US",
          timezoneId: "UTC",
          viewport: { width: 1280, height: 720 },
          screen: { width: 1440, height: 900 },
        };
        const context = await browser.newContext(options);
        try {
          const page = await context.newPage();
          await page.goto(origin);
          const save = async (scenario: string) =>
            samples.push({
              engine,
              profile,
              scenario,
              ...(await capture(page)),
            });
          await save("baseline");
          await page.reload();
          await save("reload");
          for (let i = 0; i < 12; i++) {
            await page.mouse.move(60 + i * 15, 100 + (i % 3) * 20, {
              steps: 3,
            });
            if (i % 4 === 0) await page.keyboard.press("Tab");
          }
          await page.mouse.wheel(0, 180);
          await page.waitForTimeout(100);
          await page.mouse.wheel(0, -100);
          await page.waitForTimeout(100);
          await save("scripted-interaction");
          await page.setViewportSize({ width: 640, height: 800 });
          await save("resize");
          const state = await context.storageState();
          const traveled = await browser.newContext({
            ...options,
            timezoneId: "Asia/Tokyo",
            storageState: state,
          });
          try {
            const p = await traveled.newPage();
            await p.goto(origin);
            samples.push({
              engine,
              profile,
              scenario: "timezone-emulation",
              ...(await capture(p)),
            });
          } finally {
            await traveled.close();
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

const db = new PGlite();
const trials: {
  cohort: string;
  engine: string;
  scenario: string;
  result: "correct-restoration" | "wrong-restoration" | "new-id";
  confidence: number;
}[] = [];
try {
  await db.exec(
    await readFile(
      new URL(
        "../../packages/storage/postgres/migrations/0001_visitors.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const storage = createPostgresStorage(db);
  const engine = createVisitorEngine({ storage });
  const baselines = samples.filter((sample) => sample.scenario === "baseline");
  async function trial(
    cohort: string,
    seed: Sample[],
    query: Sample,
    cookie = false,
  ) {
    await db.exec(
      "TRUNCATE TABLE observations, visitors RESTART IDENTITY CASCADE",
    );
    const ids = new Map<string, string>();
    for (const sample of seed) {
      const id = await storage.createVisitor();
      ids.set(sample.profile, id);
      await storage.saveObservation(
        id,
        normalizeObservation(sample.signals, sample.behavior),
      );
    }
    const identity = await engine.identify({
      signals: query.signals,
      behavior: query.behavior,
      ...(cookie ? { visitorId: ids.get(query.profile) } : {}),
    });
    trials.push({
      cohort,
      engine: query.engine,
      scenario: query.scenario,
      result: identity.isReturning
        ? identity.visitorId === ids.get(query.profile)
          ? "correct-restoration"
          : "wrong-restoration"
        : "new-id",
      confidence: identity.confidence,
    });
  }
  for (const sample of samples.filter((s) => s.scenario !== "baseline")) {
    const own = baselines.find((b) => b.profile === sample.profile)!;
    await trial("isolated-return", [own], sample);
    await trial("cookie-continuity", baselines, sample, true);
    await trial("ambiguous-pool", baselines, sample);
  }
  for (const sample of baselines) {
    const other = baselines.find(
      (b) => b.engine === sample.engine && b.profile !== sample.profile,
    )!;
    await trial("unseen-identical-profile", [other], sample);
  }
  const cohorts = Object.fromEntries(
    [...new Set(trials.map((t) => t.cohort))].map((cohort) => {
      const rows = trials.filter((t) => t.cohort === cohort);
      return [
        cohort,
        {
          total: rows.length,
          correctRestorations: rows.filter(
            (r) => r.result === "correct-restoration",
          ).length,
          wrongRestorations: rows.filter(
            (r) => r.result === "wrong-restoration",
          ).length,
          newIds: rows.filter((r) => r.result === "new-id").length,
        },
      ];
    }),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    kind: "controlled-real-browser",
    hostCount: 1,
    logicalProfiles: baselines.length,
    observations: samples.length,
    versions,
    evaluator: "disabled",
    riskAccuracy:
      "not evaluated: all sessions automated; no human labels or AI inference",
    emulation: ["viewport", "screen", "locale", "timezone"],
    limitations: [
      "Same host and browser build per engine, not a population or longitudinal benchmark",
      "Ground truth is isolated test profile, not separate person or physical device",
      "Timezone scenario recreates a context with copied storage state",
      "Unseen identical profiles expose non-identifiability from these signals",
      "No browser-version update or mobile hardware was measured",
    ],
    cohorts,
    trials,
  };
  const output = new URL("../../artifacts/benchmarks/", import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(
    new URL("observations.json", output),
    JSON.stringify(samples, null, 2),
  );
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { observations: samples.length, versions, cohorts },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
