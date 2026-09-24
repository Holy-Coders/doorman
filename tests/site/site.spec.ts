import { test, expect } from "@playwright/test";
import catalog from "../../site/src/docs.json" with { type: "json" };

test("synthetic playground executes real matching without sending observations", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4357") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  await page.goto("/playground/");
  const result = page.locator("[data-result-json]");
  await expect(page.locator("[data-result-badge]")).toHaveText("Same visitor");
  const original = JSON.parse(await result.innerText()).visitorId;
  for (const label of [
    "Remove the cookie",
    "Update the browser",
    "Resize the window",
    "Change the timezone",
    "Hide WebGL signals",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled();
    expect(JSON.parse(await result.innerText()).visitorId).toBe(original);
  }
  await page.getByRole("button", { name: "Switch to another device" }).click();
  await expect(page.locator("[data-result-badge]")).toHaveText("New visitor");
  expect(JSON.parse(await result.innerText()).visitorId).not.toBe(original);
  expect(await page.context().cookies()).toEqual([]);
  expect(external).toEqual([]);
});

test("search, documentation navigation, keyboard tabs and copy controls work", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("tab", { name: "Cloudflare", exact: true }).click();
  await expect(page.locator("#code-1")).toBeVisible();
  await page
    .getByRole("tab", { name: "Cloudflare", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Next.js", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Copy Next.js example" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "createDoorman",
  );
  await page
    .getByRole("button", { name: "Search documentation", exact: true })
    .click();
  await page.getByRole("searchbox").fill("cross-device");
  await expect(page.locator("#search-results a").first()).toContainText(
    "Cross-device suggestions",
  );
  await page.getByRole("searchbox").fill("retention");
  await page
    .locator("#search-results")
    .getByRole("link", { name: /Storage & retention/ })
    .click();
  await expect(page).toHaveURL(/\/docs\/storage\/$/);
  await expect(
    page.getByRole("heading", { name: "Storage & retention", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy code block" }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "doorman.ready",
  );
});

for (const width of [390, 1440]) {
  test(`all primary pages render without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of [
      "/",
      "/playground/",
      ...catalog.flatMap((section) =>
        section.pages.map((entry) => `/docs/${entry.slug}/`),
      ),
    ]) {
      await page.goto(path);
      expect(await page.locator("main").count()).toBe(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("every internal navigation link and asset on the landing page resolves", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const links = await page
    .locator('a[href^="/"]')
    .evaluateAll((anchors) => [
      ...new Set(
        anchors.map((anchor) => anchor.getAttribute("href")!).filter(Boolean),
      ),
    ]);
  for (const path of [
    ...links,
    "/search-index.json",
    "/sitemap.xml",
    "/llms.txt",
    "/robots.txt",
    "/doorman-mark.png",
    "/doorman-logo.png",
    "/social.png",
    "/doorman-mark.webp",
    "/favicon.png",
    "/media/continuity-poster.webp",
    "/media/continuity.webm",
    "/media/continuity.mp4",
  ])
    expect((await request.get(path)).status(), path).toBe(200);
});

test("actor lab executes delegation checks for agents, family and invalid grants locally", async ({
  page,
}) => {
  await page.goto("/playground/");
  const lab = page.locator("[data-actor-lab]");
  await expect(lab.locator("[data-actor-verdict]")).toHaveText(
    "Same principal",
  );
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await lab.getByText("Inspect the actual response", { exact: false }).click();
  const result = async () =>
    JSON.parse((await lab.locator("[data-actor-json]").textContent())!);
  const subject = (await result()).subject.id;
  for (const [button, actor, status, reason] of [
    ["Your AI assistant", "agent", "valid", undefined],
    ["A family member", "person", "valid", undefined],
    ["Revoke the grant", "agent", "invalid", "revoked"],
    ["Request another scope", "agent", "invalid", "scope"],
    ["Let the grant expire", "agent", "invalid", "expired"],
    ["An unknown actor", "unknown", "none", undefined],
  ] as const) {
    await lab.getByRole("button", { name: button, exact: false }).click();
    await expect(
      lab.getByRole("button", { name: button, exact: false }),
    ).toBeEnabled();
    const response = await result();
    expect(response.subject.id).toBe(subject);
    expect(response.actor.kind).toBe(actor);
    expect(response.delegation.status).toBe(status);
    expect(response.delegation.reason).toBe(reason);
  }
  expect(requests).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});

test("pixel actors animate, support keyboard selection and pause for reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const stage = page.locator("[data-doorway]");
  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-ready", "true");
  await expect(stage).toHaveAttribute("data-animating", "true");
  await expect(stage).toHaveAttribute("data-phase", "formed");
  const actors = page.getByRole("group", {
    name: "Choose an illustrated operator",
  });
  await actors.getByRole("button", { name: "A robot", exact: true }).click();
  await expect(stage).toHaveAttribute("data-actor", "robot");
  await actors
    .getByRole("button", { name: "A robot", exact: true })
    .press("ArrowRight");
  await expect(
    actors.getByRole("button", { name: "An AI assistant", exact: true }),
  ).toBeFocused();
  await expect(stage).toHaveAttribute("data-actor", "assistant");
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await expect(stage).toHaveAttribute("data-animating", "false");
  const pixels = () =>
    page
      .locator("[data-doorway-canvas]")
      .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  const paused = await pixels();
  await page.waitForTimeout(150);
  expect(await pixels()).toBe(paused);
  await page.getByRole("button", { name: "Play motion", exact: true }).click();
  await expect(stage).toHaveAttribute("data-animating", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Reduced motion", exact: true }),
  ).toBeDisabled();
  await expect(stage).toHaveAttribute("data-animating", "false");
  await expect(stage).toHaveAttribute("data-phase", "formed");
  await page
    .getByRole("button", { name: "Your AI assistant", exact: false })
    .click();
  await expect(page.locator("[data-actor-verdict]")).toHaveText(
    "Valid delegation",
  );
  expect(
    await page
      .locator(".actor-node")
      .evaluateAll(
        (nodes) =>
          nodes
            .flatMap((node) => node.getAnimations())
            .filter((animation) => animation.playState === "running").length,
      ),
  ).toBe(0);
});

for (const mode of ["reduced motion", "save data"] as const) {
  test(`${mode} keeps the pixel illustration static and interactive`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: mode === "reduced motion" ? "reduce" : "no-preference",
    });
    if (mode === "save data")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "connection", {
          value: Object.assign(new EventTarget(), { saveData: true }),
          configurable: true,
        }),
      );
    const network: string[] = [];
    page.on("request", (req) => {
      if (/\.(webm|mp4)(?:\?|$)/.test(req.url()) || req.method() === "POST")
        network.push(req.url());
    });
    await page.goto("/");
    const stage = page.locator("[data-doorway]");
    await expect(stage).toHaveAttribute("data-ready", "true");
    await expect(stage).toHaveAttribute("data-animating", "false");
    await expect(stage).toHaveAttribute("data-phase", "formed");
    await page
      .getByRole("button", { name: "Another human", exact: true })
      .click();
    await expect(stage).toHaveAttribute("data-actor", "another");
    await expect(stage).toHaveAttribute("data-phase", "formed");
    expect(network).toEqual([]);
    if (mode === "save data") {
      await page
        .getByRole("button", { name: "Play motion", exact: true })
        .click();
      await expect(stage).toHaveAttribute("data-animating", "true");
    }
  });
}

test("canvas pauses offscreen and the page survives an unavailable canvas", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const stage = page.locator("[data-doorway]");
  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-animating", "true");
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-animating", "false");
  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-animating", "true");
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.reload();
  await expect(page.locator(".doorway-fallback")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start building", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search documentation", exact: true })
    .click();
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("the hero stays readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4357/");
  await expect(
    page.getByRole("heading", { name: /Know who’s\s*behind the request/ }),
  ).toBeVisible();
  await expect(page.locator(".doorway-fallback")).toBeVisible();
  await expect(page.locator("[data-motion-toggle]")).toBeHidden();
  await context.close();
});

test("new readers can follow introduction, first example and identity concepts", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Documentation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/introduction\/$/);
  await expect(
    page.getByRole("heading", { name: "What is Doorman?", exact: true }),
  ).toBeVisible();
  await page
    .locator(".sidebar-section")
    .getByRole("link", { name: "Your first visitor ID", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1. Get the example", exact: true }),
  ).toBeVisible();
  await page
    .locator(".sidebar-section")
    .getByRole("link", { name: "Browsers, people & agents", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "One example, three IDs", exact: true }),
  ).toBeVisible();
});

test("all documentation links and local section anchors resolve", async ({
  page,
  request,
}) => {
  const index: { url: string }[] = [];
  for (const suffix of ["", "-elixir", "-python", "-go"]) {
    index.push(
      ...(await (await request.get(`/search-index${suffix}.json`)).json()),
    );
  }
  const destinations = new Map<string, Set<string>>();
  for (const entry of index) {
    await page.goto(entry.url);
    const links = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors
        .map((a) => new URL(a.getAttribute("href")!, location.href))
        .filter((url) => url.origin === location.origin)
        .map((url) => ({ path: url.pathname, hash: url.hash })),
    );
    for (const { path, hash } of links) {
      const hashes = destinations.get(path) ?? new Set<string>();
      if (hash) hashes.add(decodeURIComponent(hash.slice(1)));
      destinations.set(path, hashes);
    }
  }
  for (const [path, hashes] of destinations) {
    expect((await request.get(path)).status(), path).toBe(200);
    if (hashes.size) {
      await page.goto(path);
      for (const hash of hashes) {
        expect(
          await page.evaluate((id) => !!document.getElementById(id), hash),
          `${path}#${hash}`,
        ).toBe(true);
      }
    }
  }
});

