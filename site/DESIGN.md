# Janitor website design

Janitor is a developer library for recognizing returning browsers, assessing technical risk, and connecting authenticated people and agents. A first-time visitor should understand that sentence before encountering an internal type or optional feature.

## Visual direction

Keep the existing Janitor identity: ink #080c0c, raised forest #111b19, mint #b6f5ce, near-white #f3f5f1, muted green-grey #b4c1b9 and warm amber #e6b38a. Mint identifies actions and continuity; amber marks a limitation or a privacy detail. The J is vector artwork in the interface, separate from the video encoding.

Space Grotesk carries headings and the wordmark. Body text uses the system sans-serif stack for comfortable long reading. IBM Plex Mono is reserved for code and actual technical values. Documentation text starts at 16px, with generous line height and a reading column around 70 characters.

The hero pairs a literal product introduction with one focused animation. Below it, a browser-history example explains the basic behavior, code shows integration, and optional risk, accounts and analytics follow. Avoid repeated status chips, unexplained abbreviations, tiny captions and decorative numbered sections.

```
brand                 documentation / playground / source      search
product + plain explanation       sharp J / continuity animation
get started / try example
browser history demo
integration code + what happens on your server
optional Jev risk scoring
people / agents example + analytics
privacy + next step
```

Documentation starts with an introduction, a runnable first example, installation and the handful of terms needed to read the API. Framework instructions come next; advanced features, operations and research are separate. Each guide explains the problem, names any prerequisite, shows code, then explains the result. Release histories belong in the changelog or validation archive.

Reference review, September 23, 2026: https://resend.com for a direct product explanation beside a distinctive visual; https://clerk.com/docs for an introduction and framework-oriented starting points. These inform hierarchy, not copied artwork or copy.

## Review

Check desktop and narrow-screen screenshots, keyboard navigation, all internal links, readable code blocks, reduced-motion/data-saving fallbacks and the absence of third-party requests. Keep scores described as estimates, explain Jev on first use, and distinguish a browser from a person throughout.

## Theme and language refinement

The hero now uses the social image's short headline, “Know who’s behind the request.” The broader agentic-era explanation belongs beside the analytics illustration below. Preserve the vector J in both modes: mint on ink, deep green on a light mineral surface. Light tokens use #f5f8f6, #ffffff, #eaf1ec, #152d22 and #12543b; theme follows the system until explicitly changed. The film remains secondary and masked into the page.

A global language selector keeps the same documentation topic while changing setup, installation and API instructions. It uses shareable static language URLs and local-only preferences, without adding language sections to the sidebar. TypeScript and Elixir are native engines; Python and Go are transport clients. Shared engine reference material must say where it runs. Search results and global navigation retain the selected language.
