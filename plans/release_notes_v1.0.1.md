A privacy fix and four shipping-integrity fixes. Same download, same one-file app.

**Download `colouring-book.html` below and double-click it.** One file, no install, no server, no terminal. It runs from disk and works offline.

## What changed

### The child's name no longer reaches the image service

In v1.0.0 the name was interpolated into every Gemini prompt: the cover asked the model not to write it, and each interior page said "page N of a book for <name>". That sent a child's first name to Google in all six requests.

The prompt builders now take no name parameter at all, so there is no argument to leak it through. The name is drawn as vector strokes on the cover, exactly as before. Two tests hold this: a structural one, and an end-to-end canary asserting that `Xqzzy`, `Zoë` and `José` appear in no URL, header or request body, including case-folded and NFD-normalized forms.

The theme still goes to the model, so the form now warns against typing personal details into it.

### A partial failure no longer discards pictures you paid for

If request 4 of 6 failed, v1.0.0 threw away the three images that had already succeeded, after billing you for them. The app now keeps them and offers a choice: retry only the missing pages (about $0.03 each), or take the free offline vector book. A retry never re-bills an image you already own.

### The shipped file is now checked, not trusted

`npm test` compares `dist/colouring-book.html` byte-for-byte against a fresh build. Previously the test suite rebuilt the bundle as a side effect, so a stale committed file could never fail anything.

### Smaller fixes

- An unmatched theme now says so instead of silently falling back to the general motif set.
- Vector mode asserts zero network requests, with `fetch` instrumented in both modes.
- The quoted price is derived from dated constants rather than typed twice.
- `scripts/release.sh` verifies the published asset's SHA-256 against `dist/`.

## Verification

- 284 unit tests and 3 headless-browser tests, 0 failures, 0 skipped.
- Stage 6 assertion scan: `SCAN: PASS` — 51 assertions added, 4 removed and justified.
- Mutation gate: `MUTATION: PASS` — 63 mutants, 60 killed, 0 survived.
- SHA-256 of the attached file: `43fd42e4e1c3d44b4294da3061bec762c7742837b6beb303853b8a504e22edda`

## Notes

- The name on the cover is always drawn as vector strokes, never asked of the image model, because models misspell names.
- Image mode uses `gemini-3.1-flash-lite-image` at $0.0336 per image, the cheapest Gemini image model.
- Zero dependencies.
