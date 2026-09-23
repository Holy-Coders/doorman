import type {
  ApiActivitySummary,
  BrowserBehavior,
  BrowserObservation,
} from "@aarondovturkel/doorman-core";
import { ROUTE_CATEGORIES, parseFeatures } from "./schema.js";
import type { FeatureVector, RouteCategory } from "./schema.js";

const round = (value: number, step: number, max: number) =>
  Math.min(max, Math.max(0, Math.round(value / step) * step));
const ratio = (value: number) => round(value, 0.05, 1);
/** Explicit projection: route labels, fingerprints, keys and event trails never leave the application. */
export function extractFeatures(input: {
  activity?: ApiActivitySummary;
  routes?: Readonly<Record<string, RouteCategory>>;
  behavior?: BrowserBehavior;
  observation?: BrowserObservation;
  sequence?: FeatureVector;
}): FeatureVector {
  const result: FeatureVector = {};
  if (typeof input.observation?.automation?.webdriver === "boolean")
    result.webdriver = Number(input.observation.automation.webdriver);
  const environment = input.observation?.environment;
  if (environment?.runtimeMarkerCount !== undefined)
    result.runtime_marker_count = environment.runtimeMarkerCount;
  if (environment?.webdriverOwnProperty !== undefined)
    result.webdriver_own_property = Number(environment.webdriverOwnProperty);
  if (environment?.notificationPermission && environment.notificationQuery)
    result.notification_mismatch = Number(
      (environment.notificationPermission === "default"
        ? "prompt"
        : environment.notificationPermission) !== environment.notificationQuery,
    );
  const rows =
    input.activity?.buckets
      .slice(0, 128)
      .filter(
        (b) =>
          input.routes?.[b.route] &&
          ROUTE_CATEGORIES.includes(input.routes[b.route]!),
      ) ?? [];
  const requests = rows.reduce((n, r) => n + r.requests, 0);
  if (requests >= 5) {
    result.observation_duration_ms = round(
      Math.max(...rows.map((r) => r.lastSeenAt)) -
        Math.min(...rows.map((r) => r.firstSeenAt)),
      1000,
      900_000,
    );
    result.api_request_count = round(requests, 5, 1_000_000);
    result.api_denied_ratio = ratio(
      rows.reduce((n, r) => n + r.denied, 0) / requests,
    );
    result.api_error_ratio = ratio(
      rows.reduce((n, r) => n + r.clientErrors + r.serverErrors, 0) / requests,
    );
    result.api_duration_mean_ms = round(
      rows.reduce((n, r) => n + r.durationTotalMs, 0) / requests,
      50,
      60_000,
    );
    result.api_short_gap_ratio = ratio(
      rows.reduce((n, r) => n + r.shortGaps, 0) / requests,
    );
    for (const category of ROUTE_CATEGORIES)
      result[`route_${category}_share`] = ratio(
        rows
          .filter((r) => input.routes![r.route] === category)
          .reduce((n, r) => n + r.requests, 0) / requests,
      );
  }
  const b = input.behavior;
  if (b && (b.targetSampleCount ?? 0) >= 10) {
    result.target_sample_count = round(b.targetSampleCount!, 5, 1_000_000);
    if (b.targetCenterCount !== undefined)
      result.target_center_ratio = ratio(
        b.targetCenterCount / b.targetSampleCount!,
      );
    if (b.targetCornerCount !== undefined)
      result.target_corner_ratio = ratio(
        b.targetCornerCount / b.targetSampleCount!,
      );
  }
  if (b && (b.focusSampleCount ?? 0) >= 10) {
    if (b.focusChangeCount !== undefined)
      result.focus_change_count = round(b.focusChangeCount, 5, 1_000_000);
    if (b.unfocusedInputCount !== undefined)
      result.unfocused_input_ratio = ratio(
        b.unfocusedInputCount / b.focusSampleCount!,
      );
  }
  if (b?.decoyActivationCount !== undefined)
    result.decoy_activation_count = round(b.decoyActivationCount, 1, 1_000_000);
  // Missing APIs and sparse observations stay missing, rather than becoming bot evidence.
  if (
    b &&
    (b.mouseMoveCount >= 20 || (b.interactionIntervalCount ?? 0) >= 10)
  ) {
    result.observation_duration_ms = round(b.pageAgeMs, 1000, 900_000);
  }
  if (b && b.mouseMoveCount >= 20) {
    result.mouse_event_count = round(b.mouseMoveCount, 5, 1_000_000);
    if (
      b.mouseDistancePx !== undefined &&
      b.mouseActiveMs &&
      b.mouseActiveMs >= 1000
    )
      result.mouse_speed = round(
        (b.mouseDistancePx / b.mouseActiveMs) * 1000,
        100,
        10_000,
      );
    if (b.mouseDirectionChanges !== undefined)
      result.mouse_turn_ratio = ratio(
        b.mouseDirectionChanges / b.mouseMoveCount,
      );
    if (b.mousePauseCount !== undefined)
      result.mouse_pause_ratio = ratio(b.mousePauseCount / b.mouseMoveCount);
  }
  if (b && (b.mouseSampleCount ?? 0) >= 20) {
    if (b.mouseDistancePx !== undefined)
      result.mouse_step_mean_px = round(
        b.mouseDistancePx / b.mouseSampleCount!,
        5,
        50_000,
      );
    if (b.mouseLargeStepCount !== undefined)
      result.mouse_large_step_ratio = ratio(
        b.mouseLargeStepCount / b.mouseSampleCount!,
      );
    if (
      (b.mouseIntervalCount ?? 0) >= 10 &&
      (b.mouseIntervalMeanMs ?? 0) > 0 &&
      b.mouseIntervalStdDevMs !== undefined
    )
      result.mouse_interval_cv = round(
        b.mouseIntervalStdDevMs / b.mouseIntervalMeanMs!,
        0.1,
        10,
      );
  }
  if (
    b &&
    (b.interactionIntervalCount ?? 0) >= 10 &&
    b.interactionIntervalMeanMs !== undefined &&
    b.interactionIntervalStdDevMs !== undefined &&
    b.interactionIntervalMeanMs > 0
  ) {
    if (b.interactionShortGapCount !== undefined)
      result.interaction_short_gap_ratio = ratio(
        b.interactionShortGapCount / b.interactionIntervalCount!,
      );
    if (
      b.interactionRepeatGapCount !== undefined &&
      (b.interactionComparableGapCount ?? 0) > 0
    )
      result.interaction_repeat_gap_ratio = ratio(
        b.interactionRepeatGapCount / b.interactionComparableGapCount!,
      );
    result.interaction_sample_count = round(
      b.interactionIntervalCount!,
      5,
      1_000_000,
    );
    result.interaction_mean_ms = round(
      b.interactionIntervalMeanMs,
      100,
      60_000,
    );
    result.interaction_cv = round(
      b.interactionIntervalStdDevMs / b.interactionIntervalMeanMs,
      0.1,
      10,
    );
  }
  // A sequence summary is produced by the server-owned tracker below, never browser claims.
  const sequence = parseFeatures(input.sequence ?? {});
  for (const [name, value] of Object.entries(sequence))
    if (
      name.startsWith("transition_") ||
      name === "api_sequence_repeat_ratio" ||
      name === "api_gap_mean_ms" ||
      name === "api_gap_cv"
    )
      result[name as keyof FeatureVector] = value;
  return parseFeatures(result);
}

