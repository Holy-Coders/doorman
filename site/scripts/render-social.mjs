import { chromium } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
/* global document -- the evaluated callback runs inside Chromium. */

// Run the built site on localhost:4357 first (node tests/site/server.mjs).
// Render the real pixel illustration with the site's bundled fonts and logo.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await page.goto("http://127.0.0.1:4357/");
  await page.locator('[data-doorway][data-ready="true"]').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    const illustration = document
      .querySelector("[data-doorway-canvas]")
      .toDataURL();
    document.body.innerHTML = `
      <main style="position:relative;width:1200px;height:630px;overflow:hidden;background:#fff5e3;color:#171510;">
        <div style="position:absolute;left:660px;top:28px;width:512px;height:574px;border-radius:24px;background:#080908;overflow:hidden;">
          <div style="display:flex;gap:8px;padding:28px 25px;font-size:13px"><span style="background:#f5aacb;color:#171510;padding:9px 16px;border-radius:30px">Human</span><span style="background:#d9f35c;color:#171510;padding:9px 16px;border-radius:30px">Robot</span><span style="background:#baaff2;color:#171510;padding:9px 16px;border-radius:30px">Assistant</span></div>
          <p style="position:absolute;top:112px;left:20px;font-size:85px;font-weight:700;letter-spacing:-7px;color:transparent;-webkit-text-stroke:1px #444838;">DOORMAN</p>
          <img src="${illustration}" style="position:absolute;left:-54px;top:160px;width:620px;height:310px" alt="">
          <p style="position:absolute;bottom:25px;left:28px;font-size:17px;color:#fff5e3;">One account. Different operators.</p>
        </div>
        <div style="position:relative;padding:38px 50px;width:650px;">
          <div style="font-size:32px;letter-spacing:-1.5px;font-weight:700;display:flex;align-items:center;gap:9px;"><img src="/doorman-mark-dark.png" width="48" height="48" alt="">doorman.</div>
          <h1 style="font-size:78px;line-height:1.02;letter-spacing:-5px;font-weight:700;margin:70px 0 24px;">Know who’s<br>behind the<br>request.</h1>
          <p style="font-size:18px;line-height:1.55;color:#615445;">First-party identity for people and agents.<br>Your analytics. Your infrastructure.</p>
          <p style="font-size:12px;color:#615445;margin-top:32px;">Open source · Powered by Jev · Developer preview</p>
        </div>
      </main>`;
    await Promise.all([...document.images].map((img) => img.decode()));
  });
  await page.screenshot({
    path: fileURLToPath(new URL("../public/social.png", import.meta.url)),
  });
} finally {
  await browser.close();
}
