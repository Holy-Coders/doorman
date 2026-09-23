const dialog = document.querySelector<HTMLDialogElement>("#search-dialog");
const input = document.querySelector<HTMLInputElement>("#docs-search");
const results = document.querySelector<HTMLElement>("#search-results");
type SearchEntry = {
  title: string;
  description: string;
  url: string;
  text: string;
};
let index: SearchEntry[] | undefined;
let pendingIndex: Promise<SearchEntry[]> | undefined;
async function search() {
  if (!input || !results) return;
  try {
    pendingIndex ??= fetch("/search-index.json").then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json() as Promise<SearchEntry[]>;
    });
    index ??= await pendingIndex;
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = index
      .map((entry) => ({
        entry,
        score: words.reduce(
          (score, word) =>
            score +
            (entry.url.split("/").includes(word) ? 16 : 0) +
            (entry.title.toLowerCase().includes(word) ? 12 : 0) +
            (entry.description.toLowerCase().includes(word) ? 5 : 0) +
            (entry.text.toLowerCase().includes(word) ? 1 : 0),
          0,
        ),
      }))
      .filter(
        (item) =>
          !words.length ||
          words.every((word) =>
            (
              item.entry.title +
              " " +
              item.entry.url +
              " " +
              item.entry.description +
              " " +
              item.entry.text
            )
              .toLowerCase()
              .includes(word),
          ),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    results.replaceChildren();
    if (!matches.length) {
      const message = document.createElement("p");
      message.className = "search-empty";
      message.textContent =
        "No pages found. Try a broader term such as “cookie” or “storage”.";
      results.append(message);
    }
    for (const { entry } of matches) {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = entry.url;
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const description = document.createElement("p");
      description.textContent = entry.description;
      link.append(title, description);
      results.append(link);
    }
  } catch {
    pendingIndex = undefined;
    results.textContent =
      "Search could not load. Browse the documentation or try again.";
  }
}
function openSearch() {
  if (!dialog || !input) return;
  document
    .querySelectorAll<HTMLDetailsElement>(".mobile-nav")
    .forEach((menu) => (menu.open = false));
  dialog.showModal();
  input.focus();
  void search();
}
document
  .querySelectorAll<HTMLButtonElement>("[data-search]")
  .forEach((button) => button.addEventListener("click", openSearch));
document
  .querySelector("[data-close-search]")
  ?.addEventListener("click", () => dialog?.close());
dialog?.addEventListener("click", (event) => {
  if (
    event.target === dialog &&
    (event.clientX < dialog.getBoundingClientRect().left ||
      event.clientX > dialog.getBoundingClientRect().right ||
      event.clientY < dialog.getBoundingClientRect().top ||
      event.clientY > dialog.getBoundingClientRect().bottom)
  )
    dialog.close();
});
input?.addEventListener("input", () => {
  void search();
});
input?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    results?.querySelector<HTMLAnchorElement>("a")?.focus();
  }
  if (event.key === "Enter")
    results?.querySelector<HTMLAnchorElement>("a")?.click();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (dialog?.open) dialog.close();
    else openSearch();
  }
});

async function copy(button: HTMLButtonElement, code: string) {
  try {
    await navigator.clipboard.writeText(code);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = original), 1800);
  } catch {
    button.textContent = "Select code to copy";
  }
}
document.querySelectorAll<HTMLElement>("[data-code-tabs]").forEach((group) => {
  const tabs = Array.from(
    group.querySelectorAll<HTMLButtonElement>("[data-tab]"),
  );
  const select = (tab: HTMLButtonElement) => {
    tabs.forEach((button) => {
      const active = tab === button;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(
        button.getAttribute("aria-controls") ?? "",
      );
      if (panel) panel.hidden = !active;
    });
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const next =
        tabs[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length
        ];
      if (next) {
        select(next);
        next.focus();
      }
    });
  });
  group.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) =>
    button.addEventListener("click", () => {
      void copy(
        button,
        button.closest("[role=tabpanel]")?.querySelector("pre")?.textContent ??
          "",
      );
    }),
  );
});
document.querySelectorAll<HTMLPreElement>(".prose pre").forEach((pre) => {
  const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
  const button = document.createElement("button");
  button.className = "copy-code";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy code block");
  button.addEventListener("click", () => {
    void copy(button, code);
  });
  pre.classList.add("has-copy");
  pre.prepend(button);
});
