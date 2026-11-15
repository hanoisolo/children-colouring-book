# Removal justification — audit fix pass (baseline `08b7e24`)

Four assertions and one test declaration were removed. Each is itemised below.
No test was deleted, skipped, or broadened to make the suite pass; the suite
went from 267 to 284 tests.

## 1. `assert.match(prompt, /page 3 of a book for Amara/)`

**File:** `test_colouring_book.js`, `buildPagePrompt names the theme, the motifs and the page`

This assertion pinned a privacy defect. `buildPagePrompt` interpolated the
child's name into the prompt sent to Gemini, so the test asserted that a child's
first name reached a third party on every interior page. The name is drawn as
vector strokes by `src/lettering.js` and never needed to be transmitted.

**Replaced by** `assert.match(prompt, /page 3 of the book/)` in the same test,
plus two new tests that assert the opposite of the old behaviour:

- `the prompt builders take no name argument at all` — structural: a name handed
  in anyway is ignored rather than interpolated.
- `the child's name never reaches the image service` — end-to-end: with a
  stubbed fetch, the URL, headers and serialized body contain no case-folded and
  no NFD-normalized variant of `Xqzzy`, `Zoë` or `José`.

Both were verified to fail when the leak is reintroduced.

## 2. `test('buildCoverPrompt reserves the top third and forbids the name', ...)`

**File:** `test_colouring_book.js`

Renamed to `buildCoverPrompt reserves the top third and forbids all text`. The
scanner reads a renamed declaration as one removal plus one addition. The test
still exists and still asserts the layout contract (`lower two thirds`, `top
third completely empty white space`).

## 3. `assert.match(prompt, /Do not write the name Zoë or any other text/)`

**File:** `test_colouring_book.js`, same test as item 2

The cover prompt used to forbid the name by naming it, which transmitted it.
**Replaced by** `assert.match(prompt, /Do not write any text, lettering, words or
numbers/)` — the same layout intent, achieved without sending anything about the
child.

## 4. `assert.match(prompts[index], new RegExp(\`page ${index} of a book for Amara\`))`

**File:** `test_colouring_book.js`, `generateImageBook asks for the cover first, then one prompt per page`

Same defect as item 1, asserted at the request level. **Replaced by**
`new RegExp(\`page ${index} of the book\`)`. The test still asserts that six
prompts are sent, that the cover is first, and that each interior prompt carries
its own page number.

## 5. `assert.ok(result.modules >= 10, ...)`

**File:** `test_colouring_book.js`, `the built file is self-contained and parses`

Removed only because `buildToTemp()` changed its return shape from a string to
`{ html, modules }` when the suite stopped writing `dist/`. This was a genuine
loss of coverage, so it was **restored** rather than justified: the test now
reads `const { html: out, modules } = buildToTemp()` and asserts
`modules >= 10` exactly as before.

## Not removed

Every rejection assertion that pins the image pipeline's failure contract is
intact and unmodified: `generateImages gives up after the retry budget`,
`generateImages does not retry a non-429 failure`, `generateImages rejects an
empty prompt list`, and `generateImageBook surfaces an API failure`. The new
partial-failure path was added alongside them, not in place of them.

## Verdict

`AUDIT: PASS` — four removals are the deliberate retirement of assertions that
pinned a privacy defect, each replaced by a stricter assertion plus a new
end-to-end canary; the fifth was a real coverage loss and was restored rather
than waived.
