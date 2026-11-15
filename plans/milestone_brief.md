## Architect Context Packet
- Mode & Tier: audit (Tier 4 — multi-phase system, Phase 3 boundary milestone review)
- Project & Stack: children-colouring-book | Web UI (HTML/CSS/JS), vanilla ES2020 modules, zero third-party dependencies, zero build step | Node v26.12.1 (`node:test` + `node:assert/strict`)
- Git Baseline: 2b77b63 | Working tree: CLEAN
- Baseline Test Status: `node test_colouring_book.js` -> 140 passed, 0 failed, 0 skipped (419 assertions)
- Canonical File Inventory:
  * `package.json` (config, 10 lines) — type module, zero dependencies
  * `index.html` (source, 63 lines) — form, status/error, preview grid, download control
  * `styles.css` (source, 180 lines) — layout and print stylesheet
  * `app.js` (source, 110 lines) — pure DOM controller, no exports
  * `src/rng.js` (source, 151 lines) — FNV-1a hash, mulberry32 PRNG, deriveSeed, seeded helpers
  * `src/themes.js` (source, 244 lines) — stopwords, plural ladder, 25-motif vocabulary, 50-keyword map, fallback
  * `src/motifs.js` (source, 470 lines) — 25 procedural motif generators, polyline builders, bounds
  * `src/lettering.js` (source, 288 lines) — single-stroke A-Z/0-9/punctuation, NFD accent resolution, layout/measure/fit
  * `src/page.js` (source, 279 lines) — interior page composition, polyline IR, SVG serialiser
  * `src/cover.js` (source, 296 lines) — cover composition, name fitting and wrapping
  * `src/pdf.js` (source, 202 lines) — PDF 1.4 writer, byte-chunk assembly, xref, UTF-16BE info strings
  * `src/book.js` (source, 188 lines) — validation, filename sanitiser, page planning, book assembly
  * `test_colouring_book.js` (test, 1667 lines) — 140 tests, 419 assertions
  * `plans/MASTER_ROADMAP.md` (doc) — 3 phases x 3 segments
  * `plans/mutation_baseline.json` (config) — per-file survivor ratchet
  * `.gitattributes` (config) — eol=lf normalisation
- Mandatory Anti-Drift Invariants: DOM selector parity between `app.js` and `index.html` for the eight contract IDs (`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`) plus `data-role="page-preview"` and `data-page-index`; export parity for every `export` in all nine modules, with `app.js` asserted to export nothing; determinism guard banning `Math.random`, `Date.now`, `new Date`, `localeCompare`, `eval`, `new Function`, dynamic `import()` across all eight source files.

---

# Phase 3 Milestone Review

Phase 3 of `plans/MASTER_ROADMAP.md` is complete. It is the last roadmap phase, so this review is also the pre-ship gate.

## What Phase 3 delivered

- `src/pdf.js`: a dependency-free PDF 1.4 writer returning `Uint8Array`. The document is assembled as an array of byte chunks and every xref offset is accumulated from `chunk.length`, never from a string length, so the multi-byte binary comment cannot shift the table. `/Length` excludes the EOL before `endstream`. `pdfTextString` emits a literal for printable ASCII and a UTF-16BE hex string with a `FEFF` BOM otherwise, including surrogate-pair splitting for astral characters. `pageContentStream` sets `1 1 1 rg` white fill once per page, `0 0 0 RG` black stroke, `1 J 1 j` round caps and joins, clamps every stroke to `MIN_STROKE_WIDTH = 4`, and emits `h` whenever a path is `closed || fill` because PDF's `B` implicitly closes.
- `src/book.js`: `validateInputs`, `sanitiseFilename`, `planBookPages`, `bookDiversity`, `generateBook`. `generateBook` throws rather than returning a book that fails its own quality bar — pages must be pairwise distinct and at least `MIN_DISTINCT_PAGE_MOTIF_SETS = 4` of the five must carry a distinct motif multiset.
- `app.js`: reduced to a pure controller with no exports. `renderPreviews` writes one `figure[data-role="page-preview"]` per card, `downloadBook` builds a `Blob`, clicks an anchor and revokes the object URL on a zero-delay timer, and `init` wires the form. Every decision worth testing moved down into `src/book.js`.
- `src/motifs.js` and `src/page.js`: `circle` and `ellipse` gained a trailing `options` bag, the house roof and door and both car wheels are now `fill: true`, and `polylineToPathData` emits `Z` when `closed || fill` so the SVG preview and the PDF agree on geometry.
- `test_colouring_book.js`: 114 -> 140 tests, 330 -> 419 assertions.

