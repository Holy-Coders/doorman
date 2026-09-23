# Janitor — continuity field

A silent, twelve-second looping background, authored and rendered in Tesseract 0.1.0. The editable `Janitor.tsrct` contains the native shader composition. The animation is decorative; it does not show live visitor data.

The website places a separate [SVG J](../public/janitor-mark.svg) over the film. Keeping the mark out of compressed video makes its edges sharp at any display density. The header, footer and favicon use the same vector.

## Direction

See [the site design notes](../DESIGN.md) for the palette, typography, page structure and references. The field uses eighteen elliptical traces, three orbits and a travelling scan. It completes one period every twelve seconds, behind a stationary J.

The website handles pause, reduced motion, page visibility and data-saving preferences. A lossless poster supplies the background without JavaScript or video playback. The vector mark remains visible in every mode.

## Authoring

Use the pinned Tesseract 0.1.0 CLI. `Janitor.tsrct` is the authority for the background; supporting shader and generation scripts are in `.tesseract-work`. Commit revisions with `tsrct project commit` before preview or export. The web encodings are derivatives of the native Tesseract export.

To revise the field, check out the document into `.tesseract-work`, edit `field.wgsl`, run `node .tesseract-work/author.mjs`, then commit `editable.json` back to the project. Preserve packaged resources during checkout and commit. The original raster logo asset remains in the document for provenance but is not a composition layer.

From this directory, run:

```sh
bash .tesseract-work/encode.sh
```

This re-renders the saved project and creates the web encodings. It requires the pinned CLI, FFmpeg with libx264/libvpx, and cwebp. Set `TESSERACT_BIN` if the CLI is installed outside its default macOS location.

The original logo prompts are in [LOGO-PROMPTS.md](LOGO-PROMPTS.md). The current web mark is the vector linked above; the older raster derivatives are retained as source material.

## Reviewed delivery

- Native master: 1920 × 1080, 30 fps, 12 seconds, H.264, no audio.
- Web H.264: 1920 × 1080, 3,817,673 bytes, CRF 18, fast-start metadata.
- Web VP9: 1920 × 1080, 3,172,452 bytes, CRF 24.
- Lossless WebP poster: 1920 × 1080, 105,604 bytes.
- Inspected the saved project's filmstrip at 0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5 and 11.967 seconds, plus desktop and mobile website screenshots at double pixel density.
- Thirteen browser tests cover the demos, navigation, introductory documentation, internal links, copy controls, responsive pages, playback controls, reduced motion, data saving, unavailable media and no JavaScript.

The site does not perform live Jev inference, collect visitor observations or send analytics requests.
