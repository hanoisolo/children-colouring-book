# AGENTS.md — children-colouring-book

Local project instructions. Inherits the user-level `~/.vibe/AGENTS.md` (Sections 1-13).
This file may add rules but may not weaken them.

## Project

A personalised children's colouring-book generator. The user supplies a **theme**
(e.g. `space dinosaurs`) and a **child's name**; the app generates five distinct
pages of black-and-white, thick-line line art plus a cover carrying the child's
name, and combines all six into one downloadable A4 PDF.

Everything runs in the browser. No server, no third-party libraries.

There are **two art pipelines**, selected automatically at submit time:

| Mode | Trigger | Art source | Deterministic |
| :--- | :--- | :--- | :--- |
| **Vector** | no API key in the key field | `src/motifs.js` procedural polylines | yes, byte-identical |
| **Image** | key present | Gemini `gemini-3.1-flash-lite-image` | no, fresh art each run |

The vector pipeline is not legacy. It is the offline path and the no-key path,
and it is what the 151 original tests pin. Do not delete it.

The app also ships as **one self-contained HTML file**, `dist/colouring-book.html`,
built by `npm run build` and opened straight from disk with no server.

## Stack

| Item | Value |
| :--- | :--- |
| Stack profile | Web UI (HTML / CSS / JS) — `~/.vibe/STACK_MATRIX.md` row 6 |
| Language | Vanilla ES2020 modules (`export`, `<script type="module">`) |
| Runtime (app) | Modern browser, offline in vector mode |
| Runtime (tests) | Node v26.12.1 — `node:test` + `node:assert/strict` |
| Dependencies | **Zero.** No `dependencies` / `devDependencies`, no CDN, no external fonts |
| Build step | `npm run build` -> `dist/colouring-book.html`. **Not required to run the app**; `index.html` still loads `app.js` directly |
| Manifest | `package.json` with `"type": "module"`, `start`, `build`, `test` scripts, zero dependencies |
| External service | Gemini image API, only when the user supplies a key |

## Canonical file list

| File | Role |
| :--- | :--- |
| `package.json` | `type: "module"`, `start` / `build` / `test` scripts, zero dependencies |
| `index.html` | Form, key field, cost note, status, error, preview grid, download control |
| `styles.css` | Layout and print-friendly presentation |
| `app.js` | DOM controller: validate, generate, preview, download |
| `serve.js` | Zero-dependency static server for local development (`npm start`) |
| `build.js` | Bundler: inlines CSS and every module into `dist/colouring-book.html` |
| `dist/colouring-book.html` | **The shipped artifact.** One file, no external refs, opens from `file://` |
| `smoke.html` | Browser smoke-test fixture: drives the real page in an iframe |
| `test_browser.js` | Headless Chromium smoke test (`npm run test:browser`) |
| `scripts/release.sh` | Release preflight and published-asset hash verification |
| `src/rng.js` | `hashString` (32-bit) and `makeRng` (seeded PRNG) |
| `src/themes.js` | Theme normalisation, stopwords, 20+ motif vocabulary, fallback |
| `src/motifs.js` | Procedural motif polyline generators in `0..1` boxes |
| `src/lettering.js` | Single-stroke vector alphabet and `layoutText` |
| `src/page.js` | Interior page composition and SVG serialisation |
| `src/cover.js` | Cover composition with the child's name |
| `src/imagegen.js` | Gemini image client: prompts, request, response parsing, cost |
| `src/pdf.js` | Minimal PDF 1.4 writer returning `Uint8Array`; embeds JPEG XObjects |
| `src/book.js` | Orchestrator: `(theme, name)` -> book + PDF bytes, vector or image |
| `test_colouring_book.js` | The entire headless suite |

## Verification gate

The canonical gate for this project:

```
npm test
```

That runs two layers:

```
node test_colouring_book.js   # 284 unit tests, no browser, ~400ms
node test_browser.js          # 3 browser tests, needs Edge or Chrome, ~3.3s
```

Per-segment syntax gates use `node --check <file>`. All gates are plain CLI and
must run in Git Bash. No PowerShell cmdlets, no GUI tools, no "looks right" gates.

