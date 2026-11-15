# Children's Colouring Book — A-to-Z Master Roadmap

## Architecture Overview

### Context & Baseline
This is a greenfield, offline-first web application using vanilla ES2020 modules with zero third-party dependencies and zero build tooling. The repository currently contains only `.gitignore`, `plans/prompt_a2z.txt`, and empty `plans/`, `assets/`, and `src/` directories. All tests run headlessly under Node v26.12.1 via `node:test` and `node:assert/strict` (`node test_colouring_book.js`), importing the exact same ES modules loaded by `index.html` via `<script type="module">`.

### System Blueprint & Data Flow
1. **Determinism (`src/rng.js`)**: Provides `hashString(s)` returning a stable unsigned 32-bit integer (FNV-1a over code points/units, zero locale or engine variance) and `makeRng(seed)` (Mulberry32) yielding floats in `[0, 1)`. Book seeds derive from the normalised theme and normalised child's name; each page derives its own sub-seed from the book seed and page index.
2. **Vocabulary & Theme Mapping (`src/themes.js`)**: Normalises theme strings (trim, lowercase, collapse whitespace), removes the documented stopwords (`the`, `a`, `an`, `of`, `and`, `in`, `on`, `under`, `my`, `with`), and maps remaining tokens (including simple plural stripping) to a vocabulary of at least 20 motifs (`star`, `planet`, `rocket`, `moon`, `dinosaur`, `fish`, `shell`, `wave`, `flower`, `tree`, `butterfly`, `cloud`, `sun`, `house`, `balloon`, `cat`, `dog`, `car`, `mountain`, `rainbow`, plus optional extras). Unmatched themes fall back to a documented generic motif set.
3. **Procedural Vector Art & Typography (`src/motifs.js`, `src/lettering.js`)**:
   - `src/motifs.js` defines thick-line, pure-black procedural polyline generators in a normalised `0..1` coordinate box with explicit bounding boxes, keeping closed shapes open and uncluttered for wax-crayon colouring.
   - `src/lettering.js` defines a single-stroke vector alphabet covering `A-Z`, `0-9`, space, `-`, and `'`, plus `layoutText(text, options)` returning scaled polylines in page coordinates and throwing a descriptive `Error` naming any unsupported character.
4. **Page & Cover Composition (`src/page.js`, `src/cover.js`)**:
   - Both modules target A4 portrait user units (`595.28` x `841.89` pt) and emit both vector stroke polylines (for PDF output) and well-formed standalone `<svg>` strings (`viewBox="0 0 595.28 841.89"`, `xmlns="http://www.w3.org/2000/svg"`, black strokes on white background, stroke width >= 4 pt).
   - `src/page.js` composes an interior page with a thick decorative border frame, a ground/horizon line, and 3 to 7 non-overlapping motifs placed on a jittered grid, guaranteeing at least 1 motif from the matched theme (or fallback set).
   - `src/cover.js` composes the cover with a decorative frame, title, the child's name uppercased at cap height >= 60 pt (wrapping cleanly across lines if needed for up to 20 characters so strokes stay inside the frame), and the theme subtitle.
5. **PDF 1.4 Writer & Orchestrator (`src/pdf.js`, `src/book.js`)**:
   - `src/pdf.js` builds a valid PDF 1.4 document strictly in a `Uint8Array` (no `Buffer`, no Node-only APIs) with raw binary comment bytes, `/Catalog`, `/Pages`, 6 `/Page` objects (`/MediaBox [0 0 595.28 841.89]`), content streams (`1 1 1 rg` white page fill, `0 0 0 RG` pure black stroke, `w` >= 4, `1 J` / `1 j` round caps/joins, `m`/`l`/`S` paths), byte-exact 20-byte `xref` entries, `/Size` + `/Root` trailer, `startxref`, and `%%EOF`.
   - `src/book.js` exposes `validateInputs(theme, name)`, `sanitiseFilename(name)`, and `generateBook(theme, name)` returning `{ title, theme, name, filename, cover, pages, pdfBytes }`, enforcing pairwise SVG distinctness and motif-multiset diversity across at least 4 of the 5 interior pages.
