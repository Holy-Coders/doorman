import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(root, "site/src/generated");
mkdirSync(output, { recursive: true });
const entries = [
  [
    "extensions",
    "Behavior & cross-device",
    "Optional movement summaries and verified account links.",
    "docs/EXTENSIONS.md",
  ],
  [
    "benchmarks",
    "Browser benchmarks",
    "Real browser observations, controlled tests, and known limits.",
    "docs/BENCHMARKS.md",
  ],
  [
    "getting-started",
    "Getting started",
    "Your first visitor identity, from checkout to response.",
    "README.md",
  ],
  [
    "api",
    "API reference",
    "Every type, factory, and configuration option.",
    "docs/API.md",
  ],
  [
    "cloudflare",
    "Cloudflare Workers",
    "D1 storage and Jev through Workers AI.",
    "examples/cloudflare-worker/README.md",
  ],
  [
    "nextjs",
    "Next.js & Vercel",
    "An App Router endpoint backed by your Postgres database.",
    "examples/nextjs/README.md",
  ],
  [
    "node",
    "Node & Fastify",
    "Standard Web APIs on your Node host.",
    "examples/node-fastify/README.md",
  ],
  [
    "matching",
    "Identity matching",
    "Transparent weights, bounded history, conservative decisions.",
    "docs/MATCHING.md",
  ],
  [
    "evaluators",
    "Jev & risk scoring",
    "Typed judgments through two replaceable transports.",
    "docs/JEV.md",
  ],
  [
    "storage",
    "Storage & retention",
    "Two tables. Indexed lookup. Explicit erasure.",
    "site/content/storage.md",
  ],
  [
    "privacy",
    "Privacy & signals",
    "The complete collection, retention, and erasure inventory.",
    "PRIVACY.md",
  ],
  [
    "validation",
    "Testing & limitations",
    "Verified behavior and the limits of this experiment.",
    "docs/VALIDATION.md",
  ],
];
const routes = new Map(
  entries.map(([slug, , , source]) => [source, `/docs/${slug}/`]),
);
for (const [slug, , , source] of entries)
  if (source.endsWith("/README.md"))
    routes.set(source.replace("/README.md", ""), `/docs/${slug}/`);
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
  "# Janitor\n\n> Open-source first-party browser identity and optional risk scoring. No automatic blocking. Experimental matching, not authentication.\n\n" +
    entries
      .map(
        ([slug, title, description]) =>
          `- [${title}](https://janitor.holycoders.io/docs/${slug}/): ${description}`,
      )
      .join("\n") +
    "\n\nSource: https://github.com/Holy-Coders/janitor\n",
);
