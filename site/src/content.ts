export const REPO = "https://github.com/Holy-Coders/janitor";
export const sections = [
  {
    title: "Start here",
    pages: [
      {
        slug: "agentic-identity",
        title: "Humans, agents & authority",
        description:
          "Verified identity keys, distinct actors, and scoped, revocable delegation.",
        source: "docs/AGENTIC-IDENTITY.md",
      },
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
        slug: "elixir",
        title: "Elixir & Phoenix",
        description:
          "Native Ecto identity, verified users, PostHog and Mixpanel.",
        source: "packages/elixir/README.md",
      },
      {
        slug: "phoenix-example",
        title: "Run Phoenix locally",
        description: "Boot the native browser-to-BEAM example.",
        source: "examples/phoenix/README.md",
      },
      {
        slug: "analytics",
        title: "PostHog, Mixpanel & Segment",
        description:
          "Explicit account profile updates and allowlisted risk events.",
        source: "docs/ANALYTICS.md",
      },
      {
        slug: "languages",
        title: "Install & other languages",
        description:
          "npm, Bun, pnpm, Mix and the language-neutral HTTP contract.",
        source: "docs/LANGUAGES.md",
      },
      {
        slug: "trust",
        title: "Signed credentials & actions",
        description:
          "Issuer credentials, operation receipts and explicit device pairing.",
        source: "docs/TRUST.md",
      },
      {
        slug: "evaluation",
        title: "Evaluate learning feedback",
        description:
          "Chronological replay, device holdouts and revocable exports.",
        source: "docs/EVALUATION.md",
      },

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
        slug: "security",
        title: "Private scores & security",
        description:
          "Private server evidence, encrypted receipts and action boundaries.",
        source: "docs/SECURITY.md",
      },
      {
        slug: "scaling",
        title: "Scale & Postgres",
        description:
          "Selective indexes, bounded maintenance and measured query scale.",
        source: "docs/SCALING.md",
      },
      {
        slug: "research",
        title: "Research & full-funnel identity",
        description:
          "Studies, major platforms, spoofing and cross-device priorities.",
        source: "docs/RESEARCH.md",
      },

      {
        slug: "learning",
        title: "Opt-in learning",
        description: "Verified login feedback and private shadow experiments.",
        source: "docs/LEARNING.md",
      },
      {
        slug: "review",
        title: "Review & comparison",
        description: "Segment, PostHog, RudderStack and Fingerprint compared.",
        source: "docs/REVIEW.md",
      },
      {
        slug: "extensions",
        title: "Behavior & cross-device",
        description: "Optional movement summaries and verified account links.",
        source: "docs/EXTENSIONS.md",
      },
      {
        slug: "benchmarks",
        title: "Browser benchmarks",
        description:
          "Real browser observations, controlled tests, and known limits.",
        source: "docs/BENCHMARKS.md",
      },
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
