# Upgrade Brief — AI image generation + downloadable single-file app

## Architect Context Packet

- Mode & Tier: upgrade (Tier 4 — multi-file architectural change)
- Project & Stack: children-colouring-book | Web UI (HTML/CSS/JS), vanilla ES2020 modules, zero dependencies, no build step | Node v26.12.1 for tests
- Git Baseline: `d8462838acfdb0e873445aac49b536916bb5e619` | Working tree: CLEAN (one untracked `plans/milestone_review.md`)
- Baseline Test Status: `npm test` -> 151 unit tests + 1 browser smoke test, 0 failed, 0 skipped
- Canonical File Inventory:
  * `package.json` (17 lines, config)
  * `index.html` (75 lines, source)
  * `styles.css` (110 lines, source)
  * `app.js` (117 lines, source)
  * `serve.js` (95 lines, source)
  * `smoke.html` (70 lines, test fixture)
  * `test_browser.js` (140 lines, test)
  * `test_colouring_book.js` (2000 lines, test)
  * `src/rng.js` (151 lines, source)
  * `src/themes.js` (243 lines, source)
  * `src/motifs.js` (469 lines, source)
  * `src/lettering.js` (288 lines, source)
  * `src/page.js` (279 lines, source)
  * `src/cover.js` (296 lines, source)
  * `src/pdf.js` (206 lines, source)
  * `src/book.js` (196 lines, source)
- Mandatory Anti-Drift Invariants: the eight contract IDs `#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`; every selector literal in `app.js` must exist verbatim in `index.html`; every `export` in `src/` must be imported and exercised by the suite; `app.js` must export nothing.

## What the user asked for

Two changes, in their words:

1. "implement the cheapest model for nano banana that can generate images instead of svg"
2. "make the app a downloadable app instead of npm start process"

## Verified facts (measured, not assumed)

A live probe against the API was run before planning. Results:

- **Cheapest nano-banana model:** `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite). Google's own image-generation docs describe it as "the fastest and cheapest Gemini image workhorse model". List price $0.0336 per 1K image ($30 per 1M image output tokens). `gemini-nano-banana-2.1` is the same price at 1K but is the heavier model; `gemini-3-pro-image` is $0.134 at 1K.
- **Request shape:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent`, header `x-goog-api-key`, body `{contents:[{parts:[{text}]}], generationConfig:{responseModalities:["IMAGE"], imageConfig:{aspectRatio:"3:4", imageSize:"1K"}}}`.
- **Response shape:** `candidates[0].content.parts[]`, one part carrying `inlineData: {mimeType, data}`. `finishReason: "STOP"`.
- **The model returns `image/jpeg`, not PNG.** Measured: 896x1200, baseline SOF0, 3 components, 720,013 bytes. This matters: a JPEG embeds in a PDF directly with `/DCTDecode`, so no canvas re-encode and no PNG parsing is needed.
- **Cost per image measured:** 1120 image tokens = $0.0336 exactly. A six-page book is $0.2016.
- **CORS allows a `file://` origin.** `OPTIONS` with `Origin: null` returns `Access-Control-Allow-Origin: null` and `Access-Control-Allow-Headers: content-type,x-goog-api-key`. A single-file app opened from disk can therefore call the API directly.
- **Output quality:** the probe image is genuine thick-line black-on-white colouring art with large colour-in areas.

## Hard constraint that shapes the design

The upgrade skill's gate is 100% non-regression: every one of the 151 baseline unit tests and the 1 browser smoke test must still pass **with its assertions unmodified**.

The browser smoke test asserts, verbatim, `status === "Ready: a cover and 5 pages for Amara."`, `previews === 6`, `svgs === 6`, `error === ""`. It drives the real `index.html` with no API key present.

Therefore the vector pipeline cannot be deleted, and the no-key path must still produce exactly that state. The SVG pipeline stays as the offline fallback; the image pipeline is added alongside it.

## Requirements

R1. The app generates its six pages with `gemini-3.1-flash-lite-image` instead of procedural SVG when an API key is available.
R2. The generated images are embedded in the downloadable A4 PDF.
R3. The child's name on the cover is always spelled correctly.
R4. The app ships as one self-contained HTML file that works from `file://`, with no server and no build step for the end user.
R5. With no API key, the app still works offline exactly as it does today.
R6. Cost is visible before the user spends it.
R7. The API key is handled without leaking it anywhere except the Gemini endpoint.
R8. All 152 baseline tests pass unmodified.

## Out of scope

- No third-party libraries, no bundler dependency, no framework.
- No server-side proxy. The key is the user's own and stays in their browser.
- No change to the vector art itself.
