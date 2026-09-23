import { expect, it, vi } from "vitest";
import { createVisitorHandler } from "@aarondovturkel/doorman-adapters/node";
import { createMemoryStorage } from "./helpers/memory.js";
import { signals } from "./helpers/fixtures.js";
const request = () =>
  new Request("https://app.test/api/visitor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signals }),
  });
it("rejects excess simultaneous measurements without queuing database work and recovers", async () => {
  const storage = createMemoryStorage();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const find = vi.fn(async () => {
    await gate;
    return [];
  });
  const overload = vi.fn(() => {
    throw Error("metrics must not change admission");
  });
  const handler = createVisitorHandler(
    { ...storage, findCandidates: find },
    undefined,
    { maxInFlightRequests: 4, onOverload: overload },
  );
  const admitted = Array.from({ length: 4 }, () => handler.assess(request()));
  await vi.waitFor(() => expect(find).toHaveBeenCalledTimes(4));
  const excess = await Promise.all(
    Array.from({ length: 1000 }, () => handler.assess(request())),
  );
  expect(
    excess.every(
      (r) => r.response.status === 503 && !r.identity && !r.evidence,
    ),
  ).toBe(true);
  expect(excess[0]!.response.headers.get("retry-after")).toBe("1");
  expect(find).toHaveBeenCalledTimes(4);
  expect(overload).toHaveBeenCalledTimes(1000);
  release();
  expect(
    (await Promise.all(admitted)).every((r) => r.response.status === 200),
  ).toBe(true);
  expect((await handler.handle(request())).status).toBe(200);
});
it("releases admission after invalid payloads and storage failures", async () => {
  let fail = true;
  const store = createMemoryStorage();
  const handler = createVisitorHandler(
    {
      ...store,
      findCandidates: async () => {
        if (fail) throw Error("db error");
        return [];
      },
    },
    undefined,
    { maxInFlightRequests: 1 },
  );
  expect(
    (
      await handler.handle(
        new Request("https://app.test/api/visitor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "bad",
        }),
      )
    ).status,
  ).toBe(400);
  expect((await handler.handle(request())).status).toBe(503);
  fail = false;
  expect((await handler.handle(request())).status).toBe(200);
});
it("rejects invalid local capacity settings", () => {
  for (const maxInFlightRequests of [0, -1, 1.5, 1025, Infinity])
    expect(() =>
      createVisitorHandler(createMemoryStorage(), undefined, {
        maxInFlightRequests,
      }),
    ).toThrow("concurrency");
});
