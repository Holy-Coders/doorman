export const REPO = "https://github.com/Holy-Coders/janitor";
export const sections = [
  {
    title: "Start here",
    pages: [
      {
        slug: "getting-started",
        title: "Getting started",
        description: "Your first visitor identity, from checkout to response.",
        source: "README.md",
      },
      {
        slug: "api",
        title: "API reference",
        description: "The small surface area. Every type, factory, and option.",
        source: "docs/API.md",
      },
    ],
  },
  {
    title: "Integrations",
    pages: [
      {
        slug: "cloudflare",
        title: "Cloudflare Workers",
        description: "D1 storage and Jev through Workers AI.",
        source: "examples/cloudflare-worker/README.md",
      },
      {
        slug: "nextjs",
        title: "Next.js & Vercel",
        description: "An App Router endpoint backed by your Postgres database.",
        source: "examples/nextjs/README.md",
      },
      {
        slug: "node",
        title: "Node & Fastify",
        description: "Standard Request and Response, on your Node host.",
        source: "examples/node-fastify/README.md",
      },
    ],
  },
  {
    title: "Under the hood",
    pages: [
      {
        slug: "matching",
        title: "Identity matching",
        description:
          "Transparent weights, small histories, and conservative decisions.",
        source: "docs/MATCHING.md",
      },
      {
        slug: "evaluators",
        title: "Jev & risk scoring",
        description:
          "Typed judgments. Replaceable evaluators. Application-owned policy.",
        source: "docs/JEV.md",
      },
      {
        slug: "storage",
        title: "Storage & retention",
        description: "Two tables. Indexed lookup. Explicit erasure.",
        source: "site/content/storage.md",
      },
      {
        slug: "privacy",
        title: "Privacy & signals",
        description:
          "What is collected, what is not, and how to delete history.",
        source: "PRIVACY.md",
      },
      {
        slug: "validation",
        title: "Testing & limitations",
        description: "What we have verified, and what still needs calibration.",
        source: "docs/VALIDATION.md",
      },
    ],
  },
];
export const pages = sections.flatMap((section) => section.pages);
