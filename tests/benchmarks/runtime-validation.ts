/** Research fixture: controlled CDP attachment, never a production detector. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Measurement = {
  descriptorMs: number;
  prototypeMs: number;
  timerMaxMs: number;
  focusChanges: number;
  visibilityChanges: number;
  markers: number;
};
type Row = Measurement & {
  process: number;
  headed: boolean;
  loaded: boolean;
  mode: string;
  captures: number;
};
let command: { loaded: boolean } | undefined;
let receive: ((row: Measurement) => void) | undefined;
const script = `
import {collectDetectionSignals} from '/collector.js';
let focus=0,visibility=0;
addEventListener('focus',()=>focus++);addEventListener('blur',()=>focus++);
document.addEventListener('visibilitychange',()=>visibility++);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
for(;;){
 const c=await (await fetch('/command')).json();if(!c){await wait(20);continue;}
 const f=focus,v=visibility,ds=[],ps=[],ts=[];
 const load=c.loaded?setInterval(()=>{const end=performance.now()+10;while(performance.now()<end) Math.sqrt(Math.random());},16):null;
 for(let j=0;j<20;j++){
  let t=performance.now();for(let i=0;i<2000;i++)Object.getOwnPropertyDescriptor(navigator,'webdriver');ds.push(performance.now()-t);
  t=performance.now();for(let i=0;i<2000;i++)Object.getPrototypeOf(navigator);ps.push(performance.now()-t);
  t=performance.now();await wait(20);ts.push(performance.now()-t);
 }
 if(load!==null)clearInterval(load);
 const signals=await collectDetectionSignals({runtime:true});
 await fetch('/result',{method:'POST',body:JSON.stringify({descriptorMs:median(ds),prototypeMs:median(ps),timerMaxMs:Math.max(...ts),focusChanges:focus-f,visibilityChanges:visibility-v,markers:signals.environment?.runtimeMarkerCount??-1})});
}`;
const server = createServer((req, res) => {
  if (req.url === "/collector.js")
    void readFile("artifacts/browser-benchmark/collector.js").then((b) =>
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(b),
    );
  else if (req.url === "/command") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(command ?? null));
    command = undefined;
  } else if (req.url === "/result" && req.method === "POST") {
    let text = "";
    req.on("data", (b) => {
      text += String(b);
      if (text.length > 8192) req.destroy();
    });
    req.on("end", () => {
      receive?.(JSON.parse(text) as Measurement);
      res.end();
    });
  } else
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        `<!doctype html><title>Doorman isolated runtime research</title><button>Test fixture</button><script type="module">${script}</script>`,
      );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(Error("CDP connection failed"));
  });
  let id = 0;
  const pending = new Map<
    number,
    { resolve: () => void; reject: (e: Error) => void }
  >();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; error?: unknown };
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(Error("CDP command failed"));
      else p?.resolve();
    }
  };
  return {
    send(method: string, params: Record<string, unknown> = {}) {
      return new Promise<void>((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () =>
      new Promise<void>((r) => {
        ws.onclose = () => r();
        ws.close();
      }),
  };
}
const rows: Row[] = [];
try {
  for (let process = 0; process < 8; process++) {
    const headed = process >= 4;
    const profile = await mkdtemp(join(tmpdir(), "doorman-cdp-validation-"));
    const child = spawn(
      chromium.executablePath(),
      [
        ...(!headed ? ["--headless"] : []),
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--use-mock-keychain",
        "--password-store=basic",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-features=HttpsUpgrades",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        `--user-data-dir=${profile}`,
        origin,
      ],
      { stdio: "ignore" },
    );
    try {
      let port: string | undefined;
      for (let i = 0; i < 100 && !port; i++) {
        port = await readFile(join(profile, "DevToolsActivePort"), "utf8")
          .then((s) => s.split("\n")[0])
          .catch(() => undefined);
        if (!port) await pause(100);
      }
      assert(port, "Chromium debugging listener started");
      const pages = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const target = pages.find((p) => p.type === "page");
      assert(target);
      await pause(300); // All phases retain identical launch flags and profile.
      for (let repeat = 0; repeat < 2; repeat++)
        for (const loaded of [false, true]) {
          const modes = ["detached", "attached-idle", "evaluate", "screenshot"];
          const shift = (process + repeat + Number(loaded)) % modes.length;
          for (const mode of [
            ...modes.slice(shift),
            ...modes.slice(0, shift),
          ]) {
            const cdp =
              mode === "detached"
                ? undefined
                : await connect(target.webSocketDebuggerUrl);
            try {
              if (cdp) await cdp.send("Runtime.enable");
              let active = true,
                captures = 0;
              const traffic = (async () => {
                while (
                  active &&
                  cdp &&
                  (mode === "evaluate" || mode === "screenshot")
                ) {
                  await cdp.send(
                    mode === "evaluate"
                      ? "Runtime.evaluate"
                      : "Page.captureScreenshot",
                    mode === "evaluate"
                      ? { expression: "1 + 1", returnByValue: true }
                      : { format: "png" },
                  );
                  if (mode === "screenshot") captures++;
                  await pause(50);
                }
              })();
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                const measurement = await new Promise<Measurement>(
                  (resolve, reject) => {
                    receive = resolve;
                    command = { loaded };
                    timer = setTimeout(
                      () => reject(Error("Fixture phase timed out")),
                      10000,
                    );
                  },
                );
                rows.push({
                  ...measurement,
                  process,
                  headed,
                  loaded,
                  mode,
                  captures,
                });
              } finally {
                active = false;
                clearTimeout(timer);
                receive = undefined;
                await traffic;
              }
            } finally {
              if (cdp) {
                await cdp.send("Runtime.disable");
                await cdp.close();
              }
            }
          }
        }
      console.log(`Runtime process ${process + 1}/8 complete`);
    } finally {
      child.kill("SIGTERM");
      for (
        let i = 0;
        i < 30 && child.exitCode === null && child.signalCode === null;
        i++
      )
        await pause(100);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
  const summary = [false, true].flatMap((headed) =>
    [false, true].flatMap((loaded) =>
      ["detached", "attached-idle", "evaluate", "screenshot"].map((mode) => {
        const subset = rows.filter(
          (r) => r.headed === headed && r.loaded === loaded && r.mode === mode,
        );
        const values = (key: keyof Measurement) =>
          subset.map((r) => r[key]).sort((a, b) => a - b);
        return {
          headed,
          loaded,
          mode,
          phases: subset.length,
          descriptorMs: values("descriptorMs"),
          prototypeMs: values("prototypeMs"),
          timerMaxMs: values("timerMaxMs"),
          focusChanges: subset.reduce((s, r) => s + r.focusChanges, 0),
          visibilityChanges: subset.reduce(
            (s, r) => s + r.visibilityChanges,
            0,
          ),
          runtimeMarkerCounts: [...new Set(values("markers"))],
          screenshots: subset.reduce((s, r) => s + r.captures, 0),
        };
      }),
    ),
  );
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    executable: chromium.executablePath().split("/").at(-4),
    processes: 8,
    phases: rows.length,
    method:
      "Same-process counterbalanced CDP attachment; all launches have a debugging listener. 2 repeats, 2 loads, 4 modes. Headed and headless isolated profiles on one host.",
    summary,
    limitations: [
      "No human or AI assistant labels; phases within one process are correlated.",
      "A detached debugger with a listening debugging port is not a stock end-user browser.",
      "Timing differences are environment-specific, not a validated CDP detector.",
      "Browser screenshot API only; no OS screenshot or extension capture tested.",
    ],
    productionPromoted: false,
  };
  await writeFile(
    "artifacts/browser-benchmark/runtime-validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