**The mutation gate uses the unit suite only** (`node test_colouring_book.js`).
Running a browser per mutant would take minutes per file and buy nothing: the
mutants are in `src/`, which the unit suite already exercises directly.

**The mutation gate skips files with no unit-test coverage by design.** The
canonical invocation is:

```
python ../ask_gemini.py --mutation-baseline <sha> \
  --mutation-gate "node test_colouring_book.js" \
  --mutation-skip "*.html" --mutation-skip "*.css" --mutation-skip "plans/*" \
  --mutation-out plans/mutation_report.md
```

`index.html`, `styles.css`, `smoke.html` and `plans/live_check.mjs` cannot be
constrained by a unit test, so every mutant in them survives. Without the skip
globs they produced 69 of 88 survivors and buried the 19 that described real
source. `dist/colouring-book.html` needs no glob: build output is skipped by
directory. Skipped files are named in the report, so the exclusion is visible.

**No test may call the live image API.** `src/imagegen.js` resolves `fetch` from
`globalThis` at call time so the suite can stub it. A test that reaches the
network would be slow, flaky, and would bill the user's key.

## Browser smoke test

`test_browser.js` serves the project, loads `smoke.html` in headless Chromium,
and lets that page drive the real `index.html` in a same-origin iframe: fill the
form, click Generate book, then report the resulting DOM back through the page
title. It asserts six previews, six SVGs, an enabled download, the exact status
line, the book title, and that the boot notice stayed hidden.

Three scenarios run:

1. **Vector** — no key. The baseline assertions, unchanged.
2. **Image** — `?mode=image` stubs `win.fetch` inside the iframe with a
   synthetic JPEG and sets the key field. It makes no outbound request and costs
   nothing, but it exercises the real wiring: the key field, the async handler,
   six image cards, the cover overlay, the cost note and the download.
3. **Shipped file** — loads `dist/colouring-book.html` itself over `file://`,
   because the bundle is what a user actually opens. Testing only the served
   source would leave the artifact unproven.

It exists because 147 unit tests once passed while clicking Generate book did
nothing. Nothing in the unit suite loads a document, so nothing could see it.

Two rules for this test:

1. **It drives the real `index.html`, never a copy of its markup.** If the page
   drifts, the test must fail. Do not replace the iframe with inline markup.
2. **It never skips silently.** If no Chromium browser is found it fails and
   says so. A browser test that quietly does nothing is how the dead button
   shipped in the first place.

## Mandatory anti-drift invariant (Section 8)

**DOM selector & event parity.** Segment 3 of every phase must include a
programmatic test that reads `index.html` and `app.js` as text and asserts:

- every `getElementById('x')`, `querySelector('#x')`, `querySelectorAll('[data-y]')`
  and `data-*` selector literal in `app.js` exists verbatim in `index.html`;
- every one of the eight contract IDs exists in `index.html`.

Contract IDs, exact and non-negotiable:

`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`,
`#download-btn`, `#book-title`

**Exactly eight.** A baseline test asserts the count, so new controls must not
add ids. The image-mode controls use `data-role` instead: `data-role="api-key"`
on the key input and `data-role="cost-note"` on the cost paragraph. The key
input is wrapped in a `<label>` with no `for` and no `id`, so it is still
labelled for assistive tech without touching the id count.

Required attributes: each preview figure carries `data-role="page-preview"` and
`data-page-index="<n>"`.

Every phase additionally enforces **export parity**: every `export` in `src/` is
imported and exercised by the suite, and `app.js` is asserted to export nothing.

This invariant is never weakened, skipped, or broadened to make a suite pass.

## Hard constraints

- **Determinism applies to vector mode.** The same `(theme, name)` yields a
  byte-identical PDF when no key is present. No `Math.random()`, no
  `Date.now()`, no locale-dependent sorting in `src/`. Image mode is
  deliberately non-deterministic: the model returns fresh art each run. Do not
  "fix" that by caching or seeding — it is the point of the feature.
- Pure black strokes on white, stroke width >= 4 pt at A4 scale (595.28 x 841.89 pt).
- No `eval`, no `new Function`, no dynamic `import()` of computed paths.
- No test may spawn a dialog or make an outbound HTTP request. The unit suite
  (`test_colouring_book.js`) must not open a browser or bind a port. The one
  deliberate exception is `test_browser.js`, which binds an ephemeral loopback
  port and drives headless Chromium against the real page — see the browser
  smoke test section below.
