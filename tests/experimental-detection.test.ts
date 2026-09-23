import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectDetectionSignals,
  FONT_PROBES,
} from "../packages/browser/src/detection.js";
import { createVisitorClient } from "@aarondovturkel/doorman-browser";
import {
  calculateSimilarity,
  normalizeObservation,
  evidenceCap,
  hasOperatorEvidence,
} from "@aarondovturkel/doorman-core";
import { payloadSchema } from "../packages/adapters/src/validation.js";
import { cloudflareRequestEvidence } from "@aarondovturkel/doorman-adapters/cloudflare";
import { requestEvidence } from "../packages/adapters/src/evidence.js";
import { extractFeatures } from "../packages/network/src/features.js";
import { compactObservation } from "../packages/evaluators/jev/src/protocol.js";
import { signals } from "./helpers/fixtures.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("explicit experimental collection", () => {
  it("does nothing unless selected and tolerates entirely missing browser APIs", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await collectDetectionSignals()).toEqual({});
    expect(
      await collectDetectionSignals({
        fonts: true,
        runtime: true,
        permissions: true,
        pageFonts: true,
      }),
    ).toEqual({});
  });
  it("uses only the fixed local font list, with no page mutation or network source", async () => {
    const sources: string[] = [];
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(_family: string, source: string) {
          sources.push(source);
        }
        async load() {
          if (sources.length > 3) throw Error("unavailable");
        }
      },
    );
    const observation = await collectDetectionSignals({ fonts: true });
    expect(sources).toEqual(FONT_PROBES.map((name) => `local("${name}")`));
    expect(observation.fonts).toEqual({
      version: "local-12-v1",
      available: "111000000000",
    });
    expect(payloadSchema.parse({ signals: observation }).signals).toEqual(
      observation,
    );
  });
  it("bounds pending font and permission APIs and does not mutate a returned result later", async () => {
    vi.useFakeTimers();
    let complete!: (value: { state: string }) => void;
    vi.stubGlobal(
      "FontFace",
      class {
        load() {
          return new Promise(() => {});
        }
      },
    );
    vi.stubGlobal("navigator", {
      permissions: {
        query: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      },
    });
    vi.stubGlobal("Notification", { permission: "denied" });
    const pending = collectDetectionSignals({ fonts: true, permissions: true });
    await vi.advanceTimersByTimeAsync(251);
    const result = await pending;
    expect(result).toEqual({});
    complete({ state: "granted" });
    await Promise.resolve();
    await Promise.resolve();
    expect(result).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reads only marker descriptors and reports permission states without requesting permission", async () => {
    const globals = {};
    Object.defineProperty(globals, "_phantom", {
      get() {
        throw Error("must not execute");
      },
    });
    vi.stubGlobal("window", globals);
    vi.stubGlobal("navigator", {
      permissions: { query: async () => ({ state: "prompt" }) },
    });
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    const observation = await collectDetectionSignals({
      runtime: true,
      permissions: true,
    });
    expect(observation.environment).toMatchObject({
      runtimeMarkerCount: 1,
      notificationQuery: "prompt",
      notificationPermission: "denied",
    });
    expect(requestPermission).not.toHaveBeenCalled();
    const features = extractFeatures({ observation });
    expect(features).toMatchObject({
      runtime_marker_count: 1,
      notification_mismatch: 1,
    });
    expect(hasOperatorEvidence({ source: "browser", features })).toBe(false);
  });
  it("counts page font statuses without reading family names or font URLs", async () => {
    const face = {
      status: "loaded",
      get family() {
        throw Error("private");
      },
    };
    vi.stubGlobal("document", {
      fonts: [...Array(120).fill(face), { status: "error" }],
    });
    expect(await collectDetectionSignals({ pageFonts: true })).toEqual({
      environment: {
        pageFontsLoaded: 100,
        pageFontsLoading: 0,
        pageFontsFailed: 0,
      },
    });
  });
  it("does not send a late payload after collection is paused", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", new EventTarget());
    vi.stubGlobal("window", { location: new URL("https://app.test") });
    vi.stubGlobal(
      "FontFace",
      class {
        load() {
          return new Promise(() => {});
        }
      },
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = createVisitorClient({ detection: { fonts: true } });
    const pending = expect(client.identify()).rejects.toThrow("reset");
    client.setEnabled(false);
    await vi.advanceTimersByTimeAsync(251);
    await pending;
    expect(fetch).not.toHaveBeenCalled();
    client.destroy();
  });
});
describe("font identity and input boundaries", () => {
  const fonts = { version: "local-12-v1" as const, available: "111000000000" };
  it("exposes Jaccard evidence and optional weights without weakening sparse or contradiction caps", () => {
    const a = normalizeObservation({ ...signals, fonts });
    const b = { ...a, fonts: { ...fonts, available: "110100000000" } };
    expect(calculateSimilarity(a, b).features.fontSimilarity).toBe(0.5);
    expect(calculateSimilarity(a, b).score).toBeCloseTo(1);
    expect(
      calculateSimilarity(a, b, { fontSimilarity: 0.1 }).score,
    ).toBeCloseTo(1.05 / 1.1);
    expect(
      calculateSimilarity({ fonts }, { fonts }, { fontSimilarity: 1 }).score,
    ).toBe(0);
    expect(evidenceCap({ fonts }, { fonts })).toBe(0);
    expect(evidenceCap(a, { ...a, platform: "different" })).toBe(0.5);
    expect(compactObservation(a).fonts).toEqual(fonts);
    expect(extractFeatures({ observation: a })).not.toHaveProperty("fonts");
  });
  it("treats empty or absent local-font availability as unknown, not a matching signature", () => {
    const empty = { fonts: { ...fonts, available: "000000000000" } };
    expect(
      calculateSimilarity(empty, empty).features.fontSimilarity,
    ).toBeUndefined();
    expect(
      calculateSimilarity({ fonts }, {}).features.fontSimilarity,
    ).toBeUndefined();
  });
  it("rejects arbitrary font inventories, unsupported versions and oversized experimental data", () => {
    for (const bad of [
      { ...fonts, available: "Arial" },
      { ...fonts, version: "local-v2" },
      { ...fonts, extra: [] },
    ])
      expect(() => payloadSchema.parse({ signals: { fonts: bad } })).toThrow();
    expect(() =>
      payloadSchema.parse({
        signals: { environment: { runtimeMarkerCount: 9 } },
      }),
    ).toThrow();
    expect(() =>
      payloadSchema.parse({
        signals: { environment: { notificationPermission: "yes" } },
      }),
    ).toThrow();
  });
  it("accepts JA4 only from explicitly enabled trusted Worker metadata", () => {
    const ja4 = "t13d1516h2_8daaf6152771_02713d6af862";
    const request = new Request("https://app.test", {
      headers: { "cf-ja4": ja4 },
    });
    expect(
      cloudflareRequestEvidence(request, { transport: true }),
    ).toBeUndefined();
    Object.assign(request, { cf: { botManagement: { ja4 } } });
    expect(cloudflareRequestEvidence(request)).toBeUndefined();
    const edge = cloudflareRequestEvidence(request, { transport: true })!;
    expect(requestEvidence({ edge }).edge?.ja4).toBe(ja4);
    expect(() => payloadSchema.parse({ signals: { ja4 } })).toThrow();
    Object.assign(request, {
      cf: { botManagement: { ja4: "spoofed arbitrary text" } },
    });
    expect(
      cloudflareRequestEvidence(request, { transport: true }),
    ).toBeUndefined();
  });
});
