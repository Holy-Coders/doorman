import { docURL, languages, type Language } from "../languages";
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: light)");
let explicit = false;
try {
  explicit = !!localStorage.getItem("janitor-theme");
} catch {
  /* Storage may be unavailable. */
}
function applyTheme(theme: string) {
  root.dataset.theme = theme;
  const icon = document.querySelector<HTMLLinkElement>("#theme-icon");
  if (icon)
    icon.href =
      theme === "light" ? "/janitor-mark-dark.svg" : "/janitor-mark.svg";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f5f8f6" : "#080c0c");
  document
    .querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")
    .forEach((button) => {
      const next = theme === "light" ? "dark" : "light";
      button.setAttribute("aria-label", `Switch to ${next} mode`);
      button.title = `Switch to ${next} mode`;
      button.querySelector("[data-theme-label]")!.textContent =
        next === "light" ? "Light" : "Dark";
    });
}
applyTheme(root.dataset.theme ?? "dark");
system.addEventListener("change", () => {
  if (!explicit) applyTheme(system.matches ? "light" : "dark");
});
document.querySelectorAll("[data-theme-toggle]").forEach((button) =>
  button.addEventListener("click", () => {
    const theme = root.dataset.theme === "light" ? "dark" : "light";
    explicit = true;
    applyTheme(theme);
    try {
      localStorage.setItem("janitor-theme", theme);
    } catch {
      /* In-memory preference still works. */
    }
  }),
);
let language = root.dataset.docLanguage as Language | undefined;
try {
  language ??= localStorage.getItem("janitor-language") as Language;
} catch {
  /* Default below. */
}
if (!languages.includes(language as Language)) language = "typescript";
root.dataset.language = language;
// A shared documentation URL takes precedence over a stored preference.
try {
  if (root.dataset.docLanguage)
    localStorage.setItem("janitor-language", language!);
} catch {
  /* Optional preference. */
}
document
  .querySelectorAll<HTMLSelectElement>("select[data-language]")
  .forEach((select) => {
    select.value = language!;
    select.addEventListener("change", () => {
      const next = select.value as Language;
      try {
        localStorage.setItem("janitor-language", next);
      } catch {
        /* Navigation still works. */
      }
      const parts = location.pathname.split("/").filter(Boolean);
      const slug = parts[0] === "docs" ? parts.at(-1)! : "getting-started";
      location.assign(
        docURL(
          next,
          [
            "elixir",
            "phoenix-example",
            "node",
            "nextjs",
            "cloudflare",
          ].includes(slug)
            ? "getting-started"
            : slug,
        ),
      );
    });
  });
// Landing-page documentation links retain the global language preference.
if (!root.dataset.docLanguage && language !== "typescript")
  document
    .querySelectorAll<HTMLAnchorElement>('a[href^="/docs/"]')
    .forEach((link) => {
      const parts = link.pathname.split("/").filter(Boolean);
      if (parts.length === 2)
        link.href = docURL(
          language!,
          [
            "elixir",
            "phoenix-example",
            "node",
            "nextjs",
            "cloudflare",
          ].includes(parts[1]!)
            ? "getting-started"
            : parts[1]!,
        );
    });
