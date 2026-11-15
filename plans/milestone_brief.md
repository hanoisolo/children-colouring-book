## Architect Context Packet
- Mode & Tier: audit (Tier 4 — multi-phase system, Phase 2 boundary milestone review)
- Project & Stack: children-colouring-book | Web UI (HTML/CSS/JS), vanilla ES2020 modules, zero third-party dependencies, zero build step | Node v26.12.1 (`node:test` + `node:assert/strict`)
- Git Baseline: 2cb4764 | Working tree: CLEAN
- Baseline Test Status: `node test_colouring_book.js` -> 114 passed, 0 failed, 0 skipped (330 assertions)
- Canonical File Inventory:
  * `package.json` (config, 10 lines) — type module, zero dependencies
  * `index.html` (source, 63 lines) — form, status/error, preview grid, download control
  * `styles.css` (source, 180 lines) — layout and print stylesheet
  * `app.js` (source, 230 lines) — validation, filename sanitiser, page planning, book assembly, DOM wiring
  * `src/rng.js` (source, 151 lines) — FNV-1a hash, mulberry32 PRNG, deriveSeed, seeded helpers
  * `src/themes.js` (source, 244 lines) — stopwords, plural ladder, 25-motif vocabulary, 50-keyword map, fallback
  * `src/motifs.js` (source, 468 lines) — 25 procedural motif generators, polyline builders, bounds
  * `src/lettering.js` (source, 288 lines) — single-stroke A-Z/0-9/punctuation, NFD accent resolution, layout/measure/fit
  * `src/page.js` (source, 274 lines) — interior page composition, polyline IR, SVG serialiser
  * `src/cover.js` (source, 296 lines) — cover composition, name fitting and wrapping
  * `test_colouring_book.js` (test, 1326 lines) — 114 tests, 330 assertions
  * `plans/MASTER_ROADMAP.md` (doc) — 3 phases x 3 segments
  * `plans/mutation_baseline.json` (config) — per-file survivor ratchet
  * `.gitattributes` (config) — eol=lf normalisation
- Mandatory Anti-Drift Invariants: DOM selector parity between `app.js` and `index.html` for the eight contract IDs (`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`) plus `data-role="page-preview"` and `data-page-index`; export parity for every `export` in all six modules; determinism guard banning `Math.random`, `Date.now`, `new Date`, `localeCompare`, `eval`, `new Function`, dynamic `import()` across all seven source files.

---

# Phase 2 Milestone Review

Phase 2 of `plans/MASTER_ROADMAP.md` is complete. Phase 3 (PDF 1.4 writer, book orchestrator, end-to-end verification) is about to begin.

## What Phase 2 delivered

- `src/motifs.js`: 25 procedural generators matching `MOTIF_VOCABULARY` exactly, each emitting polylines in a `0..1` box carrying `closed`, `fill` and a relative `weight` (1 main, 0.6 detail). Builders `stroke`, `polygon`, `circle`, `ellipse`, `arc`, plus `computeBounds`.
- `src/lettering.js`: single-stroke glyphs for A-Z, 0-9, space, hyphen and apostrophe in an em box where `size` equals cap height. Accented letters resolve by NFD decomposition into base glyph plus accent strokes for acute, grave, circumflex, tilde, diaeresis, ring, caron and cedilla. `layoutText`, `measureText`, `fitText`, `hasGlyph`.
- `src/page.js`: interior composition — two frame rectangles, a ground line with tufts, and 3-7 motifs on a jittered grid. Each motif is scaled to 0.8 of its cell and its centre moves by at most 0.1 of a cell, so worst-case bounding boxes touch but never overlap. Owns the single SVG serialiser both pages and cover use.
- `src/cover.js`: decorative frame with corner ornaments, fixed title, uppercased name fitted to at most four lines and never below 60 pt cap height, theme subtitle, and three theme motifs.
- `app.js`: `buildPlaceholderPages` became `planBookPages` (3-7 distinct motifs per page, at least one from the theme); new `buildPreviewPages` composes the cover plus five pages as SVG strings; `renderPreviews` writes them into `#preview` as `data-page-index="0".."5"`. `validateInputs` now also rejects names containing characters the lettering cannot draw.
- `test_colouring_book.js`: 57 -> 114 tests, 140 -> 330 assertions.

