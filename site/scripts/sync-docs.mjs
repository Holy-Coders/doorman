import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(root, "site/src/generated");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const catalog = JSON.parse(
  readFileSync(resolve(root, "site/src/docs.json"), "utf8"),
);
const entries = catalog.flatMap((section) =>
  section.pages.map(({ slug, title, description, source }) => [
    slug,
    title,
    description,
    source,
  ]),
);
const routes = new Map(
  entries.map(([slug, , , source]) => [source, `/docs/${slug}/`]),
);
for (const [slug, , , source] of entries)
  if (source.endsWith("/README.md"))
    routes.set(source.replace("/README.md", ""), `/docs/${slug}/`);
routes.set("README.md", "/docs/introduction/");
const flavors = JSON.parse(
  readFileSync(resolve(root, "site/src/docs-flavors.json"), "utf8"),
);
for (const language of ["typescript", "elixir", "python", "go"]) {
  const search = [];
  const prefix = language === "typescript" ? "/docs/" : `/docs/${language}/`;
  const flavoredRoutes = new Map(
    [...routes].map(([source, route]) => [
      source,
      route.replace("/docs/", prefix),
    ]),
  );
  for (const [slug, source] of Object.entries(flavors[language] ?? {}))
    flavoredRoutes.set(source, `${prefix}${slug}/`);
  for (const [slug, title, description, originalSource] of entries) {
    const source = flavors[language]?.[slug] ?? originalSource;
    const shared = language !== "typescript" && source === originalSource;
    let body = readFileSync(resolve(root, source), "utf8").replace(
      /^# [^\n]+\n/,
      "",
    );
    body = body.replace(/\]\(([^)]+)\)/g, (match, href) => {
      if (/^(https?:|#|\/)/.test(href)) return match;
      const [path, hash] = href.split("#");
      const resolved = relative(root, resolve(root, dirname(source), path));
      return `](${flavoredRoutes.get(resolved) ?? `https://github.com/Holy-Coders/doorman/blob/main/${resolved}`}${hash ? "#" + hash : ""})`;
    });
    writeFileSync(
      resolve(output, `${language}--${slug}.md`),
      `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nsource: ${JSON.stringify(source)}\nlanguage: ${language}\nslug: ${slug}\nshared: ${shared}\n---\n${body}`,
    );
    search.push({
      title,
      description,
      url: `${prefix}${slug}/`,
      text: body
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[#*`|]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  writeFileSync(
    resolve(
      root,
      language === "typescript"
        ? "site/public/search-index.json"
        : `site/public/search-index-${language}.json`,
    ),
    JSON.stringify(search),
  );
}
writeFileSync(
  resolve(root, "site/public/llms.txt"),
  "# Doorman\n\n> Doorman is an open-source library for recognizing returning browsers, estimating browser risk with the optional Jev AI model, and connecting authenticated people and agents. It runs on your server and stores history in your database. Browser matching is not login. Your app decides whether to allow an action or show a CAPTCHA.\n\n" +
    entries
      .map(
        ([slug, title, description]) =>
          `- [${title}](https://doorman.holycoders.io/docs/${slug}/): ${description}`,
      )
      .join("\n") +
    "\n\nSource: https://github.com/Holy-Coders/doorman\n",
);
