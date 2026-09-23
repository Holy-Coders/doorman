import type { BrowserBehavior } from "@janitor/core";

const MAX_TOTAL = 1_000_000_000;
const MAX_COUNT = 1_000_000;
const PAUSE_MS = 1_000;
const MAX_INTERVAL_MS = 60_000;
const LARGE_STEP_PX = 100;
const SHORT_GAP_MS = 100;
const REPEATED_GAP_TOLERANCE_MS = 10;
function moments() {
  let count = 0,
    mean = 0,
    m2 = 0;
  return {
    add(value: number) {
      if (count >= MAX_COUNT) return;
      count++;
      const delta = value - mean;
      mean += delta / count;
      m2 += delta * (value - mean);
    },
    snapshot: () => ({
      count,
      mean: Math.round(mean),
      stdDev: Math.round(Math.sqrt(Math.max(0, m2 / (count || 1)))),
    }),
  };
}
const add = (total: number, value: number) =>
  Math.min(MAX_TOTAL, total + value);

// Constant memory: aggregate totals and the immediately preceding delta/time only.
// Never read absolute pointer coordinates, key values, text, or event targets.
export function createExtendedBehavior(
  now: () => number = () => performance.now(),
) {
  const totals = {
    mouseDistancePx: 0,
    mouseActiveMs: 0,
    mouseDirectionChanges: 0,
    mousePauseCount: 0,
    mouseSampleCount: 0,
    mouseLargeStepCount: 0,
    interactionShortGapCount: 0,
    interactionRepeatGapCount: 0,
    interactionComparableGapCount: 0,
    scrollDistancePx: 0,
    scrollDirectionChanges: 0,
  };
  const movementIntervals = moments();
  let previousInterval: number | undefined;
  let lastMove: number | undefined;
  let direction: { x: number; y: number } | undefined;
  let scrollDirection = 0;
  let lastPress: number | undefined;
  let intervals = 0;
  let mean = 0;
  let squaredDeviation = 0;
  return {
    observe(event: Event) {
      const time = now();
      if (!Number.isFinite(time) || time < 0) return;
      if (event.type === "mousemove") {
        const { movementX: x, movementY: y } = event as MouseEvent;
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          Math.abs(x) > 32768 ||
          Math.abs(y) > 32768
        )
          return;
        if (totals.mouseSampleCount >= MAX_COUNT) return;
        totals.mouseSampleCount++;
        const distance = Math.hypot(x, y);
        if (distance >= LARGE_STEP_PX) totals.mouseLargeStepCount++;
        if (lastMove !== undefined) {
          const elapsed = time - lastMove;
          if (elapsed >= PAUSE_MS) {
            totals.mousePauseCount = Math.min(
              MAX_COUNT,
              totals.mousePauseCount + 1,
            );
            direction = undefined;
          } else if (elapsed > 0) {
            totals.mouseActiveMs = add(totals.mouseActiveMs, elapsed);
            movementIntervals.add(elapsed);
          }
        }
        totals.mouseDistancePx = add(totals.mouseDistancePx, distance);
        if (distance > 0) {
          if (direction && direction.x * x + direction.y * y < 0)
            totals.mouseDirectionChanges = Math.min(
              MAX_COUNT,
              totals.mouseDirectionChanges + 1,
            );
          direction = { x, y };
        }
        lastMove = time;
      } else if (event.type === "wheel") {
        const { deltaY, deltaMode } = event as WheelEvent;
        // Only pixel units; do not guess line/page heights or inspect document contents.
        if (
          deltaMode !== 0 ||
          !Number.isFinite(deltaY) ||
          Math.abs(deltaY) > 32768
        )
          return;
        totals.scrollDistancePx = add(
          totals.scrollDistancePx,
          Math.abs(deltaY),
        );
        const next = Math.sign(deltaY);
        if (next && scrollDirection && next !== scrollDirection)
          totals.scrollDirectionChanges = Math.min(
            MAX_COUNT,
            totals.scrollDirectionChanges + 1,
          );
        if (next) scrollDirection = next;
      } else if (event.type === "keydown" || event.type === "pointerdown") {
        if (event.type === "keydown" && (event as KeyboardEvent).repeat) return;
        if (lastPress !== undefined && intervals < MAX_COUNT) {
          const elapsed = time - lastPress;
          if (elapsed >= 0 && elapsed <= MAX_INTERVAL_MS) {
            intervals++;
            if (elapsed < SHORT_GAP_MS) totals.interactionShortGapCount++;
            if (previousInterval !== undefined) {
              totals.interactionComparableGapCount++;
              if (
                Math.abs(elapsed - previousInterval) <=
                REPEATED_GAP_TOLERANCE_MS
              )
                totals.interactionRepeatGapCount++;
            }
            previousInterval = elapsed;
            const delta = elapsed - mean;
            mean += delta / intervals;
            squaredDeviation += delta * (elapsed - mean);
          } else previousInterval = undefined;
        }
        lastPress = time;
      } else if (event.type === "visibilitychange" || event.type === "blur") {
        lastMove = lastPress = previousInterval = undefined;
        direction = undefined;
        scrollDirection = 0;
      }
    },
    snapshot(): Partial<BrowserBehavior> {
      const movement = movementIntervals.snapshot();
      return {
        mouseIntervalCount: movement.count,
        ...(movement.count > 0
          ? {
              mouseIntervalMeanMs: movement.mean,
              mouseIntervalStdDevMs: movement.stdDev,
            }
          : {}),
        ...Object.fromEntries(
          Object.entries(totals).map(([key, value]) => [
            key,
            Math.round(value),
          ]),
        ),
        interactionIntervalCount: intervals,
        ...(intervals > 0
          ? {
              interactionIntervalMeanMs: Math.round(mean),
              interactionIntervalStdDevMs: Math.round(
                Math.sqrt(Math.max(0, squaredDeviation / intervals)),
              ),
            }
          : {}),
      };
    },
    clear() {
      lastMove = lastPress = previousInterval = undefined;
      direction = undefined;
    },
  };
}
