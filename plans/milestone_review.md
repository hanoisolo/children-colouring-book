1. **Phase 1 readiness:** Yes—proceed to Phase 2; no gap blocks it. All 57 tests pass (0 failed, 0 skipped), DOM selector parity and export parity are enforced, and `src/rng.js` and `src/themes.js` achieved 100% mutation kill rates (28/28 and 21/21; 90.0% JS-only). The `index.html`/`styles.css` survivors are textual-mutator noise (`< -> >=` on tags, CSS literals).

2. **Fake-DOM shim vs static parity + Phase 3 E2E:** Do **not** add a fake-DOM shim in Phase 2. Custom DOM mocks drift from real browser behaviour (SVG rendering, layout, Blob downloads) and add maintenance cost disproportionate to eight thin DOM lines. Keep `app.js` DOM wiring minimal, place SVG/card assembly in pure headless-tested functions, and rely on static selector parity plus Phase 3 end-to-end checks.

3. **Moving `validateInputs` and `sanitiseFilename` to `src/book.js`:** Keep the move at Phase 3 Segment 2. Phase 2 modules (`motifs`, lettering, `page.js`, `cover.js`) operate on already-validated strings and do not need validation or `.pdf` filenames, so moving earlier creates unnecessary churn. When moving in Phase 3, either re-export them from `app.js` or update `test_colouring_book.js` imports and `app.js` export-parity checks in the same commit to avoid duplication.

4. **Uncovered Phase 2 SVG/polyline risks:**
   - **Shared IR and Y-axis:** Curve flattening or coordinate drift breaks SVG/PDF parity. Emit one canonical polyline IR in top-down A4 units before serialisation, flipping Y only in the PDF emitter.
   - **Occlusion and stroke joins:** SVG hides overlaps using `fill="white"`, whereas stroke-only PDF polylines expose "X-ray" intersections; track `closed`/`fill` per polyline (`B` vs `S` in PDF) and use `round` caps/joins to avoid acute miter spikes.
   - **Accented glyphs and 20-char fit:** `validateInputs` accepts `Zoë` and `José` up to 20 characters; vector lettering must handle diacritics (e.g., NFD base + accent strokes) and scale long names inside margins.

**Stage 6 Assertion Integrity Audit:** Reviewed `plans/stage6_test.diff`, `plans/stage6_scan.md`, and `plans/mutation_report.md`: 140 assertions and 57 tests added, 0 removed, skipped, weakened, or broadened.

AUDIT: PASS - assertions intact, no weakening detected