6. **Browser UI & Anti-Drift Contract (`index.html`, `styles.css`, `app.js`)**:
   - `index.html` declares strictly the 8 contract IDs (`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`) and initial placeholder markup carrying `data-role="page-preview"` and `data-page-index="0"` inside `#preview` (replaced on generation).
   - `app.js` queries all 8 IDs and `[data-role="page-preview"]`, validates inputs, displays errors in `#error`, renders inline SVG previews with `data-role="page-preview"` and `data-page-index="<n>"`, enables `#download-btn`, and triggers a `Blob` download named `<sanitised-name>.pdf`.

---

## Phase 1: Foundation, UI Shell, Determinism & Vocabulary

Goal: Establish the zero-dependency ES module manifest, deterministic PRNG, theme vocabulary mapper, complete HTML/CSS shell, interactive input validation UI, and initial headless suite including DOM selector parity and export parity. At phase end, `index.html` opens cleanly in a browser with working form validation and theme preview cards, and all Phase 1 tests pass.

| Segment | Files | Purpose | Gate Command | Pass Condition |
| :--- | :--- | :--- | :--- | :--- |
| Phase 1, Segment 1 | `package.json`, `src/rng.js`, `src/themes.js` | Create `package.json` (`type: "module"`, `test` script, zero `dependencies`/`devDependencies`). Implement `hashString` and `makeRng` in `src/rng.js`. Implement theme normalisation, stopword stripping, 20+ motif vocabulary mapping, and documented fallback in `src/themes.js`. | `node --check src/rng.js && node --check src/themes.js && node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json','utf8')); if (p.type !== 'module' || p.dependencies || p.devDependencies) process.exit(1);"` | Both JS modules pass syntax check with exit code `0`, `package.json` parses with `type === "module"` and no dependency fields. |
| Phase 1, Segment 2 | `index.html`, `styles.css`, `app.js` | Build `index.html` with exact contract IDs (`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`), ARIA roles, and placeholder `data-role="page-preview"` / `data-page-index="0"`. Add responsive print-friendly `styles.css`. Implement Phase 1 `app.js` wiring form submission, input validation, filename sanitisation, status/error updates, and theme-seeded placeholder preview cards. | `node --check app.js && node --input-type=module -e "import { readFileSync } from 'node:fs'; const h = readFileSync('index.html','utf8'); for (const id of ['theme-input','name-input','generate-btn','status','error','preview','download-btn','book-title']) { if (!h.includes('id=\"' + id + '\"')) process.exit(1); }"` | `app.js` passes syntax check and `index.html` contains all 8 required IDs verbatim, exit code `0`. |
| Phase 1, Segment 3 | `test_colouring_book.js` | Create headless `node:test` + `node:assert/strict` suite covering `hashString` stability and 32-bit unsigned range, `makeRng` determinism and divergence within 10 draws, theme tokenising/stopwords/20+ vocabulary/fallback reachability, Phase 1 anti-drift DOM selector parity (`app.js` vs `index.html` for all `#id` and `data-*` literals), and export parity (`src/rng.js`, `src/themes.js`). | `node test_colouring_book.js` | All Phase 1 tests pass with `0` failures and `0` skipped tests, exit code `0`. |

---

## Phase 2: Procedural Motifs, Vector Lettering & SVG Page Composition

Goal: Implement all 20+ procedural motifs, the single-stroke vector alphabet, interior page composition, and cover composition, then wire live 6-page inline SVG previews into `app.js`. At phase end, generating a book in the browser renders the full black-and-white cover and 5 distinct interior colouring pages, and all Phase 2 tests pass.

