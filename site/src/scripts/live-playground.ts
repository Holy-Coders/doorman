import { collectBrowserSignals, createBehaviorTracker } from "@aarondovturkel/doorman-browser";
import type { BrowserObservation, BrowserBehavior } from "@aarondovturkel/doorman-core";

const lab = document.querySelector<HTMLElement>("[data-live-playground]");
if (lab) {
  const get = <T extends Element>(selector: string) =>
    lab.querySelector<T>(selector)!;
  const consent = get<HTMLInputElement>("[data-live-consent]");
  const start = get<HTMLButtonElement>("[data-live-start]");
  const actions = get<HTMLElement>("[data-live-actions]");
  const output = get<HTMLElement>("[data-live-output]");
  let active = false,
    busy = false;
  let tracker: ReturnType<typeof createBehaviorTracker> | undefined;
  let snapshot:
    { signals: BrowserObservation; behavior: BrowserBehavior } | undefined;
  let controller: AbortController | undefined;
  const set = (name: string, value: string) => {
    get<HTMLElement>(`[data-live-${name}]`).textContent = value;
  };
  function buttons() {
    start.disabled = busy || !consent.checked || active;
    consent.disabled = busy || active;
    actions.hidden = !active;
    actions.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.disabled = busy || (!tracker && !b.hasAttribute("data-live-erase"));
    });
    output.setAttribute("aria-busy", String(busy));
  }
  async function api(action: string, body?: unknown, method = "POST") {
    controller = new AbortController();
    const current = controller;
    const timer = setTimeout(() => current.abort(), 12_000);
    try {
      const response = await fetch(`/api/playground/${action}`, {
        method,
        credentials: "same-origin",
        signal: current.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Doorman-Playground": "1",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = (await response.json()) as {
        error?: string;
        visitorId: string;
        isReturning: boolean;
        evaluation: {
          source: "jev" | "cache" | "fallback";
          evaluatedAt?: number;
        };
      };
      if (!response.ok)
        throw new Error(
          result.error ?? "The live demo is unavailable. Try again later.",
        );
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  async function measure(fresh: boolean) {
    if (fresh || !snapshot)
      snapshot = {
        signals: collectBrowserSignals(),
        behavior: tracker!.snapshot(),
      };
    set(
      "status",
      "Sending this snapshot to Doorman. The server is checking your browser history.",
    );
    const result = await api("identify", snapshot);
    set("snapshot", JSON.stringify(snapshot, null, 2));
    set("json", JSON.stringify(result, null, 2));
    set("id", result.visitorId);
    set(
      "returning",
      result.isReturning ? "Returning browser" : "New browser ID",
    );
    const source = result.evaluation.source;
    set(
      "source",
      source === "jev"
        ? "Live Jev response"
        : source === "cache"
          ? "Private cache hit"
          : "Built-in matching",
    );
    set(
      "evaluation",
      source === "jev"
        ? "Evaluated by Jev · scores private"
        : source === "cache"
          ? "Previously evaluated snapshot · scores private"
          : "AI unavailable · deterministic matching used",
    );
    set(
      "status",
      `${result.isReturning ? "Doorman recognized a browser in your demo history." : "Doorman created a visitor ID for this demo."} ${source === "cache" ? "This evaluation came from the private cache; no new Jev call was needed." : source === "jev" ? "Jev evaluated the snapshot on our server." : "The AI allowance may be paused, busy or exhausted. Your browser ID still works."}`,
    );
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    buttons();
    try {
      await fn();
    } catch (error) {
      set(
        "status",
        error instanceof Error && error.name !== "AbortError"
          ? error.message
          : "The request timed out. There is no automatic retry; try again when ready.",
      );
    } finally {
      busy = false;
      buttons();
    }
  }
  consent.addEventListener("change", buttons);
  start.addEventListener("click", () => {
    void run(async () => {
      if (!consent.checked) return;
      await api("session", { consent: true });
      active = true;
      tracker = createBehaviorTracker();
      set("state", "Live session active");
      await measure(true);
    });
  });
  get<HTMLButtonElement>("[data-live-measure]").addEventListener(
    "click",
    () => {
      void run(() => measure(true));
    },
  );
  get<HTMLButtonElement>("[data-live-repeat]").addEventListener("click", () => {
    void run(() => measure(false));
  });
  get<HTMLButtonElement>("[data-live-recover]").addEventListener(
    "click",
    () => {
      void run(async () => {
        await api("forget-cookie");
        await measure(false);
      });
    },
  );
  get<HTMLButtonElement>("[data-live-erase]").addEventListener("click", () => {
    void run(async () => {
      tracker?.destroy();
      tracker = undefined;
      snapshot = undefined;
      set("state", "Collection stopped");
      set("snapshot", "// Local snapshot discarded.");
      await api("session", undefined, "DELETE");
      active = false;
      snapshot = undefined;
      consent.checked = false;
      set("state", "Stopped & erased");
      set("source", "Not collecting");
      set(
        "status",
        "Your demo history, private evaluation cache and demo cookies were erased. The shared spending counters remain so erasure cannot reset the allowance.",
      );
      for (const field of ["id", "returning", "evaluation"]) set(field, "—");
      set("json", "// Demo data erased.");
      set("snapshot", "// Nothing collected.");
    });
  });
  window.addEventListener("pagehide", () => {
    tracker?.destroy();
    tracker = undefined;
    active = false;
    snapshot = undefined;
    consent.checked = false;
    controller?.abort();
    set("state", "Not collecting");
    buttons();
  });
  buttons();
}
