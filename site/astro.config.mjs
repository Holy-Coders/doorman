import { defineConfig } from "astro/config";
export default defineConfig({
  site: "https://janitor.holycoders.io",
  output: "static",
  trailingSlash: "always",
  markdown: { shikiConfig: { theme: "github-dark", wrap: false } },
  devToolbar: { enabled: false },
});
