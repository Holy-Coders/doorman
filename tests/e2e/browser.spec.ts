import { test, expect } from "@playwright/test";
import type { VisitorIdentity } from "@janitor/core";
test("browser → Fastify → Postgres: first visit, cookie continuity, cookie loss and resizing", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function identify() {
    const response = page.waitForResponse((response) =>
      response.url().endsWith("/api/visitor"),
    );
    await page.getByRole("button", { name: "Identify this browser" }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    return (await result.json()) as VisitorIdentity;
  }
  await page.mouse.move(10, 10);
  await page.mouse.move(160, 110, { steps: 6 });
  const outgoing = page.waitForRequest((request) =>
    request.url().endsWith("/api/visitor"),
  );
  const first = await identify();
  const sent = (await outgoing).postDataJSON();
  expect(sent.behavior.mouseDistancePx).toBeGreaterThan(0);
  expect(sent.behavior).not.toHaveProperty("clientX");
  expect(sent.behavior).not.toHaveProperty("events");
  expect(first.isReturning).toBe(false);
  expect(first.risk).toEqual({ automation: 0, suspicious: 0 });
  const cookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__visitor",
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain("__visitor");
  expect((await identify()).visitorId).toBe(first.visitorId);
  await context.clearCookies();
  await page.setViewportSize({ width: 600, height: 800 });
  const restored = await identify();
  expect(restored).toMatchObject({
    visitorId: first.visitorId,
    isReturning: true,
  });
  expect(restored.confidence).toBeGreaterThanOrEqual(0.9);
  expect(errors).toEqual([]);
});
