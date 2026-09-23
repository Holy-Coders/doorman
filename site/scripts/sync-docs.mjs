import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(root, "site/src/generated");
mkdirSync(output, { recursive: true });
const entries = [
  [
    "capacity",
    "Connection capacity & load",
    "Measured connection limits, successful throughput and overload recovery.",
    "docs/CAPACITY.md",
  ],
  [
    "hardening",
    "Abuse controls & evidence",
    "Shared inference budgets, trusted events and revocable device associations.",
    "docs/HARDENING.md",
  ],
  [
    "security",
    "Private scores & security",
    "Private server evidence, encrypted receipts and action boundaries.",
    "docs/SECURITY.md",
  ],
  [
    "scaling",
    "Scale & Postgres",
    "Selective indexes, bounded maintenance and measured query scale.",
    "docs/SCALING.md",
  ],
  [
    "research",
    "Research & full-funnel identity",
    "Studies, major platforms, spoofing and cross-device priorities.",
    "docs/RESEARCH.md",
  ],

  [
    "elixir",
    "Elixir & Phoenix",
    "Native Ecto identity, verified users, PostHog and Mixpanel.",
    "packages/elixir/README.md",
  ],
  [
    "phoenix-example",
    "Run Phoenix locally",
    "Boot the native browser-to-BEAM example.",
    "examples/phoenix/README.md",
  ],
  [
    "analytics",
    "PostHog, Mixpanel & Segment",
    "Login identity, multi-user accounts, agents and private analytics reports.",
    "docs/ANALYTICS.md",
  ],
  [
    "languages",
    "Install & other languages",
    "npm, Bun, pnpm, Mix and the language-neutral HTTP contract.",
    "docs/LANGUAGES.md",
  ],
  [
    "trust",
    "Signed credentials & actions",
    "Issuer credentials, operation receipts and explicit device pairing.",
    "docs/TRUST.md",
  ],
  [
    "evaluation",
    "Evaluate learning feedback",
    "Chronological replay, device holdouts and revocable exports.",
    "docs/EVALUATION.md",
  ],

  [
    "learning",
    "Opt-in learning",
    "Verified login feedback and private shadow experiments.",
    "docs/LEARNING.md",
  ],
  [
    "review",
    "Review & comparison",
    "How Janitor compares with Segment, PostHog, RudderStack and Fingerprint.",
    "docs/REVIEW.md",
  ],
  [
    "agentic-identity",
    "Humans, agents & authority",
    "Verified identity keys, distinct actors, and scoped, revocable delegation.",
    "docs/AGENTIC-IDENTITY.md",
  ],
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
  "# Janitor\n\n> Identity context for the agentic era: first-party browser identity, verified account links, and optional Jev risk scoring. Verified actor and delegation context comes from server-side authentication. No automatic blocking. Experimental matching, not authentication.\n\n" +
    entries
      .map(
        ([slug, title, description]) =>
          `- [${title}](https://janitor.holycoders.io/docs/${slug}/): ${description}`,
      )
      .join("\n") +
    "\n\nSource: https://github.com/Holy-Coders/janitor\n",
);
