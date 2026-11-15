# Children's Colouring Book

A personalised colouring book, generated in the browser. Type a theme and a
child's name, and the app draws a six-page A4 colouring book and hands it to you
as a PDF.

- **Theme** — `space dinosaurs`, `under the sea`, `fairy garden`, anything. The
  theme picks which motifs appear.
- **Name** — up to 20 characters. It goes on the cover, drawn as thick vector
  strokes a child can colour in.

No backend, no network calls, no third-party libraries, no build step.

## Running it

```
npm start
```

Then open <http://localhost:8000>.

Opening `index.html` straight from disk does **not** work, and the page now says
so instead of failing silently. The app is ES modules, and a browser refuses to
fetch a module from a `file://` page because the origin is opaque — the console
shows a CORS error and nothing generates. `serve.js` is a small zero-dependency
static server that exists only to avoid that.

There is no bundler and no `npm install`. `index.html` loads `app.js` as an ES
module, and `app.js` imports the rest of `src/` directly.

## Running the tests

```
node test_colouring_book.js
```

151 tests, 454 assertions, no dependencies. The suite runs offline in Node and
covers the whole pipeline headlessly — the same functions the browser calls.

## How it works

Two strings go in; a `Uint8Array` PDF comes out. Everything between is pure and
deterministic, so the same theme and name always produce a byte-identical book.

| Module | Role |
| :--- | :--- |
| `src/rng.js` | FNV-1a hash and a seeded PRNG. All randomness is derived from the inputs, never from the clock. |
| `src/themes.js` | Normalises the theme, strips stopwords, singularises plurals, and maps keywords onto a 25-motif vocabulary. Falls back to the full set when nothing matches. |
| `src/motifs.js` | 25 procedural generators — star, planet, rocket, moon, dinosaur, fish, shell, wave, flower, tree, butterfly, cloud, sun, house, balloon, cat, dog, car, mountain, rainbow, bird, boat, robot, cupcake, snowflake. Each emits polylines in a `0..1` box. |
| `src/lettering.js` | A single-stroke vector alphabet. Accented letters resolve by NFD decomposition into a base glyph plus accent strokes, so `Zoë` and `José` work. |
| `src/page.js` | Interior page composition: frame, ground line, and 3–7 motifs on a jittered grid that never overlap. Owns the SVG serialiser. |
| `src/cover.js` | Cover composition. The name is uppercased, fitted to at most four lines, and never shrinks below a 60 pt cap height. |
| `src/pdf.js` | A PDF 1.4 writer. Assembles the document as byte chunks so xref offsets come from real byte counts, not string lengths. |
| `src/book.js` | The orchestrator. Validates input, plans the pages, composes them, and refuses to return a book whose pages are not pairwise distinct. |
| `app.js` | The DOM controller. Wiring only — every decision worth testing lives below it. |

### The polyline IR

`src/page.js` and `src/cover.js` emit one intermediate representation: polylines
in top-down A4 user units, each carrying `closed`, `fill` and a stroke weight.
The SVG preview and the PDF both consume that same IR. The Y axis is flipped in
exactly one place, `src/pdf.js`, so the preview and the print cannot drift apart.

### Why the PDF writer is hand-rolled

Two details are easy to get wrong and both are load-bearing:

1. **Byte offsets.** The xref table stores the byte offset of every object.
   Mixing JS string lengths with multi-byte bytes shifts every subsequent
   offset, so the document is assembled as byte chunks and offsets accumulate
   from `chunk.length`.
2. **Fill colour.** PDF's default fill is black, so a `B` operator without an
   explicit `1 1 1 rg` paints a filled shape solid black. The fill colour is set
   to white once per page and never changed.

`B` also implicitly closes an open path, which would silently change the shape
of a `fill: true, closed: false` polyline. Both writers therefore close a path
whenever it is closed *or* filled.

## Constraints

- Deterministic: no `Math.random()`, no `Date.now()`, no locale-dependent
  sorting. The same inputs give a byte-identical PDF.
- Pure black strokes on white, at least 4 pt wide at A4 scale.
- No `eval`, no `new Function`, no dynamic `import()`.
- Zero dependencies, and no test opens a browser, binds a port or makes a
  request.

## Project layout

```
index.html              the app
styles.css              layout and print stylesheet
app.js                  DOM controller
serve.js                zero-dependency static server for local development
src/                    the pipeline, in dependency order
test_colouring_book.js  the whole suite
plans/                  roadmap, milestone reviews, Stage 6 evidence
AGENTS.md               build rules and architectural constraints
```

## Licence

No licence is granted. All rights reserved.