- `src/pdf.js` must return a `Uint8Array` and use no Node-only APIs, so the same
  code runs in the browser.
- **The API key is never persisted.** It lives in a password input for the
  duration of the page and is sent only in the `x-goog-api-key` header. No
  `localStorage`, no `sessionStorage`, no cookie, no query string, no log line.
  A test asserts the key never appears in the generated PDF bytes.
- **The child's name never reaches the image service.** `buildPagePrompt` and
  `buildCoverPrompt` take no `name` parameter at all, so there is no argument to
  leak it through. The name is drawn as vector strokes by `src/lettering.js` and
  is only ever written into the PDF and the preview. Two tests hold this: a
  structural one (a name handed in anyway is ignored) and an end-to-end canary
  (`Xqzzy`, `Zoë`, `José` absent from URL, headers and body in every request,
  including case-folded and NFD-normalized variants). The theme *is* sent, so
  the form warns against typing personal details into it.
- **`dist/colouring-book.html` must be rebuilt and committed whenever `src/`,
  `app.js`, `styles.css` or `index.html` changes.** A stale bundle is a shipped
  bug: it is the file users open. This is now **checked, not trusted**:
  `npm test` builds to a temp path and compares the result byte-for-byte against
  the committed bundle, so a source change that was not rebuilt fails the gate.
  Tests must never write `dist/` — when they did, the suite regenerated the
  artifact it was verifying and a stale bundle could never fail anything.
- **The app runs two ways.** `npm start` serves the source over HTTP for
  development. `dist/colouring-book.html` opens from `file://` with no server,
  because the bundler inlines every module into one classic script. A browser
  refuses to fetch an ES module from a `file://` page, so the source form still
  needs the server; `index.html` carries a classic-script boot check that
  reveals a `.boot-error` notice when `app.js` never evaluates. Do not remove
  that notice or the `window.__bookBooted` signal in `app.js`.

## Image pipeline constraints (from the upgrade review)

Binding for any work on image mode. They come from the architect's review of the
upgrade plan, which returned `REVIEW: FAIL` and named four defects that were
then fixed.

1. **The cheapest model, and it is pinned.** `gemini-3.1-flash-lite-image`
   (Nano Banana 2 Lite) at **$0.0336 per 1K image** — $30 per 1M image output
   tokens, 1120 tokens per image. `gemini-nano-banana-2.1` costs the same at 1K
   but is heavier; `gemini-3-pro-image` is $0.134, four times the price. Do not
   "upgrade" the model without re-measuring the price, and do not add a model
   picker: the user asked for the cheapest one.
2. **The model returns JPEG, not PNG.** `parseImageResponse` reads
   `candidates[0].content.parts[]` for the part carrying `inlineData`, and the
   bytes are embedded as a `/DCTDecode` XObject untouched. Re-encoding them
   would cost quality and CPU for nothing.
3. **`jpegSize` walks segment lengths.** A JPEG with an EXIF thumbnail contains
   a second SOF0 inside the thumbnail, so scanning for the first `0xFFC0` reads
   the wrong dimensions. Walk the segment chain instead.
4. **Wrap the image in `q`/`Q`.** `cm` mutates the CTM, and without the save and
   restore every later operator on the page inherits the image transform.
5. **The XObject dict is complete.** `/ColorSpace` is derived from the SOF
   component count (1 = `/DeviceGray`, 3 = `/RGB`), not assumed.
6. **`stroke: false` means fill-only.** The white band behind the cover name
   must emit `f`, not `B`, or it gets a black outline and the name sits in a
   box.
7. **One `fitImageRect`, shared.** The PDF placement and the preview placement
   come from the same function, so what the user sees is what prints.
8. **The cover name stays vector.** Image models misspell names, so the cover is
   a generated image with a white band across the top and the name drawn from
   `src/lettering.js`. `buildCoverPrompt` reserves the top third of the frame so
   the band never covers the art.
9. **Object numbers are allocated dynamically.** `buildPdf` numbers objects as
   it goes. A vector-only book must still produce the original numbering
   (catalog 1, pages 2, page/content pairs, then images, then info) — a baseline
   test pins it.
