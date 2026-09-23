import { pages } from "../content";
export function GET() {
  const urls = [
    "/",
    "/playground/",
    ...pages.map((page) => `/docs/${page.slug}/`),
  ];
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls
        .map(
          (path) =>
            `<url><loc>https://janitor.holycoders.io${path}</loc></url>`,
        )
        .join("") +
      "</urlset>",
    { headers: { "Content-Type": "application/xml" } },
  );
}