## Stage 6 evidence

- Deterministic assertion-integrity scan against `cb9945e`: `SCAN: PASS`. 92 assertions added, 9 removed; 33 test declarations added, 5 removed. Every removal belongs to the `buildPreviewPages` -> `generateBook` rename or to `app.js` losing its exports, and each is itemised in `plans/removal_justification.md`; the waiver is logged in `plans/removal_waivers.log`.
- Mutation pass, scoped to source lines added since `cb9945e`, 400-mutant cap, run twice:
  - First pass: 99 mutants, 74 killed, 25 survived, **74.7%**.
  - Second pass after the pinning commit: 99 mutants, 92 killed, 7 survived, **92.9%**.
  - Per file now: `src/book.js` 29/0, `src/pdf.js` 52/2, `src/motifs.js` 10/2, `src/page.js` 1/0, `app.js` 0/3.
  - The seven survivors are accepted, not overlooked: three `app.js` lines need a DOM shim the design deliberately avoids; `circle`/`ellipse` `segments = 24` are curve-sampling bounds; `pdf.js:36` is an equivalent mutant because `String(-0)` is already `'0'`; `pdf.js:43` is unreachable because `asciiBytes` only ever receives ASCII structure and formatted numbers.

## Gaps the gates caught

1. **The Phase 3 filled-path constraint was not actually exercised.** The mutation pass showed the house roof, the house door and both car wheels could each lose `fill: true` with the suite still green. The `B`-versus-`S` branch was only covered by a hand-built polyline in the serialiser test, never by a real motif. Now pinned by exact filled-shape counts per motif.
2. **The PDF structural contracts were asserted through the constants that produce them.** `text.startsWith(\`%PDF-${PDF_VERSION}\`)` cannot fail when `PDF_VERSION` changes, and the same tautology hid the `/Kids` page tree, each page's `/Contents` reference, the trailer's `/Size`, `/Root` and `/Info`, and the free entry's `65535` generation. All are now literal-string assertions.
3. **The A4 fallback was dead code in the suite.** Every test passed an explicit `width` and `height`, so `page.width ?? MEDIA_BOX[2]` in both the content stream and the page object was never taken. Now covered.

## Known limitations carried into ship

1. There is still no DOM shim. `app.js`'s three surviving mutants — the status string, `downloadBtn.disabled = false`, and the revoke delay — are unobservable without one, and the DOM contract remains enforced only by static selector parity, as agreed at the Phase 1 boundary.
2. The mutation gate mutates added lines only, so it cannot see weakness introduced by deleted logic. Phase 3 deleted `buildPreviewPages` and `app.js`'s exports; the assertion-integrity scan covers that half, but neither gate proves the deleted behaviour is fully re-covered by the new path.
3. `pdfTextString` escapes only `\` and the two parentheses. A control character below `0x20` would fall through to the hex branch and be encoded as UTF-16BE rather than escaped, which is legal but not what a reader expects for, say, a tab in a title. No caller can currently produce one, because `validateInputs` restricts the name and the title is derived from it.
4. The PDF writer emits no `/Font` resource and no text operators. The child's name appears on the cover as vector strokes from `src/lettering.js`, not as selectable text, so the PDF is not searchable and a screen reader cannot read the name.
5. The PDF has never been opened by a third-party reader. The suite proves the structure by construction — every xref offset lands on its object header, every `/Length` matches its stream, `startxref` lands on the table — but no independent parser has accepted the file. No PDF library is installed and Section 10 forbids installing one unpinned, so the first real reader to see this document will be the user's.

## Questions — answer only these four points, under 400 words total

1. Is Phase 3 complete enough to ship, or does any gap above block it?
2. Limitation 1: is static selector parity an acceptable permanent substitute for a DOM shim, or should ship be gated on adding one?
3. Limitation 4: is a vector-only cover name acceptable for a children's colouring book, or should the PDF carry a real `/Font` and text operators so the name is selectable and readable?
4. The 92.9% mutation score with 7 accepted survivors — accept as the ship baseline, or is there a cheap class worth pinning first?

End with exactly one verdict line: `AUDIT: PASS - <one sentence>` or `AUDIT: FAIL - <itemized weaknesses>`.
