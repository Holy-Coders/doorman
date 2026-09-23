import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createPilotTransport } from "../scripts/benchmarks/external/jev-transport.js";

const answer = {
  model: "jev-1.13.0",
  answers: { automation: { type: "noul", noul: 0.1 } },
  usage: { input_tokens: 300, output_tokens: 10 },
};
describe("budgeted real-provider pilot", () => {
  it("reuses a validated response without another paid call, including after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janitor-pilot-")),
      path = join(dir, "ledger.json");
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        result: { state: "Completed", result: answer },
      }),
    );
    try {
      const first = await createPilotTransport({
        path,
        maxCalls: 1,
        live: true,
        token: "test",
        accountId: "a".repeat(32),
        fetch: fetcher,
      });
      try {
        expect(await first.evaluate({ features: {} })).toEqual(answer);
        expect(await first.evaluate({ features: {} })).toEqual(answer);
      } finally {
        await first.close();
      }
      const replay = await createPilotTransport({
        path,
        maxCalls: 0,
        live: false,
        fetch: fetcher,
      });
      try {
        expect(await replay.evaluate({ features: {} })).toEqual(answer);
        await expect(replay.evaluate({ different: true })).rejects.toThrow(
          "Uncached",
        );
      } finally {
        await replay.close();
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
      const options = fetcher.mock.calls[0]![1]!;
      expect(options.headers).toMatchObject({
        "cf-aig-collect-log": "false",
        "cf-aig-collect-log-payload": "false",
        "cf-aig-max-attempts": "1",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("reserves failures and rejects concurrent ledger writers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janitor-pilot-")),
      path = join(dir, "ledger.json");
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("failed", { status: 500 }),
    );
    try {
      const first = await createPilotTransport({
        path,
        maxCalls: 1,
        live: true,
        token: "test",
        accountId: "a".repeat(32),
        fetch: fetcher,
      });
      try {
        await expect(
          createPilotTransport({ path, maxCalls: 1, live: true }),
        ).rejects.toThrow();
        await expect(first.evaluate({ case: 1 })).rejects.toThrow("HTTP 500");
        await expect(first.evaluate({ case: 2 })).rejects.toThrow(
          "cap reached",
        );
        expect(JSON.parse(await readFile(path, "utf8")).attempts).toBe(1);
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        await first.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
