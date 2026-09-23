import { test, expect, type Route } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  expect((await request.post("/test/reset")).ok()).toBe(true);
});

test("real analytics SDKs link login to their anonymous device, then separate another user on the same browser", async ({
  page,
  browser,
}) => {
  const mixpanelEvents: {
    event: string;
    properties: Record<string, unknown>;
  }[] = [];
  const posthogEvents: typeof mixpanelEvents = [];
  const external: string[] = [];
  const intercept = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4318") {
      external.push(request.url());
      return route.abort();
    }
    if (!url.pathname.startsWith("/vendor/")) return route.continue();
    const mixpanel = url.pathname.startsWith("/vendor/mixpanel/track");
    const posthog =
      url.pathname.startsWith("/vendor/posthog/e/") ||
      url.pathname.startsWith("/vendor/posthog/i/v0/e");
    if (mixpanel || posthog) {
      const body = request.postData() ?? url.search;
      const raw =
        body.startsWith("{") || body.startsWith("[")
          ? body
          : new URLSearchParams(body).get("data")!;
      const value = JSON.parse(
        raw.startsWith("{") || raw.startsWith("[")
          ? raw
          : Buffer.from(raw, "base64").toString("utf8"),
      );
      (mixpanel ? mixpanelEvents : posthogEvents).push(
        ...(Array.isArray(value)
          ? value
          : Array.isArray(value.batch)
            ? value.batch
            : [value]),
      );
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"status":1}',
    });
  };
  await page.route("**/*", intercept);
  await page.goto("/analytics-test");
  await page.waitForFunction(() => !!window.analyticsDemo);
  const before = await page.evaluate(() => window.analyticsDemo.snapshot());
  expect(
    await page.evaluate(() => window.analyticsDemo.login("user-a")),
  ).toEqual({ posthog: "queued", mixpanel: "queued" });
  const first = await page.evaluate(() => window.analyticsDemo.snapshot());
  expect(first).toEqual({
    posthog: "user-a",
    mixpanel: "user-a",
    device: before.device,
  });
  await expect
    .poll(() =>
      mixpanelEvents.some(
        (e) =>
          e.event === "janitor user identified" &&
          e.properties.$user_id === "user-a" &&
          e.properties.$device_id === before.device,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      posthogEvents.some(
        (e) =>
          e.event === "$identify" &&
          e.properties.distinct_id === "user-a" &&
          e.properties.$anon_distinct_id === before.posthog,
      ),
    )
    .toBe(true);
  const otherContext = await browser.newContext();
  try {
    await otherContext.route("**/*", intercept);
    const other = await otherContext.newPage();
    await other.goto("http://127.0.0.1:4318/analytics-test");
    await other.waitForFunction(() => !!window.analyticsDemo);
    await other.evaluate(() => window.analyticsDemo.login("user-a"));
    const secondDevice = await other.evaluate(() =>
      window.analyticsDemo.snapshot(),
    );
    expect(secondDevice.posthog).toBe("user-a");
    expect(secondDevice.mixpanel).toBe("user-a");
    expect(secondDevice.device).not.toBe(before.device);
    await expect
      .poll(() =>
        mixpanelEvents.some(
          (e) =>
            e.properties.$user_id === "user-a" &&
            e.properties.$device_id === secondDevice.device,
        ),
      )
      .toBe(true);
  } finally {
    await otherContext.close();
  }
  expect(
    await page.evaluate(() => window.analyticsDemo.login("user-a")),
  ).toEqual({ posthog: "skipped", mixpanel: "skipped" });
  await page.evaluate(() => window.analyticsDemo.login("user-b"));
  const second = await page.evaluate(() => window.analyticsDemo.snapshot());
  expect(second.posthog).toBe("user-b");
  expect(second.mixpanel).toBe("user-b");
  expect(second.device).not.toBe(before.device);
  await expect
    .poll(() =>
      mixpanelEvents.some(
        (e) =>
          e.event === "janitor user identified" &&
          e.properties.$user_id === "user-b" &&
          e.properties.$device_id === second.device,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.analyticsDemo.logout());
  const after = await page.evaluate(() => window.analyticsDemo.snapshot());
  expect(after.posthog).not.toBe("user-b");
  expect(after.mixpanel).not.toBe("user-b");
  expect(after.device).not.toBe(second.device);
  const measured = await page.evaluate(() =>
    window.analyticsDemo.janitor.identify("user-c", { plan: "pro" }),
  );
  expect(measured.visitorId).toMatch(/^vis_/);
  await page.evaluate(() =>
    window.analyticsDemo.janitor.track("checkout opened", { plan: "pro" }),
  );
  await expect
    .poll(() =>
      mixpanelEvents.some(
        (e) =>
          e.event === "checkout opened" &&
          e.properties.$user_id === "user-c" &&
          e.properties.janitor_visitor_id === measured.visitorId,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      posthogEvents.some(
        (e) =>
          e.event === "checkout opened" &&
          e.properties.distinct_id === "user-c" &&
          e.properties.janitor_visitor_id === measured.visitorId,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.analyticsDemo.janitor.reset());
  expect(
    (await page.evaluate(() => window.analyticsDemo.snapshot())).posthog,
  ).not.toBe("user-c");
  expect(JSON.stringify([mixpanelEvents, posthogEvents])).not.toMatch(
    /janitor_automation|janitor_confidence|collectedSignals/,
  );
  expect(external).toEqual([]);
});
