import * as amplitude from "@amplitude/analytics-browser";
import { posthog } from "posthog-js";
import mixpanel from "mixpanel-browser";
import { createIdentityAnalytics, createJanitorClient } from "@janitor/browser";

posthog.init("phc_local_test", {
  api_host: location.origin + "/vendor/posthog",
  persistence: "localStorage",
  autocapture: false,
  capture_pageview: false,
  disable_session_recording: true,
  advanced_disable_feature_flags: true,
  disable_compression: true,
  request_batching: false,
  disable_external_dependency_loading: true,
  opt_out_useragent_filter: true, // Test-only: allow this headless browser to emit SDK events.
});
mixpanel.init("local_test", {
  api_host: location.origin + "/vendor/mixpanel",
  persistence: "localStorage",
  batch_requests: false,
  autocapture: false,
  track_pageview: false,
  record_sessions_percent: 0,
  ip: false,
});
const analytics = createIdentityAnalytics({ posthog, mixpanel });
const janitor = createJanitorClient({ analytics: { posthog, mixpanel } });
posthog.capture("demo viewed");
mixpanel.track("demo viewed");
const amplitudeIdentity = createIdentityAnalytics({ amplitude });
const demo = {
  amplitude: {
    async start() {
      await amplitude.init("local-amplitude-test", {
        autocapture: false,
        fetchRemoteConfig: false,
        serverUrl: location.origin + "/vendor/amplitude",
        flushQueueSize: 1,
        flushIntervalMillis: 25,
      }).promise;
    },
    async identify(id: string) {
      amplitudeIdentity.identifyUser(id, { plan: "pro" });
      await amplitudeIdentity.flush();
    },
    async reset() {
      amplitudeIdentity.reset();
      await amplitudeIdentity.flush();
    },
    snapshot() {
      return {
        userId: amplitude.getUserId(),
        deviceId: amplitude.getDeviceId(),
      };
    },
  },
  janitor,
  login(id: string) {
    return analytics.identifyUser(id, { plan: "test" });
  },
  logout() {
    return analytics.reset();
  },
  snapshot() {
    return {
      posthog: posthog.get_distinct_id(),
      mixpanel: mixpanel.get_distinct_id(),
      device: mixpanel.get_property("$device_id") as string,
    };
  },
};
declare global {
  interface Window {
    analyticsDemo: typeof demo;
  }
}
window.analyticsDemo = demo;
