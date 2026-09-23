import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(root, "site/src/generated");
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
const search = [];
for (const [slug, title, description, source] of entries) {
  let body = readFileSync(resolve(root, source), "utf8").replace(
    /^# [^\n]+\n/,
    "",
  );
  body = body.replace(/\]\(([^)]+)\)/g, (match, href) => {
    if (/^(https?:|#|\/)/.test(href)) return match;
    const [path, hash] = href.split("#");
    const resolved = relative(root, resolve(root, dirname(source), path));
    return `](${routes.get(resolved) ?? `https://github.com/Holy-Coders/janitor/blob/main/${resolved}`}${hash ? "#" + hash : ""})`;
  });
  writeFileSync(
    resolve(output, `${slug}.md`),
    `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nsource: ${JSON.stringify(source)}\n---\n${body}`,
  );
  search.push({
    title,
    description,
    url: `/docs/${slug}/`,
    text: body
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[#*`|]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  });
}
writeFileSync(
  resolve(root, "site/public/search-index.json"),
  JSON.stringify(search),
);
writeFileSync(
  resolve(root, "site/public/llms.txt"),
  "# Janitor\n\n> Janitor is an open-source library for recognizing returning browsers, estimating browser risk with the optional Jev AI model, and connecting authenticated people and agents. It runs on your server and stores history in your database. Browser matching is not login. Your app decides whether to allow an action or show a CAPTCHA.\n\n" +
    entries
      .map(
        ([slug, title, description]) =>
          `- [${title}](https://janitor.holycoders.io/docs/${slug}/): ${description}`,
      )
      .join("\n") +
    "\n\nSource: https://github.com/Holy-Coders/janitor\n",
);
