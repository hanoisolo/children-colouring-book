# AGENTS.md — children-colouring-book

Local project instructions. Inherits `C:\Users\whosh\.vibe\AGENTS.md` (Sections 1-13).
This file may add rules but may not weaken them.

## Project

A personalised children's colouring-book generator. The user supplies a **theme**
(e.g. `space dinosaurs`) and a **child's name**; the app generates five distinct
pages of black-and-white, thick-line procedural line art plus a cover carrying the
child's name, and combines all six into one downloadable A4 PDF.

Everything runs in the browser. No server, no network calls, no third-party
libraries, no build step.

## Stack

| Item | Value |
| :--- | :--- |
| Stack profile | Web UI (HTML / CSS / JS) — `~/.vibe/STACK_MATRIX.md` row 6 |
| Language | Vanilla ES2020 modules (`export`, `<script type="module">`) |
| Runtime (app) | Modern browser, offline |
| Runtime (tests) | Node v26.12.1 — `node:test` + `node:assert/strict` |
| Dependencies | **Zero.** No `dependencies` / `devDependencies`, no CDN, no external fonts |
| Build step | **None.** `index.html` loads `app.js` directly |
| Manifest | `package.json` with `"type": "module"` and a `test` script only |

## Canonical file list

| File | Role |
| :--- | :--- |
| `package.json` | `type: "module"`, `test` script, zero dependencies |
| `index.html` | Form, status, error, preview grid, download control |
| `styles.css` | Layout and print-friendly presentation |
| `app.js` | DOM controller: validate, generate, preview, download |
| `src/rng.js` | `hashString` (32-bit) and `makeRng` (seeded PRNG) |
| `src/themes.js` | Theme normalisation, stopwords, 20+ motif vocabulary, fallback |
| `src/motifs.js` | Procedural motif polyline generators in `0..1` boxes |
| `src/lettering.js` | Single-stroke vector alphabet and `layoutText` |
| `src/page.js` | Interior page composition and SVG serialisation |
| `src/cover.js` | Cover composition with the child's name |
| `src/pdf.js` | Minimal PDF 1.4 writer returning `Uint8Array` |
| `src/book.js` | Orchestrator: `(theme, name)` -> book + PDF bytes |
| `test_colouring_book.js` | The entire headless suite |

## Verification gate

The single canonical gate for this project:

```
node test_colouring_book.js
```

Per-segment syntax gates use `node --check <file>`. All gates are plain CLI and
must run in Git Bash. No PowerShell cmdlets, no GUI tools, no "looks right" gates.

## Mandatory anti-drift invariant (Section 8)

**DOM selector & event parity.** Segment 3 of every phase must include a
programmatic test that reads `index.html` and `app.js` as text and asserts:

- every `getElementById('x')`, `querySelector('#x')`, `querySelectorAll('[data-y]')`
  and `data-*` selector literal in `app.js` exists verbatim in `index.html`;
- every one of the eight contract IDs exists in `index.html`.

Contract IDs, exact and non-negotiable:

`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`,
`#download-btn`, `#book-title`

Required attributes: each preview figure carries `data-role="page-preview"` and
`data-page-index="<n>"`.

Phases 1 and 2 additionally enforce **export parity**: every `export` in `src/` is
imported and exercised by the suite.

This invariant is never weakened, skipped, or broadened to make a suite pass.

## Hard constraints

- Deterministic output: the same `(theme, name)` yields a byte-identical PDF.
  No `Math.random()`, no `Date.now()`, no locale-dependent sorting in `src/`.
- Pure black strokes on white, stroke width >= 4 pt at A4 scale (595.28 x 841.89 pt).
- No `eval`, no `new Function`, no dynamic `import()` of computed paths.
- No test may open a browser, spawn a dialog, bind a port, or make an HTTP request.
- `src/pdf.js` must return a `Uint8Array` and use no Node-only APIs, so the same
  code runs in the browser.

## Status

- **Phase 1 complete. Phase 2 — Segment 1 pending.**
- Roadmap: `plans/MASTER_ROADMAP.md` (3 phases x 3 segments).
- Gate: `node test_colouring_book.js` -> 57 tests, 0 failures, 0 skipped.
- Landed so far: `package.json`, `src/rng.js`, `src/themes.js`, `index.html`,
  `styles.css`, `app.js`, `test_colouring_book.js`, `.gitattributes`.
- Phase 1 milestone review: `AUDIT: PASS` (`plans/milestone_review.md`).
- Phase-boundary milestone review required after Phase 2 Segment 3 (Section 7).

## Stage 6 mutation gate

Run it with the gate command directly — no wrapper:

```
python ../ask_gemini.py --mutation-baseline <sha> --mutation-gate "node test_colouring_book.js" --out plans/mutation_report.md
```

`mutation_gate.run_gate` now kills the whole process tree on timeout, so a
mutant that turns a loop bound into an infinite loop is reported as a kill
instead of hanging the pass. The `plans/mutation_gate.sh` wrapper that worked
around the old hang has been removed.

## Phase 2 architectural constraints (from the Phase 1 milestone review)

These are binding for Phase 2 and Phase 3. They come from the architect's
review of the Phase 1 boundary and are not optional refinements.

1. **One canonical polyline IR.** `src/page.js` and `src/cover.js` emit a single
   polyline intermediate representation in top-down A4 user units. SVG
   serialisation and the PDF emitter both consume that same IR. Flip the Y axis
   only inside `src/pdf.js`, never in the composition modules, so the two
   outputs cannot drift.
2. **Track `closed` and `fill` per polyline.** SVG hides overlaps with
   `fill="white"`; a stroke-only PDF exposes "X-ray" intersections where shapes
   cross. Each polyline carries whether it is closed and whether it is filled,
   and `src/pdf.js` emits `B` for filled-and-stroked versus `S` for stroke-only.
   Use round caps and joins (`1 J`, `1 j`) to avoid acute miter spikes.
3. **Lettering must handle diacritics and long names.** `validateInputs` accepts
   `Zoë` and `José`, so `src/lettering.js` must render accented glyphs (NFD base
   letter plus accent strokes) rather than throwing. Names up to 20 characters
   must scale or wrap to stay inside the cover frame at a cap height of at least
   60 pt.
4. **No fake-DOM shim.** Keep `app.js` DOM wiring thin and put all SVG and card
   assembly in pure functions the suite can call headlessly. Static selector
   parity plus Phase 3 end-to-end coverage is the agreed level of DOM assurance.
5. **Move `validateInputs` and `sanitiseFilename` at Phase 3 Segment 2**, not
   earlier. When moving them to `src/book.js`, update the test imports and the
   `app.js` export-parity expectation in the same commit so no duplicate
   implementation survives.
