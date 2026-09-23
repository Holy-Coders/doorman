import { test, expect } from "@playwright/test";

test("live collection begins only after consent and shows safe responses, cache status and erasure", async ({
  page,
}) => {
  const calls: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  let evaluations = 0;
  const visitorId = "vis_" + "a".repeat(48);
  await page.route("**/api/playground/**", async (route) => {
    const request = route.request();
    const action = new URL(request.url()).pathname.split("/").at(-1)!;
    calls.push(`${request.method()} ${action}`);
    expect(request.headers()["x-janitor-playground"]).toBe("1");
    if (action === "identify") {
      payloads.push(request.postDataJSON());
      evaluations++;
      await route.fulfill({
        json: {
          visitorId,
          isReturning: evaluations > 1,
          evaluation: {
            source: evaluations > 1 ? "cache" : "jev",
            evaluatedAt: Date.now(),
          },
        },
      });
    } else
      await route.fulfill({
        json: {
          active: action === "session",
          erased: request.method() === "DELETE",
        },
      });
  });
  await page.goto("/playground/");
  const lab = page.locator("[data-live-playground]");
  const start = lab.getByRole("button", { name: "Start my live demo" });
  await expect(start).toBeDisabled();
  expect(calls).toEqual([]);
  await lab.getByRole("checkbox").check();
  await expect(start).toBeEnabled();
  expect(calls).toEqual([]);
  await start.click();
  await expect(lab.locator("[data-live-id]")).toHaveText(visitorId);
  await expect(lab.locator("[data-live-source]")).toHaveText(
    "Live Jev response",
  );
  expect(calls).toEqual(["POST session", "POST identify"]);
  expect(Object.keys(payloads[0]!).sort()).toEqual(["behavior", "signals"]);
  expect(Object.keys(payloads[0]!.behavior as object).sort()).toEqual([
    "keyDownCount",
    "mouseMoveCount",
    "pageAgeMs",
    "pointerDownCount",
    "scrollCount",
    "visibilityChangeCount",
  ]);
  await lab.getByRole("button", { name: "Repeat saved snapshot" }).click();
  await expect(lab.locator("[data-live-source]")).toHaveText(
    "Private cache hit",
  );
  expect(payloads[1]).toEqual(payloads[0]);
  await lab
    .getByRole("button", { name: "Remove visitor cookie & retry" })
    .click();
  await expect(
    lab.getByRole("button", { name: "Repeat saved snapshot" }),
  ).toBeEnabled();
  expect(calls.slice(-2)).toEqual(["POST forget-cookie", "POST identify"]);
  await page.setViewportSize({ width: 390, height: 850 });
  await lab.getByText("Inspect the browser response", { exact: true }).click();
  expect(await lab.locator("[data-live-json]").innerText()).not.toMatch(
    /automation|suspicious|confidence/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await lab.getByRole("button", { name: "Stop & erase my demo data" }).click();
  await expect(lab.locator("[data-live-state]")).toHaveText("Stopped & erased");
  await expect(start).toBeDisabled();
  await expect(lab.locator("[data-live-actions]")).toBeHidden();
  expect(calls.at(-1)).toBe("DELETE session");
});

test("erasure failure leaves collection stopped and allows another erase attempt", async ({
  page,
}) => {
  let erasures = 0;
  await page.route("**/api/playground/**", async (route) => {
    if (route.request().method() === "DELETE") {
      erasures++;
      return route.fulfill({
        status: erasures === 1 ? 503 : 200,
        json:
          erasures === 1
            ? { error: "Erasure temporarily unavailable. Try again." }
            : { erased: true },
      });
    }
    return route.fulfill({
      json: {
        active: true,
        visitorId: "vis_" + "a".repeat(48),
        isReturning: false,
        evaluation: { source: "fallback" },
      },
    });
  });
  await page.goto("/playground/");
  const lab = page.locator("[data-live-playground]");
  await lab.getByRole("checkbox").check();
  await lab.getByRole("button", { name: "Start my live demo" }).click();
  const erase = lab.getByRole("button", { name: "Stop & erase my demo data" });
  await expect(erase).toBeEnabled();
  await erase.click();
  await expect(lab.locator("[data-live-state]")).toHaveText(
    "Collection stopped",
  );
  await expect(
    lab.getByRole("button", { name: "Take a new snapshot" }),
  ).toBeDisabled();
  await expect(
    lab.getByRole("button", { name: "Repeat saved snapshot" }),
  ).toBeDisabled();
  await expect(erase).toBeEnabled();
  await erase.click();
  await expect(lab.locator("[data-live-state]")).toHaveText("Stopped & erased");
});
