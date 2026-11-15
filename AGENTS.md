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
- Gate: `node test_colouring_book.js` -> 49 tests, 0 failures, 0 skipped.
- Landed so far: `package.json`, `src/rng.js`, `src/themes.js`, `index.html`,
  `styles.css`, `app.js`, `test_colouring_book.js`.
- Phase-boundary milestone review required after Phase 2 Segment 3 (Section 7).
  Phase 1 review completed at commit `Phase 1`.
