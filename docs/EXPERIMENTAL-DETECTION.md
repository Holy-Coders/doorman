# Optional detection signals

Janitor can collect more evidence about a browser environment and how it is operated. Enable the probes you need; every option below is **off by default**. They add measurements to your existing identity and risk pipeline, not automatic blocking rules.

These are current source features. The browser collector works with every backend that accepts the updated HTTP schema. Native Phoenix preserves the new fields and sends them to Jev; configurable deterministic font weighting and linked API activity currently run in the TypeScript server packages. Python and Go can call that server. Older published packages do not contain these additions.

## Enable a collection profile

```ts
import { createVisitorClient } from "@janitor/browser";

const visitor = createVisitorClient({
  endpoint: "/api/visitor",
  behavior: "extended",
  detection: {
    fonts: true,
    pageFonts: true,
    runtime: true,
    permissions: true,
    targets: true,
    focus: true,
    // decoy: true, // Separate, inert application experiment; usually leave off.
  },
});
const identity = await visitor.identify();
// On unmount or collection withdrawal:
visitor.destroy();
```

Use `enabled: false` and `setEnabled(true)` when your application's collection policy requires an explicit start. Pausing, resetting and destroying the client remove listeners and the optional decoy. A pending probe cannot send a request after collection is paused. Font and permission probes have a 250 ms deadline and return unknown on timeout. The probes make no network requests and never ask the browser to grant a permission.

## Fonts: useful environment evidence, not a person identifier

`fonts: true` tests these 12 families, in this fixed order: Arial, Times New Roman, Courier New, Verdana, Georgia, Trebuchet MS, Helvetica Neue, Menlo, Segoe UI, Consolas, Roboto, Noto Sans.

Each test loads an unattached `FontFace` with a **local-only** source. It does not download a font, add a face to your page, request Local Font Access permission or enumerate installed fonts. The result is `{ version: "local-12-v1", available: "111000000000" }`: a bounded bit string, not a hash of rendered pixels. A browser may expose only a restricted set. Janitor accepts that result and does not try to recover hidden fonts. If nothing is available, the font comparison stays unknown.

Two nonempty sets are compared using their intersection divided by their union. Set `scoring.similarity.fontSimilarity` on the TypeScript server to give this evidence a small weight:

```ts
const janitor = createNodeVisitor({
  db,
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

`focus: true` counts captured focus/blur events and input while `document.hasFocus()` is false. It records no screenshot information. Our local Chromium, Firefox and WebKit experiment took five screenshots per engine and observed **zero focus or visibility changes caused by those captures**. That finding does not cover every OS capture tool, but it rejects the assumption that ordinary browser screenshots necessarily blink focus.

`decoy: true` adds a hidden, inert diagnostic button with no action, link or form submission. It is excluded from normal tab order and the accessibility tree. A programmatic `.click()` increments a counter. Keyboard activation of the real test button did not activate the decoy. That is a functional control, not a full assistive-technology study. Testing tools can activate the decoy; an activation does not prove an attack. You can also manage it separately with `createInteractionDecoy(container)` and its `snapshot()` / `destroy()` methods.

## Trusted transport evidence

```ts
import { cloudflareRequestEvidence } from "@janitor/adapters/cloudflare";
const edge = cloudflareRequestEvidence(request, { transport: true });
const assessment = await janitor.assess(request, { evidence: { edge } });
return assessment.response;
```

This explicitly includes an available, validated JA4 string from the original Worker's `request.cf.botManagement.ja4`. It ignores client headers and browser JSON. Missing metadata remains absent. Availability depends on Cloudflare's Bot Management plan and request path. JA4 describes a transport client configuration shared by many devices; it is not a unique device or person and is not immune to imitation. Janitor keeps it in the private evidence envelope, without automatic persistence, identity matching or transmission to Jev.

## From measurements to a useful model

`extractFeatures({ observation, behavior })` now projects runtime marker count, own-webdriver flag, permission-state mismatch, supported target ratios, focus aggregates and decoy count into the strict numeric operator/learning schema. Fonts and full fingerprints stay out of that shared feature vector. The `operators-v3` Jev prompt explains the new features and their confounders. Sparse evidence still produces an unknown operator; a runtime marker alone cannot label a human, assistant or script.

Keep labels from controlled runs, verified delegation and reviewed incidents. Fit on training groups, choose thresholds on validation groups and report performance on untouched users, environments and agent versions. Inspect accessibility, privacy-browser, touch, remote-desktop and ordinary developer-tool controls. Do not turn the model's predictions into training truth. [The classifier workflow](CLASSIFIER.md) already supports versioned exports, holdouts, shadow evaluation and rollback.

Run `pnpm benchmark:detection` for the local browser experiments. The [aggregate report](benchmarks/experimental-probes-2026-09-23.json) includes the measured results and the separately launched no-CDP Chromium control. That control requires mock-keychain flags on this Mac; launch defaults still differ, so it does not isolate every timing confounder. Timing probes exist only in this benchmark; no CDP timing score or screenshot detector ships in the collector. Public datasets do not contain these new probes, so replaying them cannot establish the probes' accuracy. [Public dataset results](EXTERNAL-BENCHMARKS.md) measure the older overlapping feature set.

## Primary sources

- [CSS Font Loading specification](https://drafts.csswg.org/css-font-loading/): local font sources and asynchronous loading.
- [Local Font Access specification](https://wicg.github.io/local-font-access/): permission-controlled font enumeration, which Janitor does not invoke.
- [Permissions specification](https://www.w3.org/TR/permissions/): read-only state queries and browser policy.
- [Pointer Events specification](https://www.w3.org/TR/pointerevents/): event delivery and coalescing; missing intermediate motion is not physical proof.
- [Chrome headless documentation](https://developer.chrome.com/docs/automation-and-testing/headless): shared browser implementation, undermining simplistic environment assumptions.
- [Chrome DevTools Page protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/): screenshot capture is a browser operation, not a guaranteed page focus event.
- [Cloudflare Request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/) and [JA4 availability](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/).
- [W3C fingerprinting guidance](https://www.w3.org/TR/fingerprinting-guidance/): combined signals can be identifying even when each is modest.
