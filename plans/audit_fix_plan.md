### 1. Rulings on F1 and F2

- **F1 (`test_colouring_book.js:1925`)**: Approved to rewrite. Pinning the child's name inside an external model prompt tests a privacy defect, not a feature. Rewrite `:1925` to assert `pageIndex + 1` and motifs remain while the name is absent, paired with the new canary test (`Xqzzy`, `Zoë`, `José`, case-folded and NFD-normalized variants absent from URL, headers, and serialized body).
- **F2 (freshness comparison target)**: Compare the temp-built output byte-for-byte against the **working-tree** `dist/colouring-book.html`. Comparing against `HEAD` would fail on any valid local edit before rebuilding and introduces a `git` subprocess into the unit suite. The working-tree check catches forgotten rebuilds locally, while `scripts/release.sh` (F6) enforces a clean git tree on `master` before release.

### 2. Ruling on F3 `resume` Shape

Approved with a strict boundary: keep the merge inside `generateImageBook` (`src/book.js`), not `app.js`.
- Partial return shape: `{ complete: false, theme, name, matched, images, errors, retryIndexes, succeeded, total, failures, costUsd }` (no `pdfBytes`), where `images` is a 6-element array (`image | null`).
- Pass `{ resume: partialResult }` back into `generateImageBook`. Validate `resume.theme === result.theme && resume.name === result.name` (throw on mismatch), call `generateImagesSettled` only for `retryIndexes`, merge into a fresh 6-slot array, and return partial again if any slot remains `null`.
- `app.js` holds `partialResult` only as an opaque token and discards it whenever `theme`, `name`, or `apiKey` changes.

### 3. Ordered Segment Plan

1. **F1 + F7 (Prompts & pricing constants)** — `src/imagegen.js`, `src/book.js`, `test_colouring_book.js`
   - Drop `name` from `buildPagePrompt`, `buildCoverPrompt`, and `generateImageBook`; add `IMAGE_PRICE_SOURCE`, `IMAGE_TOKENS_PER_IMAGE = 1120`, `IMAGE_PRICE_PER_MTOKENS = 30`, and derive `IMAGE_PRICE_USD`; update `:1925` and add canary + pricing tests.
   - Gate: `node test_colouring_book.js`
2. **F3 + F5 (Pure settled generation, resume & theme note)** — `src/imagegen.js`, `src/book.js`, `test_colouring_book.js`
   - Add `generateImagesSettled`, partial/`resume` handling in `generateImageBook`, `matched` return on both book generators, and `themeNoteText(matched, theme)`; add unit tests for partial, all-fail `:2720` preservation, `resume` non-rebilling, and `themeNoteText`.
   - Gate: `node test_colouring_book.js`
3. **F1 + F3 + F5 (UI wiring)** — `index.html`, `app.js`, `styles.css`
   - Add theme privacy hint and `data-role="theme-note"` (preserving the exact 8 IDs); wire `inFlight` lock, partial retry/vector-fallback controls, and `themeNoteText` in `app.js`.
   - Gate: `node test_colouring_book.js && node test_browser.js`
4. **F2 + F4 (Bundle freshness & zero-network check)** — `test_colouring_book.js`, `test_browser.js`, `smoke.html` (if vector mode lacks `fetchCalls`), `dist/colouring-book.html`
   - Redirect every test `build()` call to a temp path (or load committed `dist/colouring-book.html` directly in test 3); add working-tree freshness test; assert `report.fetchCalls === 0` in vector browser test; rebuild `dist/colouring-book.html`.
   - Gate: `node build.js && npm test`
5. **F6 (Release verification)** — `scripts/release.sh`, `README.md`
   - Create `scripts/release.sh` checking clean `master`, `npm test`, `sha256sum` pre/post-upload against `releases/latest/download/colouring-book.html`.
   - Gate: `bash -n scripts/release.sh && npm test`

### 4. Missed Design Defects

- **F2 vacuity**:
  1. `test_browser.js` test 3 currently calls `build()` and reads `dist/colouring-book.html`. Changing it to `build({ out: tmp })` stops testing the committed file. Instead, test 3 should read `dist/colouring-book.html` directly (injecting the harness in a temp copy without calling `build()`).
  2. Never add `node build.js` to `npm test` / `pretest`, or the freshness check will always compare against a freshly overwritten `dist/`.
- **F3 `<6`-page PDF & stale state risks**:
  1. Guard `buildPdf` in `generateImageBook` with an explicit invariant check: `images.length === PAGE_COUNT + 1 && images.every(Boolean)` before composing `cover` or `pages`, so a malformed `resume` cannot emit a truncated PDF or crash `jpegSize`.
  2. On partial failure in `app.js`, reset `downloadBtn.disabled = true` and `downloadBtn.onclick = null`; otherwise a previously generated book remains downloadable under the new failed state.
  3. Clear stored `partialResult` on any `input` event for `theme`, `name`, or `api-key`.
- **F4**: Verify `smoke.html` instruments `fetch` in default vector mode too; otherwise `report.fetchCalls` is `undefined` rather than `0`.

### Stage 6 Assertion Integrity Audit
- Only `test_colouring_book.js:1925` is modified, replacing an assertion that pinned an unintended PII leak with a stricter non-leakage + structural assertion.
- All `:2183`, `:2196`, `:2207`, and `:2720` rejection assertions remain intact and unmodified.
- No tests weakened, skipped, deleted, or broadened.

AUDIT: PASS - assertions intact, no weakening detected