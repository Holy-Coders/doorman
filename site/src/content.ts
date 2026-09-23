import catalog from "./docs.json";
export const REPO = "https://github.com/Holy-Coders/janitor";
export const sections = catalog;
export const pages = sections.flatMap((section) => section.pages);
