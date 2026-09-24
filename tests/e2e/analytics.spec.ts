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
          e.event === "doorman user identified" &&
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
          e.event === "doorman user identified" &&
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
    window.analyticsDemo.doorman.identify(
      { userId: "user-c", accountId: "team-c" },
      { plan: "pro" },
    ),
  );
  expect(measured.visitorId).toMatch(/^vis_/);
  await page.evaluate(() =>
    window.analyticsDemo.doorman.track("checkout opened", { plan: "pro" }),
  );
  await expect
    .poll(() =>
      mixpanelEvents.some(
        (e) =>
          e.event === "checkout opened" &&
          e.properties.$user_id === "user-c" &&
          e.properties.doorman_visitor_id === measured.visitorId,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      posthogEvents.some(
        (e) =>
          e.event === "checkout opened" &&
          e.properties.distinct_id === "user-c" &&
          e.properties.doorman_visitor_id === measured.visitorId,
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    window.analyticsDemo.directTrack("direct sdk event"),
  );
  for (const events of [mixpanelEvents, posthogEvents]) {
    await expect
      .poll(() =>
        events.some(
          (e) =>
            e.event === "direct sdk event" &&
            e.properties.doorman_visitor_id === measured.visitorId &&
            e.properties.doorman_account_id === "team-c",
        ),
      )
      .toBe(true);
  }
  await page.evaluate(() => window.analyticsDemo.doorman.reset());
  await page.evaluate(() => window.analyticsDemo.directTrack("after logout"));
  for (const events of [mixpanelEvents, posthogEvents]) {
    await expect
      .poll(() => events.some((e) => e.event === "after logout"))
      .toBe(true);
    expect(
      events.find((e) => e.event === "after logout")?.properties,
    ).not.toHaveProperty("doorman_account_id");
  }

  expect(
    (await page.evaluate(() => window.analyticsDemo.snapshot())).posthog,
  ).not.toBe("user-c");
  expect(JSON.stringify([mixpanelEvents, posthogEvents])).not.toMatch(
    /doorman_automation|doorman_confidence|collectedSignals/,
  );
  expect(external).toEqual([]);
});

test("real Amplitude SDK receives Doorman identities and rotates device IDs at account boundaries", async ({
  page,
}) => {
  const events: Record<string, unknown>[] = [];
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4318") {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/vendor/amplitude") {
      events.push(...route.request().postDataJSON().events);
      return route.fulfill({
        json: {
          code: 200,
          events_ingested: 1,
          payload_size_bytes: 100,
          server_upload_time: Date.now(),
        },
      });
    }
    if (url.pathname.startsWith("/vendor/"))
      return route.fulfill({ json: { status: 1 } });
    return route.continue();
  });
  await page.goto("/analytics-test");
  await page.waitForFunction(() => !!window.analyticsDemo);
  await page.evaluate(() => window.analyticsDemo.amplitude.start());
  const before = await page.evaluate(() =>
    window.analyticsDemo.amplitude.snapshot(),
  );
  await page.evaluate(() =>
    window.analyticsDemo.amplitude.identify("person-one"),
  );
  expect(
    await page.evaluate(() => window.analyticsDemo.amplitude.snapshot()),
  ).toEqual({ ...before, userId: "person-one" });
  await expect
    .poll(() =>
      events.some(
        (e) => e.event_type === "$identify" && e.user_id === "person-one",
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    window.analyticsDemo.amplitude.identify("person-two"),
  );
  const second = await page.evaluate(() =>
    window.analyticsDemo.amplitude.snapshot(),
  );
  expect(second.deviceId).not.toBe(before.deviceId);
  expect(second.userId).toBe("person-two");
  await page.evaluate(() => window.analyticsDemo.amplitude.reset());
  const after = await page.evaluate(() =>
    window.analyticsDemo.amplitude.snapshot(),
  );
  expect(after.userId).toBeUndefined();
  expect(after.deviceId).not.toBe(second.deviceId);
  expect(JSON.stringify(events)).not.toMatch(
    /doorman_automation|collectedSignals/,
  );
  expect(external).toEqual([]);
});