| Segment | Files | Purpose | Gate Command | Pass Condition |
| :--- | :--- | :--- | :--- | :--- |
| Phase 2, Segment 1 | `src/motifs.js`, `src/lettering.js` | Implement procedural polyline generators in `0..1` boxes with bounding boxes for all 20+ motifs in `src/motifs.js`. Implement single-stroke vector glyphs (`A-Z`, `0-9`, space, `-`, `'`) and `layoutText(text, options)` in `src/lettering.js`, throwing a descriptive `Error` naming any unsupported character. | `node --check src/motifs.js && node --check src/lettering.js` | Both modules parse cleanly as ES modules with exit code `0`. |
| Phase 2, Segment 2 | `src/page.js`, `src/cover.js`, `app.js` | Implement interior page composition (`src/page.js`: decorative border, ground/horizon line, 3-7 non-overlapping jittered-grid motifs with >=1 matched/fallback theme motif, well-formed SVG serialisation) and cover composition (`src/cover.js`: decorative frame, title, uppercased name at >=60 pt cap height, theme subtitle, well-formed SVG). Update `app.js` to render the generated cover plus 5 interior SVGs into `#preview` with `data-role="page-preview"` and `data-page-index="0"`..`"5"`. | `node --check src/page.js && node --check src/cover.js && node --check app.js` | All three modules pass syntax check with exit code `0`. |
| Phase 2, Segment 3 | `test_colouring_book.js` | Extend `test_colouring_book.js` to test motif vocabulary size (>=20) and polyline/bounds validity, `layoutText` coverage and unsupported-character error throwing, cover name glyphs and >=60 pt cap height, interior page count (5), motif count bounds (3-7), theme-motif presence, SVG well-formedness, pairwise distinctness, plus Phase 2 anti-drift checks (DOM selector parity and export parity across `rng.js`, `themes.js`, `motifs.js`, `lettering.js`, `page.js`, `cover.js`). | `node test_colouring_book.js` | All Phase 1 and Phase 2 tests pass with `0` failures and `0` skipped tests, exit code `0`. |

---

## Phase 3: PDF 1.4 Writer, Book Orchestrator & End-to-End Verification

Goal: Implement the dependency-free `Uint8Array` PDF 1.4 writer and `src/book.js` orchestrator, wire PDF `Blob` download into `app.js`, and complete the full >=15-test / >=40-assertion verification suite. At phase end, the browser app generates and downloads deterministic, printable 6-page A4 PDF colouring books, and the full test suite passes.

| Segment | Files | Purpose | Gate Command | Pass Condition |
| :--- | :--- | :--- | :--- | :--- |
| Phase 3, Segment 1 | `src/pdf.js` | Implement pure-JS PDF 1.4 writer returning `Uint8Array` with `%PDF-1.4` header, 4-byte binary comment, `/Catalog`, `/Pages`, `/Page` objects with `/MediaBox [0 0 595.28 841.89]`, content streams (`1 1 1 rg` + `re f`, `0 0 0 RG`, `>= 4` pt `w`, `m`/`l`/`S` vector paths), exact byte-offset `xref` table, trailer (`/Size`, `/Root`), `startxref`, and `%%EOF`. | `node --check src/pdf.js` | `src/pdf.js` passes syntax check with exit code `0`. |
| Phase 3, Segment 2 | `src/book.js`, `app.js` | Implement `src/book.js` (`validateInputs`, `sanitiseFilename`, `generateBook`) producing `{ title, theme, name, filename, cover, pages, pdfBytes }` deterministically and enforcing pairwise SVG distinctness plus motif-multiset diversity across at least 4 of 5 interior pages. Wire `generateBook` and `Blob` download (`#download-btn` enabled only after book generation) into `app.js`. | `node --check src/book.js && node --check app.js` | Both modules pass syntax check with exit code `0`. |
| Phase 3, Segment 3 | `test_colouring_book.js` | Finalise `test_colouring_book.js` (>=15 test cases, >=40 assertions) adding end-to-end `generateBook` byte-identical PDF determinism, PDF structural validity (`%PDF-1.4`, `%%EOF`, 6 pages, `/MediaBox`, every `xref` offset landing on `<n> 0 obj`, `startxref` landing on `xref`), stroke width >= 4 pt and absence of non-black strokes, filename sanitisation, validation rejection (empty theme, empty name, >20-char name, illegal name characters, >60-char theme), full export parity across all `src/*.js` modules, and full DOM selector parity. | `node test_colouring_book.js` | Complete suite reports >=15 passing tests, >=40 passing assertions, `0` failures, `0` skipped tests, exit code `0`. |

---

## Risk Register

