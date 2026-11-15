## Architect Context Packet
- Mode & Tier: plan (Tier 2 — focused upgrade, existing repo)
- Project & Stack: children-colouring-book | Web UI (HTML/CSS/JS), vanilla ES2020 modules, zero dependencies | Node v26.12.1, `node:test` + `node:assert/strict`
- Git Baseline: 08b7e24 | Working tree: CLEAN
- Baseline Test Status: `npm test` -> 267 unit + 3 browser passed, 0 failed, 0 skipped
- Canonical File Inventory: see the auto-generated inventory appended below
- Mandatory Anti-Drift Invariants: exactly eight contract IDs (`#theme-input`, `#name-input`, `#generate-btn`, `#status`, `#error`, `#preview`, `#download-btn`, `#book-title`); image-mode controls use `data-role` only (`api-key`, `cost-note`, and now `theme-note`); every `export` in `src/` imported and exercised by the suite; `app.js` exports nothing; vector mode byte-identical for the same `(theme, name)`.

## Task

An external audit (brief-only — it could not read the repo) raised 13 findings. I verified all 13 against the code and by execution. Seven are real; six are already covered by existing tests. I need you to validate my proposed fix design and return an ordered segment plan.

## Verified findings to fix

### F1 (was S2) — the child's name is transmitted to Google in all six requests. CRITICAL.

Confirmed by execution. `src/imagegen.js` `buildPagePrompt` emits `This is page N of a book for <name>.` and `buildCoverPrompt` emits `Do not write the name <name> or any other text.` A probe with name `Xqzzy` found the name in the request body of all 6 requests (0 in URL, 0 in headers). `test_colouring_book.js:1925` pins the leak (`/page 3 of a book for Amara/`), so it is a tested contract.

The name is drawn as vector strokes by `src/lettering.js` and never needs to reach the model.

Proposed fix:
- `buildPagePrompt({ theme, pageIndex, motifs })` — drop `name` entirely.
- `buildCoverPrompt({ theme })` — drop `name`; replace the name clause with `Do not write any text, lettering, words or numbers.`
- `generateImageBook` stops passing `name` to either builder.
- New canary test: name `Xqzzy` plus accented `Zoë` / `José`; assert URL, headers and serialized body contain no case-folded and no NFD-normalized variant.
- The theme still reaches the model, so add a UI hint next to the theme field warning against personal details.

Question for you: the existing test at `:1925` asserts the name IS in the prompt. Removing the name necessarily modifies that assertion. Is that an acceptable, documented assertion change under a 100% non-regression gate, or should the test be rewritten to assert the opposite? I believe rewriting is correct — the old assertion pinned a defect — but I want your ruling recorded.

### F2 (was S1) — the bundle-freshness check is vacuous. HIGH.

Confirmed by experiment. `test_colouring_book.js:2862` and `test_browser.js:161` both call `build()`, which writes `dist/colouring-book.html`. The suite regenerates the artifact it is supposed to verify. I edited `src/book.js`, ran the unit suite, and got 267/267 green with `dist/` silently modified in the working tree. Commit only the source and the shipped file is stale with nothing failing.

Proposed fix:
- Every test that needs a bundle builds to a temp path via `build({ out: <absolute temp path> })` (`build` already accepts `out` and `resolve(root, out)` passes absolute paths through).
- New test: build to temp, compare bytes against the committed `dist/colouring-book.html`. This is only meaningful once the other tests stop rewriting dist.
- `test_browser.js` third test builds to temp and loads that file, so it still proves the shipped artifact's shape without mutating the repo.

Question: should the freshness test compare against the working-tree file or against `git show HEAD:dist/colouring-book.html`? Working-tree is simpler and fails correctly when a developer forgets to rebuild; the git form additionally catches "rebuilt but not committed". I lean working-tree plus a note, because the git form makes the suite fail on any legitimate uncommitted source edit.

### F3 (was S3) — partial image failure discards paid images. HIGH.

