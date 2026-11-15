1. **Proceed to Phase 3:** Yes—Phase 2 is complete with no blocking gaps. All modules pass export parity, DOM selector parity, and the determinism guard (`node test_colouring_book.js`: 114 passed, 0 failed, 0 skipped, 330 assertions). Before starting Phase 3, refresh `plans/mutation_baseline.json` from the 54.0% snapshot to the latest 72.0% counts (288 killed, 112 survived) so the ratchet holds, and sync `plans/removal_justification.md` from the earlier 107-test pass to the final 114-test state.

2. **End-to-end `fill: true` coverage:** Yes—add `fill: true` to a few closed foreground shapes in `src/motifs.js` at Phase 3 Segment 1 (for example `rocket` window, `house` roof and door, or `car` wheels reordered after the chassis line). A serialiser unit test cannot catch a missing white fill color (`1 1 1 rg`) or painter's-order occlusion in composed pages, whereas real filled shapes exercise `B` versus `S` end to end without breaking motif tests.

3. **72.0% mutation score:** Accept the 72.0% score; do not pin curve-sampling segment counts or unexported layout constants. Only `src/cover.js` (26 killed, 31 survived) merits 2–3 cheap structural checks alongside Phase 3: vertical ordering (`title` < `name` < `subtitle` < `motifs`), the four corner ornaments, and `wrapChars` space trimming.

4. **Uncovered Phase 3 (`src/pdf.js` & `src/book.js`) risks:**
   - **Graphics state parity:** Emit `1 J 1 j` (round caps/joins, critical for `src/lettering.js` loops with `closed: false`), set `1 1 1 rg` and `0 0 0 RG` so `B` paints white rather than PDF's default black, and guard against `closed: false, fill: true` (PDF `B` implicitly closes open paths).
   - **Binary PDF structure:** Compute `xref` offsets in exact bytes via `Uint8Array` (avoiding JS `.length` and Node `Buffer`), emit strict 20-byte `xref` rows, and encode non-ASCII names (`Zoë`, `José`) in `/Info` via UTF-16BE hex or PDFDocEncoding rather than raw UTF-8 literals.
   - **IR & migration hygiene:** Keep Y-flip pure without mutating shared IR points, and update export-parity and determinism tests when `validateInputs` and `sanitiseFilename` move to `src/book.js`.

**Stage 6 Assertion Integrity Audit:** Against `fc5be24` (`plans/stage6_test.diff`), no tests were skipped, deleted to fix failures, or weakened; the 3 removed tests and 4 removed assertions reflect the `buildPlaceholderPages` to `planBookPages` upgrade and were replaced with stricter bounds and theme checks (194 assertions added, 114/114 tests passing).

AUDIT: PASS - assertions intact, no weakening detected