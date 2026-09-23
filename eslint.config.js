import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/deps/**",
      "**/_build/**",
      "packages/elixir/priv/static/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.wrangler/**",
      "**/.astro/**",
      "**/public/visitor.js",
      "artifacts/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
);