Confirmed by execution: failing request 4 of 6 yields `REJECTED: The image service is unavailable (500)` after 6 billed requests. It does not silently fall back to vector art (good), but three paid images are thrown away.

Hard constraint: existing tests pin `generateImages` rejecting (`:2183` retry budget, `:2196` non-429, `:2207` empty list) and `generateImageBook` rejecting on total failure (`:2720`, 401 on all six). Those must not change.

Proposed fix:
- Keep `generateImages` throwing — it stays the all-or-nothing primitive.
- Add `generateImagesSettled` returning `{ images: Array<image|null>, errors: Array<Error|null> }`, sharing the same worker pool.
- `generateImageBook`: if zero images succeeded, throw the first error (preserves `:2720`). If at least one succeeded, return a partial result `{ complete: false, succeeded, total, failures, costUsd, retryPrompts, retryIndexes }` with no `pdfBytes`.
- `generateImageBook` accepts `{ resume: partialResult }` to reuse already-generated images and request only the missing prompts, so a retry does not re-bill the successes.
- `app.js` shows the count and offers retry-or-vector. Never silently substitutes vector art.
- Add an explicit in-flight guard in `app.js` so a double submit cannot launch two batches.

Question: is `resume` the right shape, or would you carry the successful images in `app.js` and pass them back in? I prefer `resume` because it keeps the merge logic in the tested pure layer.

### F4 (was S10) — no zero-network assertion in vector mode. MEDIUM.

`smoke.html` already counts `fetch` calls and reports `fetchCalls`; the image test asserts 6. The vector test asserts nothing about it. `index.html` and `styles.css` carry no remote refs (verified). Fix: assert `fetchCalls === 0` in the vector browser test.

### F5 (was S11) — silent theme fallback. MEDIUM.

`planBookPages` computes `matched` and nothing surfaces it. A typo'd theme silently yields unrelated motifs. Fix: return `matched` from `generateBook` and `generateImageBook`; add a pure `themeNoteText(matched, theme)` in `src/book.js`; add a `data-role="theme-note"` paragraph in `index.html` (does not touch the eight-id contract); wire it in `app.js`.

### F6 (was S5) — no release verification. MEDIUM.

`README.md:60` documents manual release steps. Fix: `scripts/release.sh` that asserts a clean tree on `master`, runs `npm test`, publishes `dist/colouring-book.html` with its sha256, then downloads `releases/latest/download/colouring-book.html` and verifies the hash matches.

### F7 (was S4) — pricing has no dated source. LOW.

`IMAGE_PRICE_USD = 0.0336` exists but the 1120-token figure lives only in a comment. Fix: add `IMAGE_PRICE_SOURCE` (dated URL), `IMAGE_TOKENS_PER_IMAGE = 1120`, `IMAGE_PRICE_PER_MTOKENS = 30`, and derive `IMAGE_PRICE_USD` from them so the UI estimate and the constants share one source of truth. Add a test pinning the derivation.

## Findings I verified as already covered — do not spend segments on these

S6 (xref offsets, `/Length`, `q`/`Q`, `B`/`S`/`f`, white fill, UTF-16BE hex + paren escaping, Y flip), S7 (EXIF-thumbnail `jpegSize`, non-square `fitImageRect`, base64 padding, concurrency clamp, key-in-error), S9 (determinism grep), S13 (reserved filenames, lone surrogates). All have existing tests at the line numbers I can cite. S8 (print, mobile, accessibility) needs real hardware and is out of scope.

## What I want from you

1. A ruling on the F1 assertion change and the F2 comparison target.
2. A ruling on the F3 `resume` shape.
3. An ordered segment plan, 1-3 files per segment, each ending in a plain CLI gate runnable in Git Bash.
4. Any defect in the above design I have missed — particularly any way the F2 change could make the freshness test pass vacuously, and any way the F3 partial path could emit a PDF with fewer than six pages.

Answer only these four points, under 700 words. Do not restate the findings back to me.
