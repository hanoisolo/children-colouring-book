1. **Non-regression:** Keeping the vector fallback satisfies the 152-test baseline gate because those assertions verify offline SVG/PDF output and the no-key status string unchanged. However, that gate hides three regressions: (a) the async AI path (`#api-key-input`, `generateImageBook`, `<img>` previews, error paths), covered only by Segment 6; (b) shared sync/async form state in `app.js`; and (c) `dist/colouring-book.html`—Segment 6 tests served `index.html`, while Segment 5 only runs `node --check` and regex checks, leaving CSS inlining, `file://` boot-notice handling, and bundled DOM execution untested in a browser.

2. **PDF correctness:** No—`/DCTDecode`, `/XObject`, and `cm`/`Do` alone are insufficient for a PDF 1.4 page with vector overlays. Omitted requirements:
   - **Image XObject entries:** `/Type /XObject`, `/Subtype /Image`, `/Width`, `/Height`, `/BitsPerComponent 8`, `/ColorSpace` (`/DeviceRGB` or `/DeviceGray` from SOF components).
   - **State isolation (`q`/`Q`):** `cm` permanently alters the CTM; without `q` before `w 0 0 h 0 0 cm /ImN Do` and `Q` after, later `polylines` and stroke widths (`w`) scale off-page.
   - **Fill-only (`f`):** `pageContentStream` forces `B` (fill + >=4pt black stroke) on filled polylines, so a borderless white cover band needs `f` or `re f`.
   - **Dynamic object numbers:** `buildPdf` hardcodes `3 + 2 * index`, breaking once pages allocate XObjects. (`/ProcSet` is optional in PDF 1.4.)

3. **Cover name:** Yes—`src/lettering.js` vector strokes avoid AI misspellings and accent/punctuation errors (`Zoë`, hyphens). Missed failure modes:
   - **Preview/PDF drift:** `896x1200` (`3:4`) differs from A4 (`595.28x841.89`, `1:1.414`) by ~6%; unless preview `<img>` + `overlaySvg` and PDF `cm` share aspect-fit math, band and name misalign.
   - **Clipped art/double titles:** without `buildCoverPrompt` reserving top whitespace, the band slices artwork or AI text.
   - **Line wrapping:** wrapped long names can overflow a fixed-height band.

4. **Bundler:** Yes, topological IIFE wrapping into one classic `<script>` works for this acyclic named-export graph if `'use strict';` is emitted. It breaks on:
   - Unescaped `</script>` or `</style>` in strings/comments.
   - Regexes missing `export async function`, multiline imports/exports, or `as` aliases, or matching `import`/`export` in comments/templates.
   - Unremoved `file://` module-warning scripts, `import.meta`, or future mutable `let` exports.

5. **Wrong, missing, or over-built:**
   - **Wrong:** `#art-style` is added in Segment 4 without an `artStyle` parameter in `buildCoverPrompt`, `buildPagePrompt`, or `generateImageBook`.
   - **Missing:** Browser test of `dist/colouring-book.html`; `jpegSize` skipping APPn/EXIF markers (avoiding thumbnail SOF0s) and returning components; preview base64/data URL contract and aspect-fit policy; disabling `#generate-btn` during async requests; dynamic `globalThis.fetch` lookup for iframe stubbing.
   - **Over-built:** `#art-style` (unrequested, unwired) and `localStorage` key storage (unrequested, widens `file://` exposure).

REVIEW: FAIL - incomplete PDF XObject/CTM/white-band spec, unwired `#art-style` interface, and no browser test for `dist/colouring-book.html`.

Stage 6 Assertion Integrity Audit: Pre-execution review against clean baseline `d846283` (`npm test`: 151+1 passing). Plan keeps all baseline assertions unmodified, adding only new tests.
AUDIT: PASS - assertions intact, no weakening detected