1. **PDF cross-reference byte-offset drift**: Mixing string character lengths with multi-byte UTF-8 binary comment bytes shifts every subsequent `xref` offset. Mitigation: Construct PDF chunks explicitly via ASCII/byte arrays into `Uint8Array` in `src/pdf.js`, using raw byte values (`0xE2`, `0xE3`, `0xCF`, `0xD3`) for the binary comment line and verifying every `xref` offset against the final `Uint8Array` in Phase 3 Segment 3.
2. **Long name overflow on cover at >= 60 pt cap height**: A 20-character name on a single line at 60 pt can exceed the A4 inner frame width (`~535` pt). Mitigation: Wrap cover names onto 2 balanced lines in `src/cover.js` when single-line width exceeds the decorative inner margin, keeping cap height >= 60 pt while staying inside the border.
3. **Interior page diversity collapse for narrow themes**: A single-keyword theme (e.g., `rocket`) could yield identical motif multisets across multiple pages. Mitigation: Pair theme-matched motifs with varied complementary/fallback motifs and deterministic per-page motif counts (`3..7`) in `src/page.js` and `src/book.js`, asserting diversity across at least 4 of 5 interior pages in tests.
4. **DOM selector parity false positives/negatives**: Dynamic `data-role` or `data-page-index` attributes queried in `app.js` must also exist in `index.html` per §7. Mitigation: Include an initial placeholder element with `data-role="page-preview"` and `data-page-index="0"` inside `#preview` in `index.html` and restrict `index.html` IDs strictly to the 8 contract IDs.
5. **Non-deterministic JS pitfalls**: Accidental `Math.random()`, `Date.now()`, or `localeCompare` breaks cross-machine byte identity. Mitigation: Centralise all pseudo-random draws in `src/rng.js` and include a test asserting byte-identical `pdfBytes` across repeated calls and distinct module imports.

---

## Definition-of-Done Checklist

- `package.json` declares `"type": "module"`, a `"test"` script, and zero `dependencies` or `devDependencies`.
- All 13 required files exist at their exact module boundaries with zero external CDN links, fonts, build steps, `eval`, `new Function`, or dynamic computed `import()`.
- `src/rng.js` provides deterministic 32-bit `hashString` and seeded `makeRng` with zero `Math.random()`, `Date.now()`, or locale-dependent sorting.
- `src/themes.js` normalises themes, strips all 10 documented stopwords, maps to >= 20 motifs (covering all 20 named required motifs), and reaches a documented fallback set.
- `src/lettering.js` supports `A-Z`, `0-9`, space, `-`, and `'`, renders the cover name uppercased at >= 60 pt cap height, and throws a descriptive `Error` on unsupported characters.
- `src/page.js` and `src/cover.js` emit well-formed standalone `<svg>` markup; all 5 interior pages have 3-7 non-overlapping motifs, >= 1 theme/fallback motif, pairwise distinct SVGs, and motif-multiset differences across >= 4 of 5 pages.
- `src/pdf.js` returns a `Uint8Array` PDF 1.4 document with 6 A4 portrait pages (`/MediaBox [0 0 595.28 841.89]`), pure black strokes (`0 0 0 RG`), white page fills (`1 1 1 rg` + `re f`), stroke width >= 4 pt, valid `xref` offsets, `startxref`, and `%%EOF`.
- `app.js` and `index.html` satisfy 100% DOM selector parity for all 8 required IDs plus `data-role="page-preview"` and `data-page-index`, validate all input constraints, and download `<sanitised-name>.pdf`.
- `test_colouring_book.js` runs offline via `node test_colouring_book.js` with >= 15 tests, >= 40 assertions, 0 failures, export parity across all `src/` modules, DOM selector parity, and PDF structural validity.

---

## Stage 6 Assertion Integrity Audit

- **Roadmap audit scope**: Verified that Segment 3 of every phase adds strict `node:assert/strict` checks rather than skipping, deleting, or weakening prior assertions; every phase gate ends in a deterministic green CLI run (`node test_colouring_book.js`) and preserves all anti-drift checks (DOM selector parity, `src/` export parity, and Phase 3 PDF structural validity).

AUDIT: PASS - roadmap constraints satisfied (3 segments per phase, 1-3 files per segment, plain CLI gates, anti-drift invariant specified)