## Architect Context Packet
- Mode & Tier: audit (Tier 4 — multi-phase system, pre-ship security gate)
- Project & Stack: children-colouring-book | Web UI (HTML/CSS/JS), vanilla ES2020 modules, zero third-party dependencies, zero build step | Node v26.12.1 (`node:test` + `node:assert/strict`)
- Git Baseline: 61c37a2 | Working tree: CLEAN
- Baseline Test Status: `node test_colouring_book.js` -> 145 passed, 0 failed, 0 skipped
- Canonical File Inventory:
  * `package.json` (config, 10 lines) — type module, zero dependencies, private
  * `index.html` (source, 63 lines) — form, status/error, preview grid, download control
  * `styles.css` (source, 180 lines) — layout and print stylesheet
  * `app.js` (source, 110 lines) — pure DOM controller, no exports
  * `src/rng.js` (source, 151 lines) — FNV-1a hash, mulberry32 PRNG, deriveSeed, seeded helpers
  * `src/themes.js` (source, 244 lines) — stopwords, plural ladder, 25-motif vocabulary, keyword map, fallback
  * `src/motifs.js` (source, 470 lines) — 25 procedural motif generators, polyline builders, bounds
  * `src/lettering.js` (source, 288 lines) — single-stroke A-Z/0-9/punctuation, NFD accent resolution, layout/measure/fit
  * `src/page.js` (source, 279 lines) — interior page composition, polyline IR, SVG serialiser, escapeXml
  * `src/cover.js` (source, 296 lines) — cover composition, name fitting and wrapping
  * `src/pdf.js` (source, 202 lines) — PDF 1.4 writer, byte-chunk assembly, xref, UTF-16BE info strings
  * `src/book.js` (source, 188 lines) — validation, filename sanitiser, page planning, book assembly
  * `test_colouring_book.js` (test, 1667 lines) — 140 tests, 419 assertions
  * `README.md` (doc) — human entry point
  * `AGENTS.md` (doc) — build rules and architectural constraints
- Mandatory Anti-Drift Invariants: DOM selector parity between `app.js` and `index.html` for the eight contract IDs (`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`) plus `data-role="page-preview"` and `data-page-index`; export parity for every `export` in all nine modules, with `app.js` asserted to export nothing; determinism guard banning `Math.random`, `Date.now`, `new Date`, `localeCompare`, `eval`, `new Function`, dynamic `import()` across all eight source files.

---

# Pre-Ship Security Audit — Second Pass

This is a re-audit after remediation. The first pass returned `AUDIT: FAIL` with
five findings. Four are now fixed and one was a gap in the evidence, not the
code. `styles.css`, `AGENTS.md` and `README.md` are attached this time, so
finding 7 can be verified rather than deferred.

## Remediation since the first pass

| First-pass finding | Status |
| :--- | :--- |
| `src/themes.js:218` prototype lookup crashes on theme `"constructor"` | **Fixed.** `motifsForTheme` now guards with `Object.hasOwn`, matching `singularise`. `generateBook('constructor', 'Amara')` returns a book. |
| `src/book.js:72-81` allows Windows reserved device filenames | **Fixed.** A reserved stem gets a `-book` suffix: `Con` -> `con-book.pdf`, `Connor` -> `connor.pdf`. |
| `src/pdf.js:64-75` passes lone surrogates verbatim | **Fixed.** A lone surrogate in `0xD800..0xDFFF` now encodes as `FFFD`; valid pairs are untouched. |
| `test_colouring_book.js` lacks reachable hostile-input cases | **Fixed.** Added: inherited-property themes, markup and control characters in the theme, reserved filenames, and path-traversal attempts in the name. 140 -> 145 tests. |
| `AGENTS.md`, `README.md`, `styles.css`, `plans/` unattached | **Attached now**, except `plans/`, which is described below. |

One further finding the first pass did not raise, found while verifying it:
`AGENTS.md` hardcoded `C:\Users\whosh\.vibe\AGENTS.md`, which violates Section 5
and would have published the username. It now reads `~/.vibe/AGENTS.md`, and a
scan for `[A-Za-z]:\\`, `/c/Users` and the username across all tracked files
returns nothing.

## What is still open, and why

- **`plans/` is not attached.** It holds the roadmap, three milestone reviews,
  the Stage 6 evidence and this brief. `plans/architect_usage.log`,
  `plans/removal_waivers.log`, `plans/strike_counter.json`,
  `plans/stage6_test.diff`, `plans/stage6_scan.md` and `plans/mutation_report.md`
  are gitignored and will not be published. The tracked remainder is project
  documentation with no credentials. If you want it audited, say so and I will
  attach it in a third pass.
- **`innerHTML` at `app.js:35` is unchanged.** The first pass rated it PASS and
  noted `createElementNS` as an alternative. It is not being changed before
  publication.

---

# Audit Scope

This is a static, offline, single-page browser application. It has no server, no
network calls, no authentication, no persistence, no cookies, no third-party
dependencies and no build step. The entire trust boundary is one HTML form with
two text inputs.

Audit the attached files for the following, and be specific about which file and
line each finding sits on.

## 1. XSS and DOM safety

The one DOM sink in the project is `app.js:35`, `figure.innerHTML = card.svg`.
`card.svg` is produced by `pageToSvg` / `coverToSvg` in `src/page.js` and
`src/cover.js`. The SVG body is generated from numbers and path data only; the
single text-bearing attribute is `aria-label`, written through `escapeXml`
(`src/page.js:207`), which escapes `&`, `<`, `>`, `"` and `'` in that order.

The two user-controlled strings are the theme and the child's name.
`validateInputs` (`src/book.js`) restricts the name to
`/^\p{L}[\p{L} '-]*$/u` and additionally requires every uppercased character to
have a glyph. The theme is used only to select motifs and to build a subtitle
that `composeCover` filters to drawable characters.

Questions: is the escaping complete for the attribute context it is used in? Can
either input reach the SVG as markup through any path I have not listed? Is
`innerHTML` avoidable here, and if so is the alternative worth the change?

## 2. Input validation and resource exhaustion

`MAX_THEME_LENGTH = 60`, `MAX_NAME_LENGTH = 20`, `PAGE_COUNT = 5`. The name is
also checked against the drawable alphabet. `index.html` sets `maxlength` on
both inputs, but `maxlength` is a client-side hint and `validateInputs` is the
real gate.

Questions: is there an input that passes `validateInputs` and then causes
unbounded work, a pathological loop, or a very large allocation? Consider the
lettering fit/wrap loop, the motif planner, and the PDF writer's chunk
accumulation.

## 3. Filename handling

`sanitiseFilename` folds accents via NFD, drops apostrophes, collapses
non-alphanumerics to a hyphen, trims hyphens, and falls back to
`colouring-book`. The result becomes `link.download` in `app.js`.

Questions: can the sanitised name contain a path separator, a leading dot, a
Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`..`COM9`,
`LPT1`..`LPT9`), a trailing dot or space, or a control character? The download
attribute is not a filesystem path, but the file lands on the user's disk under
that name.

## 4. PDF writer safety

`src/pdf.js` writes a PDF 1.4 document by hand. `/Info` strings go through
`pdfTextString`, which emits a literal for printable ASCII with `\` and
parentheses escaped, and a UTF-16BE hex string with a `FEFF` BOM otherwise.
`asciiBytes` throws on any character above `0x7f` in the document structure.

Questions: can a crafted name or title break out of the literal string, inject a
PDF operator, or corrupt the xref table? Is the `\` and parenthesis escaping
sufficient for a PDF literal string? Does the UTF-16BE path handle a lone
surrogate or an unpaired code unit?

## 5. Dependency and lockfile hygiene (Section 10)

`package.json` declares zero `dependencies` and zero `devDependencies`, and there
is no lockfile because there is nothing to lock. `index.html` loads no external
resource; the only absolute URL anywhere is the SVG namespace
`http://www.w3.org/2000/svg`, which is an identifier and not a fetch.

Questions: confirm there is no hidden dependency, no CDN reference, no external
font, and no build step. Is the absence of a lockfile correct here?

## 6. Security test coverage

The suite has 140 tests. Relevant negative-path coverage: `validateInputs`
rejects empty theme, empty name, over-length name, over-length theme, illegal
name characters, and names using undrawable letters; `generateBook` rejects the
same; `pdfTextString` escapes parentheses and backslashes; `polylinesToSvg`
escapes the aria label; `buildPdf` rejects an empty page list; `drawMotif`
rejects an unknown motif; `layoutText` throws on an unsupported character.

Questions: which malicious or hostile inputs are *not* tested? Name the specific
cases worth adding before this is published publicly, and say which are
theoretical versus reachable.

## 7. Publication risk

The repository is about to be published publicly on GitHub. It contains no
secrets, no credentials, no `.env`, and no user data. `plans/` holds the
roadmap, milestone reviews and Stage 6 evidence; `plans/architect_usage.log`,
`plans/removal_waivers.log` and the generated diffs are gitignored.

Questions: is anything in the tracked tree unsafe or unwise to publish? Does
`AGENTS.md` disclose anything that should not be public?

## Output

Answer only these seven points, under 700 words total. For each, state PASS or
the specific weakness with file and line. End with exactly one verdict line:
`AUDIT: PASS - <one sentence>` or `AUDIT: FAIL - <itemized weaknesses>`.
