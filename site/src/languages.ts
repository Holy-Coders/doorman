export const languages = ["typescript", "elixir", "python", "go"] as const;
export type Language = (typeof languages)[number];
export const labels: Record<Language, string> = {
  typescript: "TypeScript",
  elixir: "Elixir",
  python: "Python",
  go: "Go",
};
export const docURL = (language: Language, slug: string) =>
  `/docs/${language === "typescript" ? "" : language + "/"}${slug}/`;