## Stage 6 evidence

- Deterministic assertion-integrity scan against `fc5be24`: `SCAN: PASS`. 172 assertions added, 4 removed; 53 test declarations added, 3 removed. All removals belong to the `buildPlaceholderPages` -> `planBookPages` rename and are itemised in `plans/removal_justification.md`; the waiver is logged in `plans/removal_waivers.log`.
- Mutation pass, scoped to source lines added since `fc5be24`, 400-mutant cap: 288 killed, 112 survived, **72.0%**.
  - `src/motifs.js`: 154 killed, 34 survived.
  - `src/lettering.js`: 84 killed, 34 survived.
  - `src/cover.js`: 26 killed, 31 survived.
  - `src/page.js`: 19 killed, 9 survived.
  - `app.js`: 5 killed, 4 survived — all DOM-only lines.
  - The first pass, before the geometry assertions landed, was 54.0% with 184 survivors. The ratchet moved forward.

## Bugs the gates caught

1. `composeCover` added one cap height to each name line's `y`, but `layoutText`'s `y` is the cap top, not the baseline. The name sat a full cap height below centre. Found by the new centring test, fixed by centring the cap block.
2. `app.js` used `figure.querySelector('svg')`, which the DOM parity invariant correctly rejects because it cannot be checked against `index.html`. Replaced with `firstElementChild`.
3. `layoutText` and `measureText` did not normalise input, so a decomposed accent (`E` + U+0301) threw while the precomposed form worked. Both now normalise to NFC.

## Known limitations carried into Phase 3

1. The 112 surviving mutants are concentrated in three classes: loop bounds on curve sampling (`i < segments` -> `i < segments + 1`, which adds one sample point and is near-equivalent), internal layout constants that are deliberately not exported (`TEXT_WIDTH`, `TITLE_Y`, `SUBTITLE_Y`, `ORNAMENT_RADIUS`, `MOTIF_BOX`, `MOTIF_ROW_Y`, the 1.35 line gap), and four DOM-only `app.js` lines. Pinning every internal constant would make any visual adjustment a test failure, so they are accepted rather than pinned.
2. No motif currently sets `fill: true`. The IR carries the flag and the SVG writer honours it (`fill="#ffffff"` versus `fill="none"`), and a serialiser-level test pins both branches, but no generator exercises the filled path end to end. Phase 3's PDF writer must emit `B` for filled and `S` for stroke-only; if no motif is ever filled, that branch will be untested in the real pipeline.
3. There is still no DOM shim. The DOM contract is enforced only by static selector parity, as agreed at the Phase 1 boundary.
4. `validateInputs` and `sanitiseFilename` still live in `app.js` and move to `src/book.js` at Phase 3 Segment 2, per the Phase 1 constraint.

## Questions — answer only these four points, under 400 words total

1. Is Phase 2 complete enough to proceed to Phase 3, or does any gap above block it?
2. Limitation 2: should Phase 3 Segment 1 add `fill: true` to a handful of motif body shapes so the PDF `B`-versus-`S` branch is exercised end to end, or is the serialiser-level test sufficient?
3. The 72.0% mutation score with 112 survivors, mostly curve-sampling loop bounds and unexported layout constants — accept, or is there a cheap class worth pinning before Phase 3?
4. Any Phase 3 risk the plan does not already cover, given that `src/pdf.js` must consume the same polyline IR and flip Y only there?

End with exactly one verdict line: `AUDIT: PASS - <one sentence>` or `AUDIT: FAIL - <itemized weaknesses>`.