for (const theme of ["light", "dark"]) {
  test(`theme ${theme} and language selection persist without changing unrelated controls`, async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: theme as "light" | "dark",
      reducedMotion: "reduce",
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#hero-title")).toHaveText(
      /Know who’s\s*behind the request/,
    );
    await expect(page.locator("#analytics-title")).toHaveText(
      /Prepare your analytics/,
    );
    const languagePicker = page.getByRole("combobox", {
      name: "Documentation language",
    });
    await expect(languagePicker).toHaveCount(0);
    const next = theme === "light" ? "dark" : "light";
    await page.getByRole("button", { name: `Switch to ${next} mode` }).click();
    await page.goto("/playground/");
    await expect(languagePicker).toHaveCount(0);
    await page.goto("/docs/getting-started/");
    await languagePicker.selectOption("elixir");
    await expect(page).toHaveURL(/\/docs\/elixir\/getting-started\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", next);
    await page.locator('.docs-sidebar a[href$="/api/"]').click();
    await expect(page.locator("article")).toContainText("Doorman.new/1");
    await page
      .getByRole("combobox", { name: "Documentation language" })
      .selectOption("python");
    await expect(page).toHaveURL(/\/docs\/python\/api\/$/);
    await expect(page.locator("article")).toContainText("Python client");
    await page
      .getByRole("button", { name: "Search documentation", exact: true })
      .click();
    await page.getByRole("searchbox").fill("cookie");
    await expect(page.locator("#search-results a").first()).toHaveAttribute(
      "href",
      /^\/docs\/python\//,
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto("/docs/go/languages/");
    await expect(page.getByRole("combobox")).toHaveValue("go");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("#theme-icon")).toHaveAttribute(
      "href",
      next === "light" ? "/doorman-mark-dark.png" : "/doorman-mark.png",
    );
  });
}

test("public docs exclude archived training workflows and use the current API", async ({
  request,
}) => {
  const retired = new Set([
    "classifier",
    "classifier-research",
    "network-learning",
    "network-client",
    "operator-attribution",
    "trust",
  ]);
  for (const language of ["", "elixir", "python", "go"]) {
    const suffix = language ? `-${language}` : "";
    const response = await request.get(`/search-index${suffix}.json`);
    expect(response.ok()).toBe(true);
    const entries = (await response.json()) as { url: string; text: string }[];
    for (const entry of entries) {
      expect(retired.has(entry.url.split("/").filter(Boolean).at(-1)!)).toBe(
        false,
      );
      expect(entry.text).not.toMatch(
        /createNodeVisitor|createCloudflareVisitor|createVercelVisitor|Doorman\.Migration\./,
      );
    }
    const prefix = language ? `${language}/` : "";
    expect((await request.get(`/docs/${prefix}classifier/`)).status()).toBe(
      404,
    );
  }
  const api = await (await request.get("/docs/api/")).text();
  expect(api).toContain("createDoorman");
  expect(api).not.toContain("createNodeVisitor");
});
