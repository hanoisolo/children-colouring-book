# Upgrade Plan — AI image generation + downloadable single-file app

Baseline: `d8462838acfdb0e873445aac49b536916bb5e619`, `npm test` green at 151 unit + 1 browser test.

## Architecture

Two pipelines, one orchestrator surface, one build artifact.

```
                    ┌──────────────────────────────┐
  theme + name ────▶│  src/book.js                 │
                    │  generateBook()      (vector)│──▶ { cover, pages, pdfBytes }
                    │  generateImageBook() (image) │──▶ { cover, pages, pdfBytes, costUsd }
                    └───────────┬──────────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  src/page.js            src/imagegen.js           src/pdf.js
  src/cover.js           prompts + fetch           vector paths
  src/lettering.js       + response parsing        + JPEG XObject
  (vector IR)            + cost estimate           (one writer, both)
```

`app.js` picks the pipeline: key present -> `generateImageBook`, no key -> `generateBook`.
Both return the same book shape, so the preview and download code is shared.

### Why the vector pipeline stays

Deleting it would fail 151 baseline tests and break the offline promise. It is the
fallback, not dead code: it is what runs when the user has no key, and it is what
the browser smoke test exercises.

### Why the cover name stays vector

Image models misspell names, and a child's name spelled wrong is a defect, not a
cosmetic issue. The cover page draws the generated image full-bleed, paints a
white band across the top, then draws the name with the existing
`src/lettering.js` strokes. The name is always correct, still colour-able, and
still readable metadata in `/Info /Title`.

### Why JPEG and not PNG

Measured: `gemini-3.1-flash-lite-image` returns `image/jpeg`. A JPEG embeds in a
PDF with `/Filter /DCTDecode` and the original bytes untouched. PNG would need
inflate, filter reversal and re-deflate. Requesting JPEG is not a preference, it
is what the model already does.

## Files

| File | Change |
| :--- | :--- |
| `src/imagegen.js` | **new** — model constants, prompt builders, request, response parsing, cost estimate |
| `src/pdf.js` | **modify** — JPEG XObject embedding, `jpegSize`, vector overlay on an image page |
| `src/book.js` | **modify** — `generateImageBook` |
| `index.html` | **modify** — API key field, art-style select, cost note |
| `app.js` | **modify** — image-mode wiring, `<img>` previews, cover overlay |
| `styles.css` | **modify** — key field, image preview, overlay positioning |
| `build.js` | **new** — single-file bundler |
| `dist/colouring-book.html` | **new** — committed build artifact |
| `test_colouring_book.js` | **modify** — new tests for every new export |
| `smoke.html` | **modify** — second scenario driving the AI path with a stubbed `fetch` |
| `test_browser.js` | **modify** — second browser test |
| `package.json` | **modify** — `build` script, `test` chain |
| `AGENTS.md`, `README.md` | **modify** — document both pipelines and the build |

## Interfaces

```js
// src/imagegen.js
export const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
export const IMAGE_PRICE_USD = 0.0336;      // per 1K image, list price
export const IMAGE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const IMAGE_ASPECT_RATIO = '3:4';
export const IMAGE_SIZE = '1K';

export function buildPagePrompt({ theme, name, pageIndex, motifs }) -> string
export function buildCoverPrompt({ theme, name }) -> string
export function estimateImageCost(count) -> number
export function parseImageResponse(json) -> { mimeType, base64, bytes }
export async function requestImage({ apiKey, prompt, model, fetchImpl, signal }) -> { mimeType, base64, bytes }
export async function generateImages({ apiKey, prompts, model, fetchImpl, concurrency }) -> Array
```

```js
// src/pdf.js  (additions)
export function jpegSize(bytes) -> { width, height }
// buildPdf page shape gains:
//   page.image = { bytes, width?, height? }   // JPEG, embedded as /DCTDecode
//   page.polylines = [...]                    // drawn on top of the image
```

```js
// src/book.js  (addition)
export async function generateImageBook({ theme, name, apiKey, fetchImpl, model }) -> {
  title, theme, name, filename, mode: 'image',
  cover: { index, label, image, overlaySvg, motifs },
  pages: Array<{ index, label, image, motifs }>,
  pdfBytes, costUsd,
}
```

## Segments

Each segment is 1-3 files and ends in a plain CLI gate.

| # | Files | Work | Gate |
| :-- | :--- | :--- | :--- |
| 1 | `src/imagegen.js`, `test_colouring_book.js` | Model constants, prompt builders, `parseImageResponse`, `requestImage`, `generateImages` with a concurrency cap and 429 retry, `estimateImageCost`. Tests use a fake `fetch`; no network. | `node test_colouring_book.js` |
| 2 | `src/pdf.js`, `test_colouring_book.js` | `jpegSize` SOF parser; `buildPdf` emits an image XObject with `/DCTDecode`, a `/XObject` resource entry, and a `cm`/`Do` content stream; vector polylines draw on top. xref stays byte-exact. | `node test_colouring_book.js` |
| 3 | `src/book.js`, `test_colouring_book.js` | `generateImageBook`: validate, build six prompts, fetch, assemble cover with the white band and vector name, build the PDF, return `costUsd`. | `node test_colouring_book.js` |
| 4 | `index.html`, `app.js`, `styles.css` | `#api-key-input`, `#art-style` select, `#cost-note`; image previews as `<img>` with the cover overlay; error paths for bad key, quota, CORS. All eight contract IDs preserved. | `node test_colouring_book.js && node test_browser.js` |
| 5 | `build.js`, `test_colouring_book.js`, `package.json` | Topological bundle of `app.js` + `src/*.js` into one classic `<script>` (IIFE per module), CSS inlined, no external references. Writes `dist/colouring-book.html`. Tests assert no `import`/`export` survives, all contract IDs present, `node --check` passes on the extracted script. | `node test_colouring_book.js` |
| 6 | `smoke.html`, `test_browser.js` | Second scenario: inject a fake `fetch` into the iframe, set a key, click Generate, assert six `<img>` previews, an enabled download and a non-empty PDF blob. No outbound request. | `node test_browser.js` |
| 7 | `AGENTS.md`, `README.md` | Document both pipelines, the model and its price, the build, and the key-handling caveat. | `npm test` |

