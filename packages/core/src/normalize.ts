import type {
  BrowserBehavior,
  BrowserObservation,
  NormalizedObservation,
} from "./types.js";

const text = (value?: string) => value?.trim() || undefined;
const lower = (value?: string) => text(value)?.toLowerCase();
const positive = (value?: number) =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;

function browserFamily(ua?: string): string | undefined {
  if (!ua) return undefined;
  if (/edg(e|a|ios)?\//i.test(ua)) return "edge";
  if (/opr\/|opera/i.test(ua)) return "opera";
  if (/firefox\/|fxios\//i.test(ua)) return "firefox";
  if (/chrome\/|crios\//i.test(ua)) return "chrome";
  if (/safari\//i.test(ua)) return "safari";
  return undefined;
}

function platformFamily(platform?: string, ua?: string): string | undefined {
  // Android often reports Linux; iOS reports iPhone/iPad. Do not infer hidden values.
  if (
    /iphone|ipad|ipod/i.test(ua ?? "") ||
    /iphone|ipad|ipod|^ios$/i.test(platform ?? "")
  )
    return "ios";
  if (/android/i.test(ua ?? "") || /android/i.test(platform ?? ""))
    return "android";
  const p = lower(platform);
  if (p?.startsWith("win")) return "windows";
  if (p?.startsWith("mac")) return "macos";
  if (p?.includes("linux")) return "linux";
  return p;
}

export function normalizeObservation(
  observation: BrowserObservation,
  behavior?: BrowserBehavior,
): NormalizedObservation {
  const screen = observation.screen
    ? {
        width: positive(observation.screen.width),
        height: positive(observation.screen.height),
        colorDepth: positive(observation.screen.colorDepth),
        pixelRatio: positive(observation.screen.pixelRatio),
      }
    : undefined;
  if (screen?.width !== undefined && screen.height !== undefined) {
    [screen.width, screen.height] = [
      Math.min(screen.width, screen.height),
      Math.max(screen.width, screen.height),
    ];
  }
  const languages = observation.languages
    ?.map(lower)
    .filter((v): v is string => !!v);
  return {
    ...(observation.fonts?.version === "local-12-v1" &&
    /^[01]{12}$/.test(observation.fonts.available)
      ? { fonts: { ...observation.fonts } }
      : {}),
    ...(observation.environment
      ? { environment: { ...observation.environment } }
      : {}),
    userAgent: text(observation.userAgent),
    platform: platformFamily(observation.platform, observation.userAgent),
    browser: browserFamily(observation.userAgent),
    languages: languages?.length ? [...new Set(languages)].sort() : undefined,
    timezone: text(observation.timezone),
    screen,
    viewport: observation.viewport
      ? {
          width: positive(observation.viewport.width),
          height: positive(observation.viewport.height),
        }
      : undefined,
    hardware: observation.hardware
      ? {
          hardwareConcurrency: positive(
            observation.hardware.hardwareConcurrency,
          ),
          deviceMemory: positive(observation.hardware.deviceMemory),
          maxTouchPoints: observation.hardware.maxTouchPoints,
        }
      : undefined,
    automation: observation.automation
      ? { ...observation.automation }
      : undefined,
    graphics: observation.graphics
      ? {
          webglVendor: lower(observation.graphics.webglVendor),
          webglRenderer: lower(observation.graphics.webglRenderer),
        }
      : undefined,
    behavior: behavior ? { ...behavior } : undefined,
  };
}
