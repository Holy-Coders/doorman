import { test, expect } from "@playwright/test";

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
    "createVercelVisitor",
  );
  await page
    .getByRole("button", { name: "Search documentation", exact: true })
    .click();
  await page.getByRole("searchbox").fill("learning");
  await expect(page.locator("#search-results a").first()).toContainText(
    "Learn from later logins",
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
    "wrangler d1",
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
      "/docs/introduction/",
      "/docs/concepts/",
      "/docs/getting-started/",
      "/docs/api/",
      "/docs/learning/",
      "/docs/review/",
      "/docs/cloudflare/",
      "/docs/nextjs/",
      "/docs/node/",
      "/docs/elixir/",
      "/docs/phoenix-example/",
      "/docs/analytics/",
      "/docs/languages/",
      "/docs/trust/",
      "/docs/evaluation/",
      "/docs/security/",
      "/docs/hardening/",
      "/docs/capacity/",
      "/docs/scaling/",
      "/docs/research/",
      "/docs/matching/",
      "/docs/evaluators/",
      "/docs/storage/",
      "/docs/privacy/",
      "/docs/validation/",
      "/docs/extensions/",
      "/docs/benchmarks/",
      "/docs/agent-classification/",
      "/docs/scoring/",
      "/docs/operator-attribution/",
      "/docs/external-benchmarks/",
      "/docs/agentic-identity/",
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
    "/janitor-mark.svg",
    "/janitor-logo.png",
    "/social.png",
    "/janitor-mark.webp",
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

test("motion can be paused and follows reduced-motion preference without disabling the labs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const film = page.locator("[data-hero-video]");
  await expect(film).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() => film.evaluate((el) => !(el as HTMLVideoElement).paused))
    .toBe(true);
  const start = await film.evaluate(
    (el) => (el as HTMLVideoElement).currentTime,
  );
  await expect
    .poll(() => film.evaluate((el) => (el as HTMLVideoElement).currentTime))
    .toBeGreaterThan(start);

  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await expect
    .poll(() => film.evaluate((el) => (el as HTMLVideoElement).paused))
    .toBe(true);
  await page.getByRole("button", { name: "Play motion", exact: true }).click();
  await expect
    .poll(() => film.evaluate((el) => !(el as HTMLVideoElement).paused))
    .toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Reduced motion", exact: true }),
  ).toBeDisabled();
  await expect(film).toBeHidden();
  await expect
    .poll(() => film.evaluate((el) => (el as HTMLVideoElement).paused))
    .toBe(true);
  await page
    .getByRole("button", { name: "Your AI assistant", exact: false })
    .click();
  await expect(page.locator("[data-actor-verdict]")).toHaveText(
    "Valid delegation",
  );
  const running = await page
    .locator(".actor-node")
    .evaluateAll(
      (nodes) =>
        nodes
          .flatMap((node) => node.getAnimations())
          .filter((animation) => animation.playState === "running").length,
    );
  expect(running).toBe(0);
});

for (const mode of ["reduced motion", "save data"] as const) {
  test(`${mode} uses the poster without downloading video`, async ({
    page,
  }) => {
    if (mode === "reduced motion")
      await page.emulateMedia({ reducedMotion: "reduce" });
    else {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "connection", {
          value: Object.assign(new EventTarget(), { saveData: true }),
          configurable: true,
        }),
      );
    }
    const videoRequests: string[] = [];
    page.on("request", (req) => {
      if (/continuity\.(webm|mp4)/.test(req.url()))
        videoRequests.push(req.url());
    });
    await page.goto("/");
    await expect(page.locator(".hero-poster")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Prepare your analytics\s*for the agentic era\./,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Understand browser matching" })
      .hover();
    expect(videoRequests).toEqual([]);
    await expect(page.locator("[data-hero-video]")).not.toHaveAttribute(
      "data-loaded",
      "true",
    );
    if (mode === "save data") {
      await page
        .getByRole("button", { name: "Play motion", exact: true })
        .click();
      await expect(page.locator("[data-hero-video]")).toHaveAttribute(
        "data-ready",
        "true",
      );
      expect(videoRequests.length).toBeGreaterThan(0);
    }
  });
}

test("video pauses offscreen and the site survives unavailable media", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const film = page.locator("[data-hero-video]");
  await expect(film).toHaveAttribute("data-ready", "true");
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect
    .poll(() => film.evaluate((el) => (el as HTMLVideoElement).paused))
    .toBe(true);
  await page.locator(".site-header").scrollIntoViewIfNeeded();
  await expect
    .poll(() => film.evaluate((el) => !(el as HTMLVideoElement).paused))
    .toBe(true);
  await page.route(/continuity\.(webm|mp4)/, (route) => route.abort());
  await page.reload();
  await expect(page.locator(".hero-poster")).toBeVisible();
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
  const videos: string[] = [];
  page.on("request", (req) => {
    if (/continuity\.(webm|mp4)/.test(req.url())) videos.push(req.url());
  });
  await page.goto("http://127.0.0.1:4357/");
  await expect(
    page.getByRole("heading", {
      name: /Prepare your analytics\s*for the agentic era\./,
    }),
  ).toBeVisible();
  await expect(page.locator(".hero-poster")).toBeVisible();
  expect(videos).toEqual([]);
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
    page.getByRole("heading", { name: "What is Janitor?", exact: true }),
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
    await expect(page.locator("article")).toContainText("Janitor.new/1");
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
      next === "light" ? "/janitor-mark-dark.svg" : "/janitor-mark.svg",
    );
  });
}
