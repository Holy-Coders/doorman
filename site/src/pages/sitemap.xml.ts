import { languages, docURL } from "../languages";
import { pages } from "../content";
export function GET() {
  const urls = [
    "/",
    "/playground/",
    ...languages.flatMap((language) =>
      pages.map((page) => docURL(language, page.slug)),
    ),
  ];
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls
        .map(
          (path) =>
            `<url><loc>https://doorman.holycoders.io${path}</loc></url>`,
        )
        .join("") +
      "</urlset>",
    { headers: { "Content-Type": "application/xml" } },
  );
}