10. **The bundler is not a general-purpose bundler.** `build.js` inlines the ten
    modules in dependency order, emits `'use strict'`, escapes `</script>`, and
    strips the `file://` boot script. It handles this project's import graph and
    nothing else. Do not grow it into a tool.

## Partial-failure contract (from the audit fix pass)

Binding for any work on image mode. A parent who has paid for three pictures
must not lose them to a failure on the fourth.

1. **`generateImages` stays fail-fast; `generateImagesSettled` is what the book
   uses.** The fail-fast form is pinned by three rejection tests and is still the
   primitive. The settled form returns parallel `images` / `errors` arrays and
   keeps going. Both share `requestWithRetry`, so the 429 policy cannot drift.
2. **Zero successes throws; at least one returns a partial.** With every image
   failed there is nothing to salvage, so the first error is thrown (a baseline
   test pins the 401 case). With one or more, `generateImageBook` returns
   `{ complete: false, images, errors, failures, succeeded, total, costUsd }`
   and **no `pdfBytes`** — a partial book must never become a PDF.
3. **`resume` finishes a partial without re-billing.** Passing the partial back
   as `resume` requests only the empty slots. It refuses a different theme or
   name, and refuses a different slot count, because splicing one child's
   artwork into another's is worse than failing.
4. **Never silently substitute vector art.** `app.js` shows the count, the cost
   of finishing, and the free alternative, and waits for a choice. The vector
   path runs only when the user clicks it.
5. **A failed state must not leave a stale download.** `showPartial` disables
   the download button and clears its handler, so a book from a previous run
   cannot be downloaded under a failed state.
6. **The in-flight guard is explicit.** The disabled button covers the common
   case; a `inFlight` flag covers the rest, so a double submit cannot launch two
   paid batches.

## Release verification

`scripts/release.sh` closes the gap between `master` and the download link:

```
scripts/release.sh            # clean tree on master, full gate, prints the sha256
scripts/release.sh --verify   # downloads the published asset and compares hashes
```

`--verify` is the only step that proves `releases/latest/download/colouring-book.html`
matches `dist/colouring-book.html`. Run it after uploading an asset. It found a
real mismatch on its first run: the published asset was serving an older bundle
than `master`.

## Status

- **Upgrade complete: image mode and the downloadable single file are shipped.**
- Baseline before the upgrade: `d846283`, 151 unit tests + 1 browser test.
- Gate: `npm test` -> 284 unit tests + 3 browser tests, 0 failures, 0 skipped.
- Landed in the upgrade: `src/imagegen.js`, `build.js`,
  `dist/colouring-book.html`; modified `src/pdf.js`, `src/book.js`,
  `src/page.js`, `index.html`, `app.js`, `styles.css`, `package.json`,
  `.gitignore`, `test_colouring_book.js`, `smoke.html`, `test_browser.js`.
- The vector pipeline is retained as the no-key path. Deleting it would break
  the offline promise and 151 baseline tests.
- Evidence trail: `plans/upgrade_brief.md`, `plans/upgrade_plan.md`,
  `plans/upgrade_review.md`, `plans/stage6_scan.md`, `plans/mutation_report.md`.
- Stage 6 assertion scan: `SCAN: PASS` against `d846283` — 253 assertions added,
  3 removed and justified in `plans/removal_justification.md` (all three were
  moved verbatim into `readReport()`, which now runs them in three tests instead
  of one).
- Stage 6 mutation gate: `MUTATION: REVIEW`. `app.js` survivors went 3 -> 15 on
  the first pass, which was a real regression: the new status and cost strings
  were built inline in the submit handler where the unit suite cannot reach
  them. They were extracted into `costNoteText`, `drawingStatusText`,
  `readyStatusText`, `hasApiKey` and `submitUiState` in `src/book.js`, and
  `app.js` survivors fell to **1**, below the previous baseline. The baseline
  records that improvement plus the new `build.js` entry.

### The mutation gate was blind to `src/` — fixed, but read the per-file section

This section used to warn that the gate could not see `src/` at all. Four
defects caused that, all fixed in the tooling repo (`9284afd`):

