# Optional detection signals

Doorman can collect more evidence about a browser environment and how it is operated. Enable the probes you need; additional probes are **off in minimal collection**. They add measurements to your existing identity and risk pipeline, not automatic blocking rules.

The `collection: "extended"` profile works with the current browser client and the TypeScript or native Phoenix endpoint. Python and Go relay those browser measurements to their configured engine. Start with minimal collection and enable more only when useful to your application.

## Enable extended collection

```ts
import { createDoormanClient } from "@aarondovturkel/doorman-browser";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  collection: "extended",
});
await doorman.identify();
// On teardown or collection withdrawal:
doorman.destroy();
```

This enables bounded behavior, local-font, page-font, runtime, permission, target and focus summaries. It does not enable a decoy. Minimal collection remains the default. The names below describe the individual probes included in the profile.

Use `enabled: false` and `setEnabled(true)` when your application's collection policy requires an explicit start. Pausing, resetting and destroying the client remove listeners and the optional decoy. A pending probe cannot send a request after collection is paused. Font and permission probes have a 250 ms deadline and return unknown on timeout. The probes make no network requests and never ask the browser to grant a permission.

## Fonts: useful environment evidence, not a person identifier

`fonts: true` tests these 12 families, in this fixed order: Arial, Times New Roman, Courier New, Verdana, Georgia, Trebuchet MS, Helvetica Neue, Menlo, Segoe UI, Consolas, Roboto, Noto Sans.

Each test loads an unattached `FontFace` with a **local-only** source. It does not download a font, add a face to your page, request Local Font Access permission or enumerate installed fonts. The result is `{ version: "local-12-v1", available: "111000000000" }`: a bounded bit string, not a hash of rendered pixels. A browser may expose only a restricted set. Doorman accepts that result and does not try to recover hidden fonts. If nothing is available, the font comparison stays unknown.

Two nonempty sets are compared using their intersection divided by their union. Set `scoring.similarity.fontSimilarity` on the TypeScript server to give this evidence a small weight:

```ts
const doorman = createDoorman({
  db,
  secret: process.env.DOORMAN_IDENTITY_SECRET!,
  namespace: "my-app",
  scoring: { similarity: { fontSimilarity: 0.05 } },
});
```

The default weight is zero pending calibration. Jev can see fonts when you collect them. Matching fonts cannot satisfy the minimum evidence requirement by themselves, override a platform contradiction or resolve a tie between otherwise identical candidates. Fonts are compared inside the existing bounded candidate set; they do not add a database scan.

Many unrelated people share the same font set. The same person can have different sets on their phone and laptop. Fonts help compare **browser environments**; account authentication and verified links remain the basis for connecting a person across devices.

`pageFonts: true` is a different measurement: it counts loaded, loading and failed faces among at most 100 entries in the page's font set. It reads neither their names nor their source URLs. A failed download can be an ordinary network, policy or application failure. `document.fonts.check()` is not used as a local-font inventory: its purpose is load readiness, and it can report success for a nonexistent family.

## Runtime and permissions

`runtime: true` checks descriptors for eight fixed legacy automation marker names and whether `webdriver` is an own property on `navigator`. It never executes those property getters or scans every global. Extensions and test code can expose markers; modern automation can expose none. This does not identify an AI provider or prove a CDP connection.

`permissions: true` reads the Notifications permission and the Permissions API's notification state. It never requests permission or subscribes to permission changes. Differences are supplied as context, with browser implementation and enterprise-policy caveats. An unsupported or denied API is not a suspicious verdict.

## Targets, focus and an inert decoy

`targets: true` briefly reads mouse pointer-down coordinates and the target element's rectangle. It retains three counters: eligible samples, clicks in the central 10% of both dimensions, and clicks in the top-left 5% of both dimensions. Targets smaller than 16 pixels, touch input and keyboard activations are excluded. Coordinates, rectangles, element names, text and selectors are never retained or sent. The feature extractor emits ratios only after ten eligible samples. Layout, assistive input and remote desktops can explain alignment.

`focus: true` counts captured focus/blur events and input while `document.hasFocus()` is false. It records no screenshot information. Our local Chromium, Firefox and WebKit experiment took twenty screenshots per engine and observed **zero focus or visibility changes caused by those captures**. That finding does not cover every OS capture tool, but it rejects the assumption that ordinary browser screenshots necessarily blink focus.

## Trusted transport evidence

```ts
import { cloudflareRequestEvidence } from "@aarondovturkel/doorman-adapters/cloudflare";
const edge = cloudflareRequestEvidence(request, { transport: true });
const assessment = await doorman.assess(request, { evidence: { edge } });
return assessment.response;
```

This explicitly includes an available, validated JA4 string from the original Worker's `request.cf.botManagement.ja4`. It ignores client headers and browser JSON. Missing metadata remains absent. Availability depends on Cloudflare's Bot Management plan and request path. JA4 describes a transport client configuration shared by many devices; it is not a unique device or person and is not immune to imitation. Doorman keeps it in the private evidence envelope, without automatic persistence, identity matching or transmission to Jev.

## Read scores, not conclusions

The configured Jev evaluator can use these bounded measurements for [activity scores](AGENT-CLASSIFICATION.md). No training job or numeric feature-export pipeline is needed. More measurements do not automatically improve accuracy: privacy browsers, accessibility tools, remote desktops and ordinary developer tools need to be included in your controls.

The recorded public-data evaluation did not establish reliable human/agent separation. No CDP timing detector, screenshot detector or automatic agent-brand recognition ships in this profile. See [testing and limitations](VALIDATION.md).

## Primary sources

- [CSS Font Loading specification](https://drafts.csswg.org/css-font-loading/): local font sources and asynchronous loading.
- [Local Font Access specification](https://wicg.github.io/local-font-access/): permission-controlled font enumeration, which Doorman does not invoke.
- [Permissions specification](https://www.w3.org/TR/permissions/): read-only state queries and browser policy.
- [Pointer Events specification](https://www.w3.org/TR/pointerevents/): event delivery and coalescing; missing intermediate motion is not physical proof.
- [Chrome headless documentation](https://developer.chrome.com/docs/automation-and-testing/headless): shared browser implementation, undermining simplistic environment assumptions.
- [Chrome DevTools Page protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/): screenshot capture is a browser operation, not a guaranteed page focus event.
- [Cloudflare Request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/) and [JA4 availability](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/).
- [W3C fingerprinting guidance](https://www.w3.org/TR/fingerprinting-guidance/): combined signals can be identifying even when each is modest.

## Latest validation

The [expanded experiments](VALIDATION.md) include real Jev calls, same-process CDP controls, app-font downloads and a public font-data audit. The new operator prompt did not reliably distinguish humans from agents in its public-data sample. The default font weight remains zero and optional probes remain disabled unless configured.
