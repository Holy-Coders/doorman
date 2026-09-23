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
      "/docs/getting-started/",
      "/docs/api/",
      "/docs/cloudflare/",
      "/docs/nextjs/",
      "/docs/node/",
      "/docs/matching/",
      "/docs/evaluators/",
      "/docs/storage/",
      "/docs/privacy/",
      "/docs/validation/",
      "/docs/extensions/",
      "/docs/benchmarks/",
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
    "/janitor-logo.png",
    "/social.png",
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
  const trace = page.locator(".trace-light");
  await expect(trace).toHaveCSS("animation-play-state", "running");
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await expect(trace).toHaveCSS("animation-play-state", "paused");
  await page.getByRole("button", { name: "Play motion", exact: true }).click();
  await expect(trace).toHaveCSS("animation-play-state", "running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Reduced motion", exact: true }),
  ).toBeDisabled();
  await expect(trace).toHaveCSS("animation-name", "none");
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