1. **Alphabetical starvation.** The walk was `sorted(changed)` with a finite
   cap, so `dist/colouring-book.html` (~3500 added lines) sorted before `src/`
   and consumed the whole 200-mutant budget. Build output is now skipped by
   directory and the budget is shared per file.
2. **Baseline clobbering.** `write_mutation_baseline` replaced the file, so a
   run that never reached `src/` deleted every `src/` entry. It now merges.
3. **Hard-kill corruption.** A `finally` cannot run on SIGKILL. Originals go to
   a sidecar in temp and are restored before the dirty-tree check.
4. **Clean-exit corruption.** The sidecar covered generated output but a clean
   exit only deleted it, so a suite that rebuilds a bundle left `dist/` holding
   a mutant. The `finally` now restores from the sidecar.

The score moved from 6.1% to 86.4% because the earlier figure described
generated HTML rather than source. `dist/colouring-book.html` is still absent
from the baseline: recording survivors of generated output would bless a
meaningless number and let the bundle's noise mask a real source regression.

**The run is still partial by design.** `--mutation-max` is shared across
files, so `per_file = max_mutants // len(targets)`. A file with more mutable
lines than its share is truncated and the report says so. Raise
`--mutation-max` to measure more; do not read a truncated file's zero
survivors as coverage.
- **Phase 3 complete. All three roadmap phases are done; the project is ship-ready.**
- Roadmap: `plans/MASTER_ROADMAP.md` (3 phases x 3 segments).
- Pre-ship security audit: `AUDIT: PASS` (`plans/security_audit.md`). The first
  pass returned `AUDIT: FAIL` and found four real defects, all fixed: a
  prototype-chain lookup in `motifsForTheme` that crashed on the theme
  `constructor`, Windows reserved device filenames from `sanitiseFilename`,
  lone surrogates emitted verbatim by `pdfTextString`, and a hardcoded machine
  path in this file. Every prototype-key lookup in the project now uses
  `Object.hasOwn`.
- Phase 1 milestone review: `AUDIT: PASS` (`plans/milestone_review_phase1.md`).
- Phase 2 milestone review: `AUDIT: PASS` (`plans/milestone_review_phase2.md`).
- Phase 3 milestone review: `AUDIT: PASS` (`plans/milestone_review_phase3.md`).
  `plans/milestone_brief.md` is the working brief for the phase currently under
  review; each completed phase's verdict is archived as
  `plans/milestone_review_phaseN.md`.
- Phase 3 Stage 6: `SCAN: PASS` (92 assertions added, 9 removed and justified in
  `plans/removal_justification.md`).
- Mutation gate, current: `MUTATION: REVIEW` — 86.4% (184 killed, 29 survived,
  9 invalid, 222 mutants, no truncation) recorded in
  `plans/mutation_baseline.json`. `src/book.js` and `src/page.js` are at zero
  survivors. The 29 that remain are listed below.
- No further phase is planned. The next step, if requested, is the `gemini-ship`
  skill: documentation, full verification, security audit, publish or PR.

### Audit fix pass (baseline `08b7e24`)

An external brief-only audit raised 13 findings. Seven were real and are fixed;
six were already covered by existing tests and were verified as such rather than
re-implemented.

- **Fixed:** the child's name was sent to Gemini in all six requests (now
  structurally impossible); the bundle-freshness check was vacuous because the
  suite rewrote `dist/` (now a real byte comparison); partial image failure
  discarded paid images (now a partial result with `resume`); no zero-network
  assertion in vector mode (now asserted, with fetch instrumented in both
  modes); silent theme fallback (now a `theme-note`); no release verification
  (now `scripts/release.sh`); pricing had no dated source (now derived from
  `IMAGE_TOKENS_PER_IMAGE` and `IMAGE_PRICE_PER_MTOKENS`).
- **Already covered, not re-implemented:** xref offsets, stream `/Length`,
  `q`/`Q` balance, `B`/`S`/`f` selection, white fill, UTF-16BE hex and paren
  escaping, Y flip, EXIF-thumbnail `jpegSize`, non-square `fitImageRect`, base64
  padding, concurrency clamp, key-in-error, determinism grep, reserved
  filenames, lone surrogates.
