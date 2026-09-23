# Janitor — continuity field

A silent, twelve-second looping brand film, authored and rendered in Tesseract 0.1.0.
The editable `Janitor.tsrct` contains its media and shader. It is not generated footage
or a visualization of live visitor data. The public site makes no tracking requests.

## Direction

References inspected September 23, 2026:

- https://linear.app — typography hierarchy and generous product space.
- https://resend.com — a distinct brand object beside an immediately useful developer proposition.
- https://rive.app — expressive motion with a functional, code-oriented entry point.

Original Janitor treatment: a sweeping J with three continuity trails, set in an
elliptical signal field. No copied reference artwork or footage.

Palette: ink `#080c0c`, forest `#111b19`, chalk `#efece5`, mint `#b6f5ce`,
muted sage `#94a69d`, warm signal `#e6b38a`.
Typography: locally served Space Grotesk for headings and IBM Plex Mono for code.

```
wordmark                  docs / playground / source             search
---------------------------------------------------------------------
Know who's behind         \                                       /
the request.               \       signal field / J               /
                            \                                    /
product explanation                 silent brand film
start building / try the labs
---------------------------------------------------------------------
browser continuity       verified actors             private scores
```

One expressive hero, calm documentation, real code and functioning labs. The
signal field is decorative: it makes no claim to prove a human identity. Avoid
turning every section into a card, a gradient, or an animated entrance.

## Motion plan

| Time   | Beat                                 | Treatment                                    | Sound  |
| ------ | ------------------------------------ | -------------------------------------------- | ------ |
| 0–4 s  | Stable center, changing observations | Fine elliptical traces and a travelling scan | Silent |
| 4–8 s  | Continuity across the field          | Scan passes around the fixed J               | Silent |
| 8–12 s | Return to the same environment       | Complete one period, continuous loop         | Silent |

The website handles pause, reduced motion, visibility, and data-saving preferences.
The poster supplies the composition without JavaScript or video playback.

## Authoring

Use the pinned Tesseract 0.1.0 CLI. `Janitor.tsrct` is the authority; supporting
shader and generation scripts are in `.tesseract-work`. Revisions must be committed
with `tsrct project commit` before preview/export. The web encodings are derivatives
of the native Tesseract export, not an alternative rendering engine.

From this directory, `bash .tesseract-work/encode.sh` re-renders the saved project
and creates the web encodings (requires the pinned CLI, FFmpeg with libx264/libvpx,
and cwebp). To revise the field, check out the document, edit the WGSL and author
script, run `node .tesseract-work/author.mjs --logo`, then commit `editable.json`
back to the project. Keep the packaged `janitor-mark` asset when revising.

The original logo prompt and refinement prompt are in [LOGO-PROMPTS.md](LOGO-PROMPTS.md).
The opaque generated mark is retained at full resolution. Header and favicon files
are small derivatives; the film removes its dark matte with a native shader.

## Reviewed delivery

- Native master: 1920 × 1080, 30 fps, 12 seconds, H.264, no audio stream.
- Web H.264: 1280 × 720, 511,891 bytes, fast-start metadata.
- Web VP9: 1280 × 720, 411,147 bytes.
- Poster: WebP, 1920 × 1080, approximately 90 KiB.
- Inspected the saved project's filmstrip at 0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5,
  and 11.967 seconds. The travelling light closes its period; the mark stays fixed.
- Fixed the visible rectangular matte around the generated logo during review.
- Inspected desktop, mobile, documentation, and social-preview screenshots.
- Local Chromium playback crossed the loop boundary; 433 frames with three
  startup drops, none added during the remaining playback sample. This is a local
  browser check, not a performance guarantee for every device.
- Eleven browser tests cover the labs, navigation, copy controls, responsive pages,
  playback controls, reduced motion, data saving, unavailable media, and no JavaScript.

Motion represents a changing browser environment, not anonymous cross-device
proof. This site does not perform live Jev inference or send visitor observations.