## Design decisions worth arguing about

1. **`gemini-3.1-flash-lite-image` over `gemini-nano-banana-2.1`.** Same $0.0336 at 1K, but Lite is the model Google documents as the cheapest and fastest. If quality disappoints, `IMAGE_MODEL` is one constant.
2. **Auto mode, not a forced switch.** Key present -> images; no key -> vector. This is what keeps the smoke test's exact status line true without touching its assertions.
3. **Concurrency 2, not 6.** Six parallel requests invite a 429. Two at a time with one retry on 429 keeps a book under ~20s.
4. **The key lives in `localStorage` only if the user ticks "remember".** Default is memory-only. The UI states plainly that a browser-held key is visible to anything running on the page.
5. **Cost shown before the click.** `6 images x $0.0336 = $0.20` in the status area, so nobody spends by accident.

## Risks and mitigations

| Risk | Mitigation |
| :--- | :--- |
| Six 720 KB JPEGs make a ~4.3 MB PDF | Acceptable for a colouring book; stated in the README. Downscaling would need a canvas re-encode and would soften the lines. |
| Image output is non-deterministic | The byte-identical guarantee is documented as vector-mode only. Prompts are deterministic and tested. |
| A `file://` page could hit a CORS rejection on another browser | Verified `Access-Control-Allow-Origin: null` on Chromium's path. A CORS failure surfaces a message naming `npm start` as the workaround. |
| A bad key or exhausted quota | Distinct, tested error messages for 400/401/403/429 and for a response with no image part. |
| The bundler silently breaks the app | The build test extracts the bundled script and runs `node --check` on it, asserts no `import`/`export` survives, and asserts every contract ID is present. The browser smoke test then runs the served page. |

## Stage 6 plan

- Assertion-integrity scan against `d846283` over `test_colouring_book.js`, `test_browser.js`, `smoke.html`.
- Mutation gate over the added source lines with `node test_colouring_book.js`.
- Expected: no baseline assertion modified. New assertions only.

## Review resolutions (architect `REVIEW: FAIL`, `plans/upgrade_review.md`)

Every finding is accepted. The plan above is amended as follows.

**PDF writer (Segment 2) — four corrections, all load-bearing:**

1. **`q`/`Q` around the image.** `cm` permanently alters the CTM. The image is drawn as
   `q <w> 0 0 <h> 0 0 cm /Im0 Do Q`, so the vector overlay that follows is not scaled
   off the page.
2. **Full XObject dictionary.** `/Type /XObject /Subtype /Image /Width /Height
   /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /Length`. The colour
   space is derived from the SOF component count (3 -> `/DeviceRGB`, 1 -> `/DeviceGray`),
   so `jpegSize` returns `components` as well as `width`/`height`.
3. **Fill-only operator.** `pageContentStream` currently forces `B` on any filled
   polyline, which would give the white cover band a 4 pt black outline. The IR gains
   `stroke` (default `true`); `fill: true, stroke: false` emits `f`, not `B`.
4. **Dynamic object numbering.** `buildPdf` hardcodes `3 + 2 * index` and
   `infoNumber = 2 * pageCount + 3`. That breaks the moment a page allocates an image
   XObject. Object numbers are allocated from a counter instead, and the xref is built
   from the allocation order.

**Cover (Segment 3) — three corrections:**

5. **One aspect-fit function.** A 3:4 image on a 1:1.414 page does not fill it. A single
   `fitImageRect(imageW, imageH, pageW, pageH)` returns the destination rectangle, and
   both the PDF `cm` and the preview overlay use it, so the band and the name cannot
   drift between preview and print.
6. **`buildCoverPrompt` reserves the top band.** The prompt asks for the illustration in
   the lower two thirds and empty white space above, so the band does not slice artwork.
7. **Band height follows the fitted name.** The band is sized from the `fitName` block
   height plus padding, not a fixed constant, so a wrapped 20-character name cannot
   overflow it.

**Bundler (Segment 5) — three corrections:**

8. Emit `'use strict';` at the top of the bundle.
9. Escape any `</script>` occurring inside module source before inlining.
10. Strip the `file://` boot-warning script from the bundle: everything is inline, so the
    notice can never be true there.

**Dropped as over-built (architect point 5):**

11. **No `#art-style` select.** It was unrequested and unwired. Mode is automatic: a key
    present means images, no key means vector. Nothing to choose.
12. **No `localStorage`.** The key lives in memory for the session only. Persisting it
    would widen exposure on a `file://` page for no requested benefit.

**Added coverage the review found missing:**

13. A browser test that loads `dist/colouring-book.html` itself over `file://` and drives
    it, so the shipped artifact is tested rather than only the served source.
14. `jpegSize` must walk segment lengths so an EXIF thumbnail's own SOF0 is never mistaken
    for the main frame; tested with a synthetic EXIF-bearing JPEG.
15. `#generate-btn` is disabled for the duration of the async request.
16. `fetch` is resolved from `globalThis` at call time, so the browser test can stub it.
