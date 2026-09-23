import { createExtendedBehavior } from "../../../packages/browser/src/behavior.js";
import { extractFeatures } from "../../../packages/network/src/features.js";
import type { BrowserBehavior } from "@janitor/core";

export type ReplayEvent = [string, number, number?, number?];
/** Offline approximation from research events; the production aggregator runs unchanged. */
export function replayBehavior(events: ReplayEvent[]) {
  let time = 0;
  const tracker = createExtendedBehavior(() => time);
  const behavior: BrowserBehavior = {
    pageAgeMs: 0,
    mouseMoveCount: 0,
    pointerDownCount: 0,
    keyDownCount: 0,
    scrollCount: 0,
    visibilityChangeCount: 0,
  };
  for (const [kind, at, x, y] of events) {
    if (!Number.isFinite(at) || at < 0) continue;
    if (at < time || kind === "reset") tracker.clear();
    if (kind !== "reset" && at >= time) behavior.pageAgeMs += at - time;
    time = at;
    if (kind === "mousemove") {
      behavior.mouseMoveCount = Math.min(
        1_000_000,
        behavior.mouseMoveCount + 1,
      );
      tracker.observe({ type: kind, movementX: x, movementY: y } as MouseEvent);
    } else if (kind === "pointerdown" || kind === "keydown") {
      const key = kind === "pointerdown" ? "pointerDownCount" : "keyDownCount";
      behavior[key] = Math.min(1_000_000, behavior[key] + 1);
      tracker.observe({ type: kind } as Event);
    } else if (kind === "scroll") behavior.scrollCount++;
  }
  Object.assign(behavior, tracker.snapshot());
  return extractFeatures({ behavior });
}