- **Out of scope:** print on real paper, mobile `file://` behaviour, and
  screen-reader/keyboard accessibility need real hardware.
- Gate: `npm test` -> 284 unit tests + 3 browser tests, 0 failures.
- Stage 6 assertion scan: `SCAN: PASS` against `08b7e24` — 51 assertions added,
  4 removed and justified in `plans/removal_justification_audit_fix.md` (all
  four pinned the name leak; each is replaced by a stricter assertion plus an
  end-to-end canary). A fifth removal was a genuine coverage loss and was
  restored rather than waived.
- Evidence trail: `plans/audit_fix_brief.md`, `plans/audit_fix_plan.md`,
  `plans/stage6_scan.md`, `plans/removal_justification_audit_fix.md`.

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

## Phase 3 architectural constraints (from the Phase 2 milestone review)

Binding for Phase 3. They come from the architect's review of the Phase 2
boundary.

1. **Exercise the filled path end to end.** No motif currently sets
   `fill: true`, so the PDF `B`-versus-`S` branch would ship untested. Phase 3
   Segment 1 adds `fill: true` to a few closed foreground shapes in
   `src/motifs.js` (rocket window, house roof and door, car wheels drawn after
   the chassis) so a real filled shape reaches the PDF writer.
2. **Graphics state parity.** `src/pdf.js` must emit `1 J 1 j` (round caps and
   joins — critical for the open lettering strokes), set `1 1 1 rg` and
   `0 0 0 RG` so `B` paints white rather than PDF's default black, and guard
   against `closed: false, fill: true`, because PDF's `B` implicitly closes an
   open path.
3. **Binary PDF structure.** Compute `xref` offsets in exact bytes over a
   `Uint8Array` — never JS string `.length`, never Node `Buffer`. Emit strict
   20-byte `xref` rows. Encode non-ASCII names (`Zoë`, `José`) in `/Info` as
   UTF-16BE hex or PDFDocEncoding, not raw UTF-8 literals.
4. **IR hygiene.** The Y flip stays pure: `src/pdf.js` must not mutate the
   shared polyline points in place. When `validateInputs` and
   `sanitiseFilename` move to `src/book.js`, update the export-parity and
   determinism tests in the same commit.
5. **Accepted mutation survivors.** The 29 that remain are the JPEG marker walk
   and `fitImageRect` in `src/pdf.js` (10), the base64 decoder, error wording
   and concurrency clamp in `src/imagegen.js` (13), the bundler's own
   self-invocation guard in `build.js` (5), and the `percent` formatter in
   `app.js` (1). Do not pin them: they are loop bounds, unexported constants,
   error strings and DOM-only lines, and pinning every internal constant would
   make any visual adjustment a test failure. The cover-band geometry was
   pinned deliberately and is no longer in this list — see the mutation gate
   section above.

## Ship constraints (from the Phase 3 milestone review)

Binding for any post-ship work. They come from the architect's review of the
Phase 3 boundary, which returned `AUDIT: PASS`.

1. **No DOM shim, permanently.** Static selector parity is the agreed level of
   DOM assurance. Adding `jsdom` or `happy-dom` would break the zero-dependency
   constraint, and a hand-written mock `document` would only test the mock. The
   three surviving `app.js` mutants are accepted on that basis.
2. **Vector-only cover lettering stays.** The child's name is drawn as polylines
   from `src/lettering.js`, not as PDF text, so the preview and the print are
   identical and a child can colour the letters. The name is still readable
   metadata in `/Info /Title`. If screen-reader or search support inside the
   cover page is ever wanted, layer invisible text (`3 Tr`) with a `/Font`
   behind the strokes without changing the geometry.
3. **86.4% mutation score is the ship baseline.** Do not pin `circle`/`ellipse`
   `segments = 24`; curve-sampling defaults are aesthetic tuning, and pinning
   them makes any visual adjustment a test failure. The cover-band geometry is
   the exception and is pinned on purpose: it decides whether a name fits, so
   it is behaviour rather than tuning.
4. **The mutation gate cannot see deleted logic.** It mutates added lines only.
   Any future change that deletes behaviour must be covered by the
   assertion-integrity scan plus a hand-written replacement test, because the
   mutation pass will report a clean score either way.
