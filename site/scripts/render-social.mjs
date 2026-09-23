import { chromium } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
/* global document -- the evaluated callback runs inside Chromium. */

// Run the built site on localhost:4357 first (node tests/site/server.mjs).
// Reuse the site's bundled fonts; no remote image or font dependencies.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:4357/");
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.body.innerHTML = `
      <main style="position:relative;width:1200px;height:630px;overflow:hidden;background:#080c0c;">
        <img src="/media/continuity-poster.webp" alt="" style="position:absolute;width:1200px;height:675px;top:0;left:95px;">
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,#080c0c 10%,#080c0cf2 28%,transparent 72%)"></div>
        <div style="position:relative;padding:55px 64px;">
          <div style="font-size:34px;letter-spacing:-1px;display:flex;align-items:center;gap:8px;"><img src="/janitor-mark.webp" width="42" height="42" alt="">janitor</div>
          <h1 style="font-size:79px;line-height:1.02;letter-spacing:-4.5px;font-weight:500;margin:66px 0 25px;">Know who’s<br>behind the request.</h1>
          <p style="font-size:20px;line-height:1.6;color:#a9b6af;max-width:450px;">Identity context for humans and agents.<br>Powered by Jev. Owned by you.</p>
          <p style="font-family:var(--mono);font-size:12px;color:#b6f5ce;margin-top:40px;">Open source / TypeScript + Elixir / Your infrastructure</p>
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
