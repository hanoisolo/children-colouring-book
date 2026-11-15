# Stage 6 removal justification — Phase 3

Baseline: `cb9945e` (last Phase 2 commit). Diff: `plans/stage6_test.diff`.

The scan reports 9 removed assertions and 5 removed test declarations. Every one
belongs to one of two deliberate moves in Phase 3 Segment 2: `buildPreviewPages`
became `generateBook` in the new `src/book.js`, and `app.js` stopped exporting
anything at all. Nothing was removed to make a red suite go green — the suite was
green at 136 tests before this justification was written, and every replacement
asserts at least as much as the original.

## Removed test declarations

1. `every export in app.js is imported by this suite`
   Replaced by three tests: `app.js is a pure controller with no exports`,
   `every export in src/book.js is imported by this suite`, and
   `every export in src/pdf.js is imported by this suite`. Export parity now
   covers nine modules instead of seven.

2. `app.js is importable without a DOM`
   Replaced by `app.js guards its DOM wiring behind a document check`, which
   pins the `typeof document !== 'undefined'` guard, the `DOMContentLoaded`
   listener, `URL.createObjectURL`, the `application/pdf` MIME type, and
   `link.download`. The old test asserted that four helpers were functions, but
   those helpers no longer live in `app.js`; the new test asserts the wiring that
   actually remains there.

3. `buildPreviewPages returns a cover plus five distinct pages`
   Replaced by `generateBook returns a cover plus five distinct pages and a PDF`,
   which additionally pins the title, theme, name, filename, and that `pdfBytes`
   is a `Uint8Array` of non-trivial length.

4. `buildPreviewPages is deterministic`
   Replaced by `generateBook is byte-identical across calls`, which compares the
   full PDF byte array rather than only the SVG strings. Strictly stronger.

5. `buildPreviewPages varies with the theme and the name`
   Replaced by `generateBook varies with the theme and the name`, which also
   asserts the filename differs between names.

## Removed assertions

6. `assert.deepEqual(extractExports(readSource('./app.js')), expected)`
   Replaced by `assert.deepEqual(extractExports(readSource('./app.js')), [])`.
   The expected list is now empty because `app.js` is a controller, not a
   library. The assertion is still exact.

7. `assert.equal(typeof validateInputs, 'function')`
   `validateInputs` moved to `src/book.js`. Its presence is now asserted by
   `every export in src/book.js is imported by this suite`, which checks the
   exact sorted export list and that the suite imports every name.

8. `assert.equal(typeof sanitiseFilename, 'function')`
   Same move, same replacement.

9. `assert.equal(typeof planBookPages, 'function')`
   Same move, same replacement.

10. `assert.equal(typeof buildPreviewPages, 'function')`
    `buildPreviewPages` no longer exists. `generateBook` replaces it and is
    covered by six dedicated tests.

11. `assert.equal(svgs.size, PAGE_COUNT + 1, 'two previews are identical')`
    Replaced by `bookDiversity` assertions in two tests:
    `generateBook keeps the pages pairwise distinct and varied` checks
    `distinctSvgs` and `distinctMotifSets` across five themes, and
    `bookDiversity reports duplicates it is given` checks the predicate directly
    on a known duplicate. The original only checked SVG distinctness; the
    replacement also checks motif-multiset diversity.

12. `assert.deepEqual(buildPreviewPages('space dinosaurs', 'Amara'), buildPreviewPages('space dinosaurs', 'Amara'))`
    Replaced by the byte-array comparison plus
    `assert.deepEqual(first.pages.map((page) => page.svg), second.pages.map((page) => page.svg))`.

13. `assert.notDeepEqual(base, buildPreviewPages('under the sea', 'Amara'))`
    Replaced by `assert.notEqual(base.cover.svg, otherTheme.cover.svg)`.

14. `assert.notDeepEqual(base, buildPreviewPages('space dinosaurs', 'Liam'))`
    Replaced by `assert.notEqual(base.cover.svg, otherName.cover.svg)` and
    `assert.notEqual(base.filename, otherName.filename)`.

## Net effect

- Assertions: 78 added, 9 removed.
- Test declarations: 29 added, 5 removed.
- Suite size: 117 tests at the Phase 2 baseline, 136 tests now, 0 skipped,
  0 todo.
