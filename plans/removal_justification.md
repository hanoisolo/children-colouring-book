# Stage 6 removal justification — Phase 2

Baseline: `fc5be24` (last Phase 1 commit). Diff: `plans/stage6_test.diff`.

The scan reports 4 removed assertions and 3 removed test declarations. Every one
of them belongs to the `buildPlaceholderPages` helper, which Phase 2 Segment 2
replaced with `planBookPages`. The helper was a Phase 1 placeholder that assigned
1-3 motifs per page; the roadmap requires interior pages to carry 3-7 motifs with
at least one drawn from the theme, so the helper's contract changed and its name
changed with it. Nothing was removed to make a red suite go green: the suite was
green at 107 tests before this justification was written, and the replacements
assert strictly more than the originals.

## Removed test declarations

1. `buildPlaceholderPages is deterministic for the same input`
   Replaced by `planBookPages is deterministic for the same input`. Same
   assertion, same `PAGE_COUNT` check, new name.

2. `buildPlaceholderPages varies with the name`
   Replaced by `planBookPages varies with the name`. Same assertion.

3. `buildPlaceholderPages gives each page a bounded motif subset`
   Replaced by `planBookPages gives each page between three and seven distinct
   motifs`, plus two new tests that did not exist before:
   `planBookPages puts at least one theme motif on every page` and
   `planBookPages still fills every page when the theme matches nothing`.

## Removed assertions

4. `assert.ok(page.motifs.length >= 1 && page.motifs.length <= 3, ...)`
   Replaced by `assert.ok(page.motifs.length >= MIN_PAGE_MOTIFS &&
   page.motifs.length <= MAX_PAGE_MOTIFS, ...)`, i.e. 3-7. The old bound accepted
   1 and 2 motifs, which the roadmap forbids. This is a tightening.

5. `assert.ok(book.motifs.includes(motif), ...)` — every motif had to come from
   the theme's own list.
   Replaced by `assert.ok(MOTIF_NAMES.includes(motif), ...)` — every motif must be
   drawable. The original property is deliberately relaxed because a page now
   pads from the full vocabulary to reach the 3-motif floor, which a theme with
   two matched motifs could not otherwise satisfy. The property that actually
   matters is asserted separately and more precisely by
   `planBookPages puts at least one theme motif on every page`, which checks
   `book.motifs.includes(motif)` for at least one motif on every page across
   three themes. Net coverage is higher, not lower.

6. `assert.ok(signatures.size >= 2, 'every placeholder page is identical')`
   Replaced by the identical assertion with the message `'every page is
   identical'`. The scan sees a removal only because the message string changed.

7. `assert.equal(typeof buildPlaceholderPages, 'function')`
   Replaced by `assert.equal(typeof planBookPages, 'function')` and
   `assert.equal(typeof buildPreviewPages, 'function')`. One assertion became
   two.

## Net effect

- Assertions: 172 added, 4 removed.
- Test declarations: 53 added, 3 removed.
- Suite size: 57 tests at the Phase 1 baseline, 107 tests now, 0 skipped,
  0 todo.