/** One server-owned session/window. Constant memory; no URLs, coordinates or exact timestamps in snapshots.
 * Keep with your session owner, or feed an ordered persisted event stream during feature extraction.
 * Do not use a process-global tracker or combine independently ordered workers.
 */
export function createSequenceTracker() {
  let previous: RouteCategory | undefined, previousTime: number | undefined;
  let count = 0,
    gaps = 0,
    mean = 0,
    variance = 0;
  const edges = new Map<string, number>();
  return {
    observe(category: RouteCategory, elapsedMs: number) {
      if (
        !ROUTE_CATEGORIES.includes(category) ||
        !Number.isFinite(elapsedMs) ||
        elapsedMs < 0 ||
        (previousTime !== undefined && elapsedMs < previousTime) ||
        count >= 256
      )
        return;
      if (previous && previousTime !== undefined) {
        const edge = `transition_${previous}_${category}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
        const gap = elapsedMs - previousTime;
        // Exclude long idle gaps from interval statistics; category transitions still count.
        if (gap <= 60_000) {
          gaps++;
          const delta = gap - mean;
          mean += delta / gaps;
          variance += delta * (gap - mean);
        }
      }
      count++;
      previous = category;
      previousTime = elapsedMs;
    },
    snapshot(): FeatureVector {
      if (count < 10) return {};
      const features: FeatureVector = {};
      for (const a of ROUTE_CATEGORIES)
        for (const b of ROUTE_CATEGORIES) {
          const key = `transition_${a}_${b}` as const;
          features[key] = ratio((edges.get(key) ?? 0) / (count - 1));
        }
      features.api_sequence_repeat_ratio = ratio(
        [...edges.values()].reduce((n, v) => n + Math.max(0, v - 1), 0) /
          (count - 1),
      );
      if (gaps >= 10 && mean > 0) {
        features.api_gap_mean_ms = round(mean, 100, 60_000);
        features.api_gap_cv = round(
          Math.sqrt(Math.max(0, variance / gaps)) / mean,
          0.1,
          10,
        );
      }
      return features;
    },
  };
}
