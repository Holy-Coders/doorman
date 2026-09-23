import { defineConfig } from "astro/config";
export default defineConfig({
  site: "https://doorman.holycoders.io",
  output: "static",
  trailingSlash: "always",
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
      wrap: false,
    },
  },
  devToolbar: { enabled: false },
});
