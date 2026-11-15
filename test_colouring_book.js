/**
 * Headless suite for the colouring book.
 *
 * Runs offline under `node test_colouring_book.js`. No browser, no network, no
 * dialogs. Modules are imported directly, exactly as `index.html` loads them.
 *
 * Phase 1 covers determinism, theme interpretation, input validation, filename
 * sanitisation, and the Section 8 anti-drift invariants (DOM selector parity
 * and export parity).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  hashString,
  makeRng,
  deriveSeed,
  randInt,
  pick,
  pickDistinct,
  shuffle,
} from './src/rng.js';

import {
  STOPWORDS,
  MOTIF_VOCABULARY,
  FALLBACK_MOTIFS,
  MOTIF_KEYWORDS,
  normaliseTheme,
  singularCandidates,
  singularise,
  tokeniseTheme,
  motifsForTheme,
  isKnownMotif,
} from './src/themes.js';

import {
  MAX_THEME_LENGTH,
  MAX_NAME_LENGTH,
  PAGE_COUNT,
  MIN_DISTINCT_PAGE_MOTIF_SETS,
  validateInputs,
  sanitiseFilename,
  planBookPages,
  bookDiversity,
  generateBook,
} from './src/book.js';

import {
  PDF_VERSION,
  MEDIA_BOX,
  MIN_STROKE_WIDTH,
  pdfTextString,
  pageContentStream,
  buildPdf,
} from './src/pdf.js';

import './app.js';

import { resolveRequestPath } from './serve.js';

import {
  MAIN_WEIGHT,
  DETAIL_WEIGHT,
  stroke,
  polygon,
  circle,
  ellipse,
  arc,
  computeBounds,
  MOTIF_NAMES,
  drawMotif,
} from './src/motifs.js';

import {
  DEFAULT_LETTER_SPACING,
  hasGlyph,
  measureText,
  layoutText,
  fitText,
} from './src/lettering.js';

import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  FRAME_INSET,
  INNER_FRAME_INSET,
  GROUND_Y,
  MIN_PAGE_MOTIFS,
  MAX_PAGE_MOTIFS,
  STROKE_BASE,
  STROKE_FLOOR,
  strokeWidthFor,
  toPagePolylines,
  polylineToPathData,
  polylinesToSvg,
  pageToSvg,
  composePage,
} from './src/page.js';

import {
  COVER_TITLE,
  MIN_NAME_SIZE,
  MAX_NAME_SIZE,
  MAX_NAME_LINES,
  fitName,
  composeCover,
  coverToSvg,
} from './src/cover.js';

const readSource = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const CONTRACT_IDS = [
  'theme-input',
  'name-input',
  'generate-btn',
  'status',
  'error',
  'preview',
  'download-btn',
  'book-title',
];

const REQUIRED_MOTIFS = [
  'star',
  'planet',
  'rocket',
  'moon',
  'dinosaur',
  'fish',
  'shell',
  'wave',
  'flower',
  'tree',
  'butterfly',
  'cloud',
  'sun',
  'house',
  'balloon',
  'cat',
  'dog',
  'car',
  'mountain',
  'rainbow',
];

/* ------------------------------------------------------------------ */
/* Determinism: hashString                                             */
/* ------------------------------------------------------------------ */

test('hashString returns an unsigned 32-bit integer for varied inputs', () => {
  const inputs = ['', 'a', 'amara', 'space dinosaurs', 'under the sea', 'Zoë', 'x'.repeat(500)];
  for (const input of inputs) {
    const value = hashString(input);
    assert.ok(Number.isInteger(value), `not an integer for ${JSON.stringify(input)}`);
    assert.ok(value >= 0, `negative hash for ${JSON.stringify(input)}`);
    assert.ok(value <= 0xffffffff, `hash exceeds 32 bits for ${JSON.stringify(input)}`);
  }
});

test('hashString is stable across repeated calls', () => {
  assert.equal(hashString('amara'), hashString('amara'));
  assert.equal(hashString('space dinosaurs'), hashString('space dinosaurs'));
});

test('hashString distinguishes different inputs', () => {
  const inputs = Array.from({ length: 20 }, (_, i) => `theme-${i}`);
  const hashes = new Set(inputs.map(hashString));
  assert.equal(hashes.size, inputs.length);
});

test('hashString rejects non-string input', () => {
  assert.throws(() => hashString(42), TypeError);
  assert.throws(() => hashString(null), TypeError);
  assert.throws(() => hashString(undefined), TypeError);
});

test('hashString pins known values so the hash cannot drift', () => {
  assert.equal(hashString(''), 2166136261);
  assert.equal(hashString('amara'), 3817335319);
  assert.equal(hashString('Amara'), 2302892983);
  assert.equal(hashString('space dinosaurs'), 1946144381);
  assert.equal(hashString('under the sea'), 1313218653);
});

/* ------------------------------------------------------------------ */
/* Determinism: makeRng and deriveSeed                                 */
/* ------------------------------------------------------------------ */

test('makeRng produces identical sequences for identical seeds', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('makeRng diverges within ten draws for different seeds', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test('makeRng stays within [0, 1)', () => {
  const rng = makeRng(12345);
  const draws = Array.from({ length: 1000 }, () => rng());
  assert.ok(draws.every((value) => value >= 0), 'a draw was negative');
  assert.ok(draws.every((value) => value < 1), 'a draw reached 1');
  assert.ok(Math.max(...draws) > 0.9, 'the stream never approached 1');
  assert.ok(Math.min(...draws) < 0.1, 'the stream never approached 0');
});

test('makeRng rejects a non-integer seed', () => {
  assert.throws(() => makeRng(1.5), TypeError);
  assert.throws(() => makeRng('42'), TypeError);
});

test('makeRng pins its output sequence so the stream cannot drift', () => {
  const rng = makeRng(42);
  assert.deepEqual([rng(), rng(), rng()], [
    0.6011037519201636,
    0.44829055899754167,
    0.8524657934904099,
  ]);
});

test('deriveSeed is deterministic and index-sensitive', () => {
  assert.equal(deriveSeed(3817335319, 0), deriveSeed(3817335319, 0));
  assert.equal(deriveSeed(3817335319, 0), 2685912172);
  const seeds = new Set(Array.from({ length: 10 }, (_, i) => deriveSeed(3817335319, i)));
  assert.equal(seeds.size, 10);
});

/* ------------------------------------------------------------------ */
/* Seeded helpers                                                      */
/* ------------------------------------------------------------------ */

test('randInt stays within inclusive bounds', () => {
  const rng = makeRng(99);
  for (let i = 0; i < 200; i += 1) {
    const value = randInt(rng, 3, 7);
    assert.ok(Number.isInteger(value), 'randInt returned a non-integer');
    assert.ok(value >= 3 && value <= 7, `randInt escaped its bounds: ${value}`);
  }
});

test('randInt rejects reversed bounds', () => {
  assert.throws(() => randInt(makeRng(1), 7, 3), {
    name: 'RangeError',
    message: 'randInt bounds reversed: 7 > 3',
  });
});

test('randInt rejects non-integer bounds', () => {
  assert.throws(() => randInt(makeRng(1), 1.5, 3), TypeError);
  assert.throws(() => randInt(makeRng(1), 1, 3.5), TypeError);
});

test('pick returns a member of the pool', () => {
  const pool = ['a', 'b', 'c'];
  const rng = makeRng(5);
  for (let i = 0; i < 50; i += 1) {
    assert.ok(pool.includes(pick(rng, pool)));
  }
  assert.throws(() => pick(rng, []), RangeError);
});

test('pickDistinct returns distinct members and clamps to the pool size', () => {
  const out = pickDistinct(makeRng(3), ['a', 'b', 'c', 'd'], 3);
  assert.equal(out.length, 3);
  assert.equal(new Set(out).size, 3);
  assert.equal(pickDistinct(makeRng(3), ['a', 'b'], 5).length, 2);
});

test('pickDistinct pins its output for a known seed', () => {
  assert.deepEqual(pickDistinct(makeRng(3), ['a', 'b', 'c', 'd'], 3), ['c', 'b', 'a']);
});

test('pickDistinct rejects a non-integer count and accepts zero', () => {
  assert.throws(() => pickDistinct(makeRng(1), ['a', 'b'], 1.5), TypeError);
  assert.deepEqual(pickDistinct(makeRng(1), ['a', 'b'], 0), []);
});

test('shuffle is a permutation and does not mutate the input', () => {
  const input = ['a', 'b', 'c', 'd', 'e'];
  const out = shuffle(makeRng(7), input);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.deepEqual(input, ['a', 'b', 'c', 'd', 'e']);
});

test('shuffle pins its output for a known seed', () => {
  assert.deepEqual(shuffle(makeRng(7), ['a', 'b', 'c', 'd', 'e']), ['d', 'b', 'c', 'e', 'a']);
});

/* ------------------------------------------------------------------ */
/* Theme interpretation                                                */
/* ------------------------------------------------------------------ */

test('normaliseTheme trims, lowercases and collapses whitespace', () => {
  assert.equal(normaliseTheme('  Space   Dinosaurs  '), 'space dinosaurs');
  assert.equal(normaliseTheme('UNDER\tTHE\nSEA'), 'under the sea');
});

test('normaliseTheme rejects non-string input', () => {
  assert.throws(() => normaliseTheme(7), TypeError);
});

test('tokeniseTheme drops stopwords', () => {
  const tokens = tokeniseTheme('the land of the dinosaurs and a moon');
  assert.ok(!tokens.includes('the'), 'stopword "the" survived');
  assert.ok(!tokens.includes('of'), 'stopword "of" survived');
  assert.ok(!tokens.includes('and'), 'stopword "and" survived');
  assert.ok(!tokens.includes('a'), 'stopword "a" survived');
  assert.deepEqual(tokens, ['land', 'dinosaur', 'moon']);
  assert.equal(STOPWORDS.length, 10);
});

test('tokeniseTheme singularises plurals', () => {
  assert.deepEqual(tokeniseTheme('houses fishes butterflies stars'), [
    'house',
    'fish',
    'butterfly',
    'star',
  ]);
});

test('singularCandidates offers the plural ladder', () => {
  assert.deepEqual(singularCandidates('butterflies'), ['butterflies', 'butterfly']);
  assert.deepEqual(singularCandidates('houses'), ['houses', 'hous', 'house']);
  assert.deepEqual(singularCandidates('glass'), ['glass']);
  assert.equal(singularise('houses'), 'house');
  assert.equal(singularise('fishes'), 'fish');
  assert.equal(singularise('unicorns'), 'unicorn');
});

test('singularCandidates handles short plurals', () => {
  assert.deepEqual(singularCandidates('flies'), ['flies', 'fly']);
  assert.deepEqual(singularCandidates('goes'), ['goes', 'go', 'goe']);
  assert.deepEqual(singularCandidates('cats'), ['cats', 'cat']);
});

test('tokeniseTheme treats digits as word characters', () => {
  assert.deepEqual(tokeniseTheme('space2dinosaurs'), ['space2dinosaur']);
});

test('MOTIF_VOCABULARY has at least twenty motifs and covers the required set', () => {
  assert.ok(MOTIF_VOCABULARY.length >= 20, `vocabulary has only ${MOTIF_VOCABULARY.length} motifs`);
  for (const motif of REQUIRED_MOTIFS) {
    assert.ok(MOTIF_VOCABULARY.includes(motif), `vocabulary is missing ${motif}`);
  }
  assert.equal(new Set(MOTIF_VOCABULARY).size, MOTIF_VOCABULARY.length);
});

test('every vocabulary motif is reachable from a keyword or the fallback', () => {
  const reachable = new Set(FALLBACK_MOTIFS);
  for (const motifs of Object.values(MOTIF_KEYWORDS)) {
    for (const motif of motifs) {
      reachable.add(motif);
    }
  }
  assert.deepEqual([...reachable].sort(), [...MOTIF_VOCABULARY].sort());
});

test('every keyword maps only to known motifs', () => {
  for (const [keyword, motifs] of Object.entries(MOTIF_KEYWORDS)) {
    assert.ok(motifs.length > 0, `keyword ${keyword} maps to nothing`);
    for (const motif of motifs) {
      assert.ok(MOTIF_VOCABULARY.includes(motif), `keyword ${keyword} maps to unknown motif ${motif}`);
    }
  }
});

test('motifsForTheme resolves a multi-word theme', () => {
  const result = motifsForTheme('space dinosaurs');
  assert.equal(result.matched, true);
  assert.deepEqual(result.tokens, ['space', 'dinosaur']);
  assert.deepEqual(result.motifs, ['star', 'planet', 'rocket', 'moon', 'dinosaur']);
});

test('motifsForTheme ignores stopwords and case', () => {
  const result = motifsForTheme('Under the Sea');
  assert.equal(result.matched, true);
  assert.deepEqual(result.tokens, ['sea']);
  assert.deepEqual(result.motifs, ['fish', 'shell', 'wave']);
});

test('motifsForTheme reaches the documented fallback', () => {
  const result = motifsForTheme('unicorns and zeppelins');
  assert.equal(result.matched, false);
  assert.deepEqual(result.motifs, [...FALLBACK_MOTIFS]);
  assert.deepEqual(result.tokens, ['unicorn', 'zeppelin']);
});

test('motifsForTheme ignores inherited object properties', () => {
  for (const theme of ['constructor', 'Constructor', 'CONSTRUCTOR']) {
    const result = motifsForTheme(theme);
    assert.equal(result.matched, false, `${theme} matched something`);
    assert.deepEqual(result.motifs, [...FALLBACK_MOTIFS], `${theme} did not fall back`);
  }
  const mixed = motifsForTheme('space constructor');
  assert.equal(mixed.matched, true, 'the real keyword was lost');
  assert.deepEqual(mixed.motifs, motifsForTheme('space').motifs, 'the inherited property added motifs');
});

test('motifsForTheme survives markup and control characters in the theme', () => {
  for (const theme of ['<script>alert(1)</script>', 'a\r\nb', '"><img src=x>', '\u0000star']) {
    const result = motifsForTheme(theme);
    assert.ok(Array.isArray(result.motifs), `${JSON.stringify(theme)} did not return motifs`);
    assert.ok(result.motifs.length > 0, `${JSON.stringify(theme)} returned no motifs`);
  }
});

test('isKnownMotif recognises vocabulary members only', () => {
  assert.equal(isKnownMotif('star'), true);
  assert.equal(isKnownMotif('dinosaur'), true);
  assert.equal(isKnownMotif('unicorn'), false);
  assert.equal(isKnownMotif(''), false);
});

/* ------------------------------------------------------------------ */
/* Input validation and filename sanitisation                          */
/* ------------------------------------------------------------------ */

test('validateInputs accepts a valid pair and normalises it', () => {
  const result = validateInputs('  space   dinosaurs ', '  Amara  ');
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.theme, 'space dinosaurs');
  assert.equal(result.name, 'Amara');
});

test('validateInputs rejects an empty theme', () => {
  const result = validateInputs('   ', 'Amara');
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /theme/i);
});

test('validateInputs rejects an empty name', () => {
  const result = validateInputs('space', '   ');
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["Enter the child's name."]);
});

test('validateInputs rejects an over-length name', () => {
  const result = validateInputs('space', 'a'.repeat(MAX_NAME_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /characters or fewer/);
});

test('validateInputs rejects an over-length theme', () => {
  const result = validateInputs('a'.repeat(MAX_THEME_LENGTH + 1), 'Amara');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /characters or fewer/);
});

test('validateInputs rejects illegal name characters', () => {
  for (const name of ['Amara2', 'Am@ra', 'Amara!', '-Amara', '123']) {
    const result = validateInputs('space', name);
    assert.equal(result.ok, false, `${JSON.stringify(name)} should be rejected`);
    assert.deepEqual(
      result.errors,
      ['Name may only contain letters, spaces, hyphens and apostrophes.'],
      `${JSON.stringify(name)} produced the wrong message`,
    );
  }
});

test('validateInputs accepts accented and punctuated names', () => {
  for (const name of ['Zoë', 'José', "O'Brien", 'Liam-James', 'Anne Marie']) {
    const result = validateInputs('space', name);
    assert.equal(result.ok, true, `${JSON.stringify(name)} should be accepted`);
  }
});

test('validateInputs reports every problem at once', () => {
  const result = validateInputs('', '');
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test('the published limits are pinned', () => {
  assert.equal(MAX_THEME_LENGTH, 60);
  assert.equal(MAX_NAME_LENGTH, 20);
  assert.equal(PAGE_COUNT, 5);
  assert.equal(MIN_DISTINCT_PAGE_MOTIF_SETS, 4);
});

test('sanitiseFilename produces a filesystem-safe name', () => {
  assert.equal(sanitiseFilename('Amara'), 'amara.pdf');
  assert.equal(sanitiseFilename("O'Brien"), 'obrien.pdf');
  assert.equal(sanitiseFilename('Liam-James'), 'liam-james.pdf');
  assert.equal(sanitiseFilename('  Amara  '), 'amara.pdf');
  assert.equal(sanitiseFilename('Anne Marie'), 'anne-marie.pdf');
  assert.equal(sanitiseFilename('Book 2'), 'book-2.pdf');
});

test('sanitiseFilename folds accents to their base letter', () => {
  assert.equal(sanitiseFilename('Zoë'), 'zoe.pdf');
  assert.equal(sanitiseFilename('José'), 'jose.pdf');
});

test('sanitiseFilename never emits a Windows reserved device name', () => {
  for (const name of ['Con', 'Prn', 'Aux', 'Nul', 'Com1', 'Com9', 'Lpt1', 'Lpt9']) {
    const filename = sanitiseFilename(name);
    assert.ok(
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.pdf$/.test(filename),
      `${name} produced the reserved filename ${filename}`,
    );
  }
  assert.equal(sanitiseFilename('Con'), 'con-book.pdf');
  assert.equal(sanitiseFilename('Connor'), 'connor.pdf', 'a name merely starting with Con was renamed');
});

test('sanitiseFilename cannot escape the download directory', () => {
  for (const name of ['../etc/passwd', '..\\..\\windows', '/absolute', 'C:/temp', '.hidden', 'name.']) {
    const filename = sanitiseFilename(name);
    assert.ok(!filename.includes('/'), `${name} kept a forward slash`);
    assert.ok(!filename.includes('\\'), `${name} kept a backslash`);
    assert.ok(!filename.startsWith('.'), `${name} kept a leading dot`);
    assert.ok(/^[a-z0-9-]+\.pdf$/.test(filename), `${name} produced ${filename}`);
  }
});

test('sanitiseFilename falls back when the name has no usable characters', () => {
  assert.equal(sanitiseFilename('!!!'), 'colouring-book.pdf');
  assert.equal(sanitiseFilename(''), 'colouring-book.pdf');
  assert.equal(sanitiseFilename(null), 'colouring-book.pdf');
  assert.equal(sanitiseFilename(undefined), 'colouring-book.pdf');
});

/* ------------------------------------------------------------------ */
/* Book planning                                                       */
/* ------------------------------------------------------------------ */

test('planBookPages is deterministic for the same input', () => {
  const first = planBookPages('space dinosaurs', 'Amara');
  const second = planBookPages('space dinosaurs', 'Amara');
  assert.deepEqual(first, second);
  assert.equal(first.pages.length, PAGE_COUNT);
});

test('planBookPages varies with the name', () => {
  const amara = planBookPages('space dinosaurs', 'Amara');
  const liam = planBookPages('space dinosaurs', 'Liam');
  assert.notEqual(amara.seed, liam.seed);
});

test('planBookPages gives each page between three and seven distinct motifs', () => {
  const book = planBookPages('space dinosaurs', 'Amara');
  for (const page of book.pages) {
    assert.ok(
      page.motifs.length >= MIN_PAGE_MOTIFS && page.motifs.length <= MAX_PAGE_MOTIFS,
      `page ${page.index} has ${page.motifs.length} motifs`,
    );
    assert.equal(new Set(page.motifs).size, page.motifs.length, `page ${page.index} repeats a motif`);
    for (const motif of page.motifs) {
      assert.ok(MOTIF_NAMES.includes(motif), `page ${page.index} invented motif ${motif}`);
    }
  }
  const signatures = new Set(book.pages.map((page) => page.motifs.join('+')));
  assert.ok(signatures.size >= 2, 'every page is identical');
});

test('planBookPages puts at least one theme motif on every page', () => {
  for (const theme of ['space dinosaurs', 'under the sea', 'fairy garden', 'rocket']) {
    const book = planBookPages(theme, 'Amara');
    assert.equal(book.matched, true, `${theme} did not match`);
    for (const page of book.pages) {
      const themed = page.motifs.filter((motif) => book.motifs.includes(motif));
      assert.ok(themed.length >= 1, `${theme} page ${page.index} has no theme motif`);
    }
  }
});

test('planBookPages still fills every page when the theme matches nothing', () => {
  const book = planBookPages('unicorns and zeppelins', 'Amara');
  assert.equal(book.matched, false);
  for (const page of book.pages) {
    assert.ok(
      page.motifs.length >= MIN_PAGE_MOTIFS && page.motifs.length <= MAX_PAGE_MOTIFS,
      `fallback page ${page.index} has ${page.motifs.length} motifs`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Anti-drift: DOM selector parity (AGENTS.md Section 8)               */
/* ------------------------------------------------------------------ */

test('index.html declares exactly the eight contract IDs', () => {
  const html = readSource('./index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(ids, [...CONTRACT_IDS].sort());
});

test('index.html warns when the module cannot load', () => {
  const html = readSource('./index.html');
  assert.ok(/class="boot-error"/.test(html), 'index.html has no boot-error notice');
  assert.ok(
    /class="boot-error"[^>]*\bhidden\b/.test(html),
    'the boot-error notice is not hidden by default',
  );
  const notice = html.slice(html.indexOf('class="boot-error"'), html.indexOf('class="boot-error"') + 400);
  assert.ok(/http/i.test(notice), 'the notice does not tell the user to serve over HTTP');
});

test('index.html runs the boot check without needing a module', () => {
  const html = readSource('./index.html');
  const bootIndex = html.indexOf('__bookBooted');
  const moduleIndex = html.indexOf('type="module"');
  assert.ok(bootIndex > -1, 'index.html has no boot check');
  assert.ok(moduleIndex > -1, 'index.html does not load app.js as a module');
  assert.ok(bootIndex < moduleIndex, 'the boot check runs after the module script, so it cannot detect a failure');
});

test('app.js signals that the module loaded', () => {
  const source = readSource('./app.js');
  assert.ok(source.includes('__bookBooted'), 'app.js never signals a successful module load');
});

test('the dev server refuses to serve outside the project root', () => {
  const root = process.cwd();
  assert.ok(resolveRequestPath(root, '/index.html'), 'index.html was refused');
  assert.ok(resolveRequestPath(root, '/'), 'the root path did not resolve to index.html');
  assert.equal(resolveRequestPath(root, '/../secret'), null, 'a parent traversal was allowed');
  assert.equal(resolveRequestPath(root, '/src/../../secret'), null, 'a nested traversal was allowed');
  assert.equal(resolveRequestPath(root, '/%2e%2e/secret'), null, 'an encoded traversal was allowed');
  assert.equal(resolveRequestPath(root, '/%'), null, 'a malformed escape was not rejected');
});

test('every selector app.js queries exists verbatim in index.html', () => {
  const html = readSource('./index.html');
  const app = readSource('./app.js');

  const idPatterns = [
    /getElementById\(\s*'([^']+)'\s*\)/g,
    /getElementById\(\s*"([^"]+)"\s*\)/g,
  ];
  const selectorPatterns = [
    /querySelector(?:All)?\(\s*'([^']+)'\s*\)/g,
    /querySelector(?:All)?\(\s*"([^"]+)"\s*\)/g,
  ];

  const ids = new Set();
  for (const pattern of idPatterns) {
    for (const match of app.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }

  const selectors = new Set();
  for (const pattern of selectorPatterns) {
    for (const match of app.matchAll(pattern)) {
      selectors.add(match[1]);
    }
  }

  assert.ok(ids.size >= CONTRACT_IDS.length, `only ${ids.size} ids queried in app.js`);

  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing id="${id}"`);
  }

  for (const id of CONTRACT_IDS) {
    assert.ok(ids.has(id), `app.js never queries #${id}`);
  }

  for (const selector of selectors) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      assert.ok(html.includes(`id="${id}"`), `index.html is missing id="${id}" (queried as ${selector})`);
      continue;
    }
    const dataMatch = /^\[data-([a-z0-9-]+)="([^"]+)"\]$/.exec(selector);
    if (dataMatch) {
      const attribute = `data-${dataMatch[1]}="${dataMatch[2]}"`;
      assert.ok(html.includes(attribute), `index.html is missing ${attribute} (queried as ${selector})`);
      continue;
    }
    assert.fail(`unsupported selector form in app.js: ${selector}`);
  }
});

test('index.html carries the preview data attributes the controller writes', () => {
  const html = readSource('./index.html');
  assert.ok(html.includes('data-role="page-preview"'));
  assert.ok(html.includes('data-page-index="0"'));
});

/* ------------------------------------------------------------------ */
/* Anti-drift: export parity                                           */
/* ------------------------------------------------------------------ */

function extractExports(source) {
  const names = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+const\s+([A-Za-z_$][\w$]*)/g,
    /export\s+let\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function extractImportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) {
        names.add(name);
      }
    }
  }
  return names;
}

test('every export in src/rng.js is imported by this suite', () => {
  const expected = ['deriveSeed', 'hashString', 'makeRng', 'pick', 'pickDistinct', 'randInt', 'shuffle'];
  assert.deepEqual(extractExports(readSource('./src/rng.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('every export in src/themes.js is imported by this suite', () => {
  const expected = [
    'FALLBACK_MOTIFS',
    'MOTIF_KEYWORDS',
    'MOTIF_VOCABULARY',
    'STOPWORDS',
    'isKnownMotif',
    'motifsForTheme',
    'normaliseTheme',
    'singularCandidates',
    'singularise',
    'tokeniseTheme',
  ];
  assert.deepEqual(extractExports(readSource('./src/themes.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('app.js is a pure controller with no exports', () => {
  assert.deepEqual(extractExports(readSource('./app.js')), []);
  const imported = extractImportedNames(readSource('./app.js'));
  assert.ok(imported.has('generateBook'), 'app.js does not import generateBook');
});

test('every export in src/book.js is imported by this suite', () => {
  const expected = [
    'MAX_NAME_LENGTH',
    'MAX_THEME_LENGTH',
    'MIN_DISTINCT_PAGE_MOTIF_SETS',
    'PAGE_COUNT',
    'bookDiversity',
    'generateBook',
    'planBookPages',
    'sanitiseFilename',
    'validateInputs',
  ];
  assert.deepEqual(extractExports(readSource('./src/book.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('every export in src/pdf.js is imported by this suite', () => {
  const expected = [
    'MEDIA_BOX',
    'MIN_STROKE_WIDTH',
    'PDF_VERSION',
    'buildPdf',
    'pageContentStream',
    'pdfTextString',
  ];
  assert.deepEqual(extractExports(readSource('./src/pdf.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('every export in src/motifs.js is imported by this suite', () => {
  const expected = [
    'DETAIL_WEIGHT',
    'MAIN_WEIGHT',
    'MOTIF_NAMES',
    'arc',
    'circle',
    'computeBounds',
    'drawMotif',
    'ellipse',
    'polygon',
    'stroke',
  ];
  assert.deepEqual(extractExports(readSource('./src/motifs.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('every export in src/lettering.js is imported by this suite', () => {
  const expected = [
    'DEFAULT_LETTER_SPACING',
    'fitText',
    'hasGlyph',
    'layoutText',
    'measureText',
  ];
  assert.deepEqual(extractExports(readSource('./src/lettering.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('every export in src/page.js is imported by this suite', () => {
  const expected = [
    'FRAME_INSET',
    'GROUND_Y',
    'INNER_FRAME_INSET',
    'MAX_PAGE_MOTIFS',
    'MIN_PAGE_MOTIFS',
    'PAGE_HEIGHT',
    'PAGE_WIDTH',
    'STROKE_BASE',
    'STROKE_FLOOR',
    'composePage',
    'pageToSvg',
    'polylineToPathData',
    'polylinesToSvg',
    'strokeWidthFor',
    'toPagePolylines',
  ];
  assert.deepEqual(extractExports(readSource('./src/page.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('every export in src/cover.js is imported by this suite', () => {
  const expected = [
    'COVER_TITLE',
    'MAX_NAME_LINES',
    'MAX_NAME_SIZE',
    'MIN_NAME_SIZE',
    'composeCover',
    'coverToSvg',
    'fitName',
  ];
  assert.deepEqual(extractExports(readSource('./src/cover.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('app.js guards its DOM wiring behind a document check', () => {
  const source = readSource('./app.js');
  assert.ok(source.includes("typeof document !== 'undefined'"), 'app.js has no document guard');
  assert.ok(source.includes("document.addEventListener('DOMContentLoaded', init)"));
  assert.ok(source.includes('URL.createObjectURL'), 'app.js never builds a download URL');
  assert.ok(source.includes('application/pdf'), 'app.js does not declare the PDF MIME type');
  assert.ok(source.includes('link.download'), 'app.js never sets the download filename');
});

/* ------------------------------------------------------------------ */
/* Determinism guard: no non-deterministic or dynamic-evaluation escapes */
/* ------------------------------------------------------------------ */

test('source contains no non-deterministic or dynamic-evaluation escapes', () => {
  const files = [
    './app.js',
    './src/rng.js',
    './src/themes.js',
    './src/motifs.js',
    './src/lettering.js',
    './src/page.js',
    './src/cover.js',
    './src/pdf.js',
    './src/book.js',
  ];
  const banned = [
    { pattern: /Math\.random\s*\(/, label: 'Math.random' },
    { pattern: /Date\.now\s*\(/, label: 'Date.now' },
    { pattern: /new Date\s*\(/, label: 'new Date' },
    { pattern: /localeCompare/, label: 'localeCompare' },
    { pattern: /\beval\s*\(/, label: 'eval' },
    { pattern: /new Function\s*\(/, label: 'new Function' },
    { pattern: /\bimport\s*\(/, label: 'dynamic import()' },
  ];
  for (const file of files) {
    const source = readSource(file);
    for (const { pattern, label } of banned) {
      assert.ok(!pattern.test(source), `${file} uses ${label}`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Motif library                                                       */
/* ------------------------------------------------------------------ */

test('MOTIF_NAMES matches the theme vocabulary exactly', () => {
  assert.ok(MOTIF_NAMES.length >= 20, `only ${MOTIF_NAMES.length} motifs are drawable`);
  assert.deepEqual([...MOTIF_NAMES].sort(), [...MOTIF_VOCABULARY].sort());
  assert.equal(new Set(MOTIF_NAMES).size, MOTIF_NAMES.length);
});

test('every motif draws polylines inside its unit box', () => {
  for (const name of MOTIF_NAMES) {
    const { polylines } = drawMotif(name, makeRng(7));
    assert.ok(polylines.length > 0, `${name} drew nothing`);
    for (const line of polylines) {
      assert.ok(Array.isArray(line.points) && line.points.length >= 2, `${name} has a degenerate polyline`);
      assert.equal(typeof line.closed, 'boolean', `${name} has a non-boolean closed flag`);
      assert.equal(typeof line.fill, 'boolean', `${name} has a non-boolean fill flag`);
      assert.ok(line.weight > 0, `${name} has a non-positive weight`);
      for (const [x, y] of line.points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${name} has a non-finite point`);
        assert.ok(x >= -1e-9 && x <= 1 + 1e-9, `${name} escapes the box on x: ${x}`);
        assert.ok(y >= -1e-9 && y <= 1 + 1e-9, `${name} escapes the box on y: ${y}`);
      }
    }
  }
});

test('every motif reports a positive bounding box inside the unit box', () => {
  for (const name of MOTIF_NAMES) {
    const { bounds } = drawMotif(name, makeRng(11));
    assert.ok(bounds.w > 0, `${name} has zero width`);
    assert.ok(bounds.h > 0, `${name} has zero height`);
    assert.ok(bounds.x >= -1e-9 && bounds.x + bounds.w <= 1 + 1e-9, `${name} bounds escape on x`);
    assert.ok(bounds.y >= -1e-9 && bounds.y + bounds.h <= 1 + 1e-9, `${name} bounds escape on y`);
  }
});

test('drawMotif is deterministic for a given seed', () => {
  for (const name of MOTIF_NAMES) {
    assert.deepEqual(drawMotif(name, makeRng(5)), drawMotif(name, makeRng(5)), `${name} is not deterministic`);
  }
});

test('drawMotif rejects an unknown motif', () => {
  assert.throws(() => drawMotif('unicorn', makeRng(1)), { message: 'unknown motif: unicorn' });
});

test('drawMotif rejects inherited object properties as motif names', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(
      () => drawMotif(name, makeRng(1)),
      { message: `unknown motif: ${name}` },
      `${name} was treated as a motif`,
    );
  }
});

test('the polyline builders set closed, fill and weight', () => {
  assert.deepEqual(stroke([[0, 0], [1, 1]]), {
    points: [[0, 0], [1, 1]],
    closed: false,
    fill: false,
    weight: MAIN_WEIGHT,
  });
  const closed = polygon([[0, 0], [1, 0], [1, 1]], { fill: true, weight: DETAIL_WEIGHT });
  assert.equal(closed.closed, true);
  assert.equal(closed.fill, true);
  assert.equal(closed.weight, DETAIL_WEIGHT);
  assert.equal(circle(0.5, 0.5, 0.4).closed, true);
  assert.equal(ellipse(0.5, 0.5, 0.4, 0.2).closed, true);
  assert.equal(arc(0.5, 0.5, 0.4, 0, 90).closed, false);
});

test('the house and the car carry their filled foreground shapes', () => {
  for (const [name, expected] of [['house', 2], ['car', 2]]) {
    const { polylines } = drawMotif(name, makeRng(7));
    const filled = polylines.filter((line) => line.fill);
    assert.equal(filled.length, expected, `${name} has ${filled.length} filled shapes, expected ${expected}`);
    for (const line of filled) {
      assert.equal(line.closed, true, `${name} fills an open path`);
    }
  }
});

test('computeBounds handles an empty set and a single line', () => {
  assert.deepEqual(computeBounds([]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(computeBounds([stroke([[1, 2], [4, 6]])]), { x: 1, y: 2, w: 3, h: 4 });
});

/* ------------------------------------------------------------------ */
/* Lettering                                                           */
/* ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PUNCTUATION = " -'";

test('every uppercase letter, digit and allowed punctuation has a glyph', () => {
  for (const char of [...ALPHABET, ...DIGITS, ...PUNCTUATION]) {
    assert.equal(hasGlyph(char), true, `no glyph for ${JSON.stringify(char)}`);
  }
});

test('hasGlyph rejects characters outside the alphabet', () => {
  for (const char of ['@', '#', '&', '!', 'a', 'z', '\u0301', '\u0414']) {
    assert.equal(hasGlyph(char), false, `${JSON.stringify(char)} should have no glyph`);
  }
});

test('every glyph stays inside a sane em box', () => {
  for (const char of [...ALPHABET, ...DIGITS, ...PUNCTUATION]) {
    const advance = measureText(char, { size: 100 });
    assert.ok(advance >= 40 && advance <= 105, `${JSON.stringify(char)} advances ${advance} pt at size 100`);
    for (const line of layoutText(char, { size: 100 })) {
      for (const [x, y] of line.points) {
        assert.ok(x >= -1 && x <= 101, `${JSON.stringify(char)} escapes the em box on x: ${x}`);
        assert.ok(y >= -35 && y <= 121, `${JSON.stringify(char)} escapes the em box on y: ${y}`);
      }
    }
  }
});

test('layoutText emits one polyline per glyph stroke', () => {
  const lines = layoutText('AMARA', { size: 60 });
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(line.closed, false);
    assert.equal(line.fill, false);
    assert.equal(line.weight, MAIN_WEIGHT);
    assert.ok(line.points.length >= 2);
  }
  assert.equal(layoutText('A', { size: 60 }).length, 2);
  assert.equal(layoutText('M', { size: 60 }).length, 1);
  assert.equal(layoutText('R', { size: 60 }).length, 3);
  assert.equal(layoutText(' ', { size: 60 }).length, 0);
});

test('layoutText scales with size and offsets by x and y', () => {
  const at60 = layoutText('I', { size: 60 });
  const at120 = layoutText('I', { size: 120 });
  assert.equal(at60.length, at120.length);
  for (let i = 0; i < at60.length; i += 1) {
    for (let j = 0; j < at60[i].points.length; j += 1) {
      assert.ok(Math.abs(at120[i].points[j][0] - at60[i].points[j][0] * 2) < 1e-9);
      assert.ok(Math.abs(at120[i].points[j][1] - at60[i].points[j][1] * 2) < 1e-9);
    }
  }
  const offset = layoutText('I', { size: 60, x: 100, y: 200 });
  assert.ok(Math.abs(offset[0].points[0][0] - (at60[0].points[0][0] + 100)) < 1e-9);
  assert.ok(Math.abs(offset[0].points[0][1] - (at60[0].points[0][1] + 200)) < 1e-9);
});

test('measureText is linear in size and counts letter spacing', () => {
  const em = measureText('AMARA', { size: 1 });
  assert.ok(Math.abs(measureText('AMARA', { size: 60 }) - em * 60) < 1e-9);
  assert.ok(Math.abs(em - (5 + 4 * DEFAULT_LETTER_SPACING)) < 1e-9);
  assert.ok(Math.abs(measureText('AMARA', { size: 1, letterSpacing: 0 }) - 5) < 1e-9);
  assert.equal(measureText('', { size: 60 }), 0);
});

test('layoutText throws a descriptive error for an unsupported character', () => {
  assert.throws(() => layoutText('AM@RA'), { message: 'unsupported character: "@"' });
  assert.throws(() => layoutText('\u0414'), /unsupported character/);
});

test('accented letters resolve to a base glyph plus accent strokes', () => {
  const cases = [
    ['\u00c9', 'E', 1],
    ['\u00c8', 'E', 1],
    ['\u00ca', 'E', 1],
    ['\u00cb', 'E', 2],
    ['\u00d1', 'N', 1],
    ['\u00c5', 'A', 1],
    ['\u010c', 'C', 1],
    ['\u00c7', 'C', 1],
  ];
  for (const [accented, base, extra] of cases) {
    assert.equal(
      layoutText(accented, { size: 60 }).length,
      layoutText(base, { size: 60 }).length + extra,
      `${accented} did not add ${extra} accent stroke(s) to ${base}`,
    );
  }
  const acute = layoutText('\u00c9', { size: 60 });
  const accent = acute[acute.length - 1];
  assert.ok(accent.points.every(([, y]) => y < 0), 'the acute accent did not rise above the cap line');
});

test('precomposed and decomposed accents lay out identically', () => {
  assert.deepEqual(layoutText('E\u0301', { size: 60 }), layoutText('\u00c9', { size: 60 }));
});

test('fitText clamps to the floor and the ceiling', () => {
  assert.equal(fitText('AMARA', { maxWidth: 400, maxSize: 120, minSize: 60 }), 76);
  assert.equal(fitText('ABCDEFGHIJKLMNOPQRST', { maxWidth: 400, maxSize: 120, minSize: 60 }), 60);
  assert.equal(fitText('I', { maxWidth: 10000, maxSize: 120, minSize: 60 }), 120);
});

/* ------------------------------------------------------------------ */
/* Page composition                                                    */
/* ------------------------------------------------------------------ */

test('the page geometry is A4 in points', () => {
  assert.ok(Math.abs(PAGE_WIDTH - 595.28) < 1e-9);
  assert.ok(Math.abs(PAGE_HEIGHT - 841.89) < 1e-9);
  assert.ok(FRAME_INSET < INNER_FRAME_INSET);
  assert.ok(GROUND_Y > PAGE_HEIGHT * 0.6 && GROUND_Y < PAGE_HEIGHT * 0.8);
  assert.equal(MIN_PAGE_MOTIFS, 3);
  assert.equal(MAX_PAGE_MOTIFS, 7);
});

test('the published page constants are pinned', () => {
  assert.equal(FRAME_INSET, 24);
  assert.equal(INNER_FRAME_INSET, 32);
  assert.equal(GROUND_Y, 606);
  assert.equal(STROKE_BASE, 5.5);
  assert.equal(STROKE_FLOOR, 4);
});

test('the page frame sits at the published insets', () => {
  const page = composePage('space dinosaurs', 'Amara', 0, { motifs: ['star'] });
  assert.deepEqual(page.polylines[0].points, [
    [24, 24],
    [571.28, 24],
    [571.28, 817.89],
    [24, 817.89],
  ]);
  assert.deepEqual(page.polylines[1].points, [
    [32, 32],
    [563.28, 32],
    [563.28, 809.89],
    [32, 809.89],
  ]);
});

test('strokeWidthFor never drops below the crayon floor', () => {
  assert.equal(strokeWidthFor(MAIN_WEIGHT), STROKE_BASE);
  assert.equal(strokeWidthFor(DETAIL_WEIGHT), STROKE_FLOOR);
  assert.equal(strokeWidthFor(0), STROKE_FLOOR);
  assert.ok(STROKE_FLOOR >= 4);
  assert.ok(STROKE_BASE > STROKE_FLOOR);
});

test('composePage is deterministic and index-sensitive', () => {
  assert.deepEqual(composePage('space dinosaurs', 'Amara', 0), composePage('space dinosaurs', 'Amara', 0));
  const seeds = new Set(
    Array.from({ length: PAGE_COUNT }, (_, i) => composePage('space dinosaurs', 'Amara', i).seed),
  );
  assert.equal(seeds.size, PAGE_COUNT);
});

test('composePage keeps every point on the page', () => {
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const page = composePage('space dinosaurs', 'Amara', index);
    for (const line of page.polylines) {
      for (const [x, y] of line.points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `page ${index} has a non-finite point`);
        assert.ok(x >= 0 && x <= PAGE_WIDTH, `page ${index} escapes on x: ${x}`);
        assert.ok(y >= 0 && y <= PAGE_HEIGHT, `page ${index} escapes on y: ${y}`);
      }
    }
  }
});

test('composePage never lets two motif boxes overlap', () => {
  for (const theme of ['space dinosaurs', 'under the sea', 'fairy garden', 'unicorns and zeppelins']) {
    const plan = planBookPages(theme, 'Amara');
    for (const planned of plan.pages) {
      const page = composePage(theme, 'Amara', planned.index, { motifs: planned.motifs });
      assert.equal(page.placements.length, planned.motifs.length);
      for (let i = 0; i < page.placements.length; i += 1) {
        for (let j = i + 1; j < page.placements.length; j += 1) {
          const a = page.placements[i].bounds;
          const b = page.placements[j].bounds;
          const separated = a.x + a.w <= b.x + 1e-6
            || b.x + b.w <= a.x + 1e-6
            || a.y + a.h <= b.y + 1e-6
            || b.y + b.h <= a.y + 1e-6;
          assert.ok(
            separated,
            `${theme} page ${planned.index}: ${page.placements[i].name} overlaps ${page.placements[j].name}`,
          );
        }
      }
    }
  }
});

test('composePage honours an explicit motif list', () => {
  const page = composePage('space dinosaurs', 'Amara', 0, { motifs: ['star', 'moon', 'rocket'] });
  assert.deepEqual(page.motifs, ['star', 'moon', 'rocket']);
  assert.deepEqual(page.placements.map((placement) => placement.name), ['star', 'moon', 'rocket']);
});

test('composePage draws the frame, the ground line and the motifs', () => {
  const page = composePage('space dinosaurs', 'Amara', 0, { motifs: ['star'] });
  const [outer, inner, ground] = page.polylines;
  assert.equal(outer.width, 4);
  assert.equal(outer.closed, true);
  assert.equal(outer.points.length, 4);
  assert.equal(inner.width, 1.5);
  assert.equal(inner.closed, true);
  assert.equal(ground.width, 3);
  assert.equal(ground.closed, false);
  assert.equal(ground.points.length, 2);
  assert.equal(ground.points[0][1], GROUND_Y);
  assert.ok(page.polylines.length > 8, 'the page carries no motif geometry');
});

/* ------------------------------------------------------------------ */
/* Cover composition                                                   */
/* ------------------------------------------------------------------ */

test('the cover name is never drawn below the 60 pt cap-height floor', () => {
  const names = ['Amara', 'Liam', 'Zo\u00eb', 'Jos\u00e9', "O'Brien", 'Liam-James', 'Anne Marie', 'ABCDEFGHIJKLMNOPQRST'];
  for (const name of names) {
    const cover = composeCover('space dinosaurs', name);
    assert.ok(cover.nameSize >= MIN_NAME_SIZE, `${name} was drawn at ${cover.nameSize} pt`);
    assert.ok(cover.nameSize <= MAX_NAME_SIZE, `${name} was drawn at ${cover.nameSize} pt`);
    assert.ok(cover.nameLines.length >= 1 && cover.nameLines.length <= MAX_NAME_LINES);
    assert.equal(
      cover.nameLines.join('').replace(/\s+/g, ''),
      name.toUpperCase().replace(/\s+/g, ''),
      `${name} lost characters while wrapping`,
    );
  }
});

test('a twenty-character name wraps rather than shrinking below the floor', () => {
  const cover = composeCover('under the sea', 'ABCDEFGHIJKLMNOPQRST');
  assert.equal(cover.nameSize, MIN_NAME_SIZE);
  assert.ok(cover.nameLines.length > 1, 'the name did not wrap');
  assert.ok(cover.nameLines.length <= MAX_NAME_LINES);
  for (const line of cover.nameLines) {
    assert.ok(
      measureText(line, { size: cover.nameSize }) <= PAGE_WIDTH - 60,
      `${line} overflows the cover frame`,
    );
  }
});

test('fitName keeps a short name on one line at the largest size that fits', () => {
  const fitted = fitName('Anne', { maxWidth: 495 });
  assert.deepEqual(fitted.lines, ['ANNE']);
  assert.ok(fitted.size >= MIN_NAME_SIZE && fitted.size < MAX_NAME_SIZE);
  assert.ok(measureText('ANNE', { size: fitted.size }) <= 495);
  assert.ok(measureText('ANNE', { size: fitted.size + 1 }) > 495);
});

test('fitName breaks at a word boundary before breaking inside a word', () => {
  const fitted = fitName('Anne Marie', { maxWidth: 495 });
  assert.deepEqual(fitted.lines, ['ANNE', 'MARIE']);
  assert.ok(fitted.size >= MIN_NAME_SIZE);
  const widest = fitted.lines.reduce((a, b) => (
    measureText(a, { size: 1 }) >= measureText(b, { size: 1 }) ? a : b
  ));
  assert.ok(measureText(widest, { size: fitted.size }) <= 495, 'the widest line overflows');
  assert.ok(measureText(widest, { size: fitted.size + 1 }) > 495, 'the size is not maximal');
});

test('fitName never returns a size below the floor', () => {
  assert.equal(fitName('ABCDEFGHIJKLMNOPQRST', { maxWidth: 10 }).size, MIN_NAME_SIZE);
});

test('composeCover rejects a name the lettering cannot draw', () => {
  assert.throws(() => composeCover('space dinosaurs', '\u0414\u0430\u0440\u0430'), /cannot draw/);
});

test('composeCover carries the title, subtitle and theme motifs', () => {
  const cover = composeCover('space dinosaurs', 'Amara');
  assert.equal(cover.title, COVER_TITLE);
  assert.equal(cover.subtitle, 'SPACE DINOSAURS');
  assert.equal(cover.name, 'Amara');
  assert.ok(cover.motifs.length >= 1 && cover.motifs.length <= 3);
  for (const motif of cover.motifs) {
    assert.ok(MOTIF_NAMES.includes(motif), `cover invented motif ${motif}`);
  }
  assert.equal(cover.width, PAGE_WIDTH);
  assert.equal(cover.height, PAGE_HEIGHT);
});

test('composeCover strips characters the subtitle cannot draw', () => {
  assert.equal(composeCover('under the sea!', 'Amara').subtitle, 'UNDER THE SEA');
});

test('the published cover constants are pinned', () => {
  assert.equal(COVER_TITLE, 'MY COLOURING BOOK');
  assert.equal(MIN_NAME_SIZE, 60);
  assert.equal(MAX_NAME_SIZE, 120);
  assert.equal(MAX_NAME_LINES, 4);
});

test('the cover frame sits at the published insets', () => {
  const cover = composeCover('space dinosaurs', 'Amara');
  assert.deepEqual(cover.polylines[0].points, [
    [20, 20],
    [575.28, 20],
    [575.28, 821.89],
    [20, 821.89],
  ]);
  assert.deepEqual(cover.polylines[1].points, [
    [30, 30],
    [565.28, 30],
    [565.28, 811.89],
    [30, 811.89],
  ]);
});

test('the cover title sits on its published baseline', () => {
  const cover = composeCover('space dinosaurs', 'Amara');
  const titleCount = layoutText(COVER_TITLE, { size: 26 }).length;
  const titleLines = cover.polylines.slice(6, 6 + titleCount);
  assert.equal(titleLines.length, titleCount);
  const ys = titleLines.flatMap((line) => line.points.map(([, y]) => y));
  assert.equal(Math.min(...ys), 150);
  assert.equal(Math.max(...ys), 176);
});

test('the cover name block is centred on the page', () => {
  for (const name of ['Amara', 'Anne Marie', 'ABCDEFGHIJKLMNOPQRST']) {
    const cover = composeCover('space dinosaurs', name);
    const titleCount = layoutText(COVER_TITLE, { size: 26 }).length;
    const nameCount = cover.nameLines.reduce(
      (sum, line) => sum + layoutText(line, { size: cover.nameSize }).length,
      0,
    );
    const nameLines = cover.polylines.slice(6 + titleCount, 6 + titleCount + nameCount);
    assert.equal(nameLines.length, nameCount);
    const ys = nameLines.flatMap((line) => line.points.map(([, y]) => y));
    const capBlockHeight = (cover.nameLines.length - 1) * cover.nameSize * 1.35 + cover.nameSize;
    const top = Math.min(...ys);
    assert.ok(
      Math.abs(top - (400 - capBlockHeight / 2)) < 1e-6,
      `${name} starts at ${top} instead of ${400 - capBlockHeight / 2}`,
    );
    assert.ok(
      Math.max(...ys) <= top + capBlockHeight + cover.nameSize * 0.1,
      `${name} descends more than a descender below its cap block`,
    );
  }
});

test('composeCover is deterministic', () => {
  assert.deepEqual(composeCover('space dinosaurs', 'Amara'), composeCover('space dinosaurs', 'Amara'));
});

test('the cover draws four corner ornaments inside the inner frame', () => {
  const cover = composeCover('space dinosaurs', 'Amara');
  const ornaments = cover.polylines.slice(2, 6);
  assert.equal(ornaments.length, 4);
  const centres = ornaments.map((line) => {
    const xs = line.points.map(([x]) => x);
    const ys = line.points.map(([, y]) => y);
    return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2)];
  });
  assert.deepEqual(centres, [[30, 30], [565, 30], [30, 812], [565, 812]]);
  for (const line of ornaments) {
    assert.equal(line.closed, true, 'a corner ornament is not closed');
  }
});

test('the cover stacks title, name, subtitle and motifs in order', () => {
  const cover = composeCover('space dinosaurs', 'Amara');
  const titleCount = layoutText(COVER_TITLE, { size: 26 }).length;
  const nameCount = cover.nameLines.reduce(
    (sum, line) => sum + layoutText(line, { size: cover.nameSize }).length,
    0,
  );
  const subtitleCount = layoutText(cover.subtitle, { size: 20 }).length;
  const start = 6;
  const bounds = [
    ['title', start, start + titleCount],
    ['name', start + titleCount, start + titleCount + nameCount],
    ['subtitle', start + titleCount + nameCount, start + titleCount + nameCount + subtitleCount],
    ['motifs', start + titleCount + nameCount + subtitleCount, cover.polylines.length],
  ].map(([label, from, to]) => {
    const ys = cover.polylines.slice(from, to).flatMap((line) => line.points.map(([, y]) => y));
    return { label, top: Math.min(...ys), bottom: Math.max(...ys) };
  });
  for (let i = 1; i < bounds.length; i += 1) {
    assert.ok(
      bounds[i].top > bounds[i - 1].bottom,
      `${bounds[i].label} overlaps ${bounds[i - 1].label}`,
    );
  }
});

test('fitName never leaves a leading or trailing space on a wrapped line', () => {
  const fitted = fitName('ABCDEFGHIJ KLMNOPQRST', { maxWidth: 200 });
  assert.ok(fitted.lines.length > 1, 'the name did not wrap');
  for (const line of fitted.lines) {
    assert.equal(line, line.trim(), `${JSON.stringify(line)} carries stray whitespace`);
  }
});

/* ------------------------------------------------------------------ */
/* SVG serialisation                                                   */
/* ------------------------------------------------------------------ */

test('polylineToPathData emits M, L and Z', () => {
  assert.equal(polylineToPathData({ points: [[0, 0], [10, 20]], closed: false }), 'M0 0 L10 20');
  assert.equal(polylineToPathData({ points: [[0, 0], [10, 20], [5, 5]], closed: true }), 'M0 0 L10 20 L5 5 Z');
});

test('polylinesToSvg fills a filled polyline white and leaves the rest unfilled', () => {
  const svg = polylinesToSvg([
    { points: [[0, 0], [10, 0], [10, 10]], closed: true, fill: true, width: 4 },
    { points: [[0, 0], [10, 10]], closed: false, fill: false, width: 4 },
  ]);
  assert.equal((svg.match(/fill="#ffffff"/g) || []).length, 1, 'a filled polyline was not painted white');
  assert.equal((svg.match(/fill="none"/g) || []).length, 1, 'a stroke-only polyline was filled');
});

test('polylinesToSvg rounds caps and joins and strokes in black', () => {
  const svg = polylinesToSvg([{ points: [[0, 0], [1, 1]], closed: false, fill: false, width: 4 }]);
  assert.ok(svg.includes('stroke="#000000"'));
  assert.ok(svg.includes('stroke-linecap="round"'));
  assert.ok(svg.includes('stroke-linejoin="round"'));
  assert.ok(svg.includes('stroke-width="4"'));
});

test('polylinesToSvg resolves a relative weight to an absolute width', () => {
  const svg = polylinesToSvg([{ points: [[0, 0], [1, 1]], closed: false, fill: false, weight: DETAIL_WEIGHT }]);
  assert.ok(svg.includes(`stroke-width="${STROKE_FLOOR}"`));
});

test('polylinesToSvg escapes the aria label', () => {
  const svg = polylinesToSvg([], { label: 'Amara\'s <book> & "more"' });
  assert.ok(svg.includes('&apos;'));
  assert.ok(svg.includes('&lt;book&gt;'));
  assert.ok(svg.includes('&amp;'));
  assert.ok(svg.includes('&quot;'));
  assert.ok(!svg.includes('<book>'));
});

test('toPagePolylines resolves weight to width and defaults the flags', () => {
  const [resolved] = toPagePolylines([{ points: [[0, 0], [1, 1]], weight: MAIN_WEIGHT }]);
  assert.equal(resolved.width, STROKE_BASE);
  assert.equal(resolved.closed, false);
  assert.equal(resolved.fill, false);
  const [explicit] = toPagePolylines([{ points: [[0, 0], [1, 1]], width: 9, closed: true, fill: true }]);
  assert.equal(explicit.width, 9);
  assert.equal(explicit.closed, true);
  assert.equal(explicit.fill, true);
});

test('pageToSvg produces a well-formed standalone document', () => {
  const svg = pageToSvg(composePage('space dinosaurs', 'Amara', 0));
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes(`viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}"`));
  assert.ok(svg.includes('aria-label="Colouring page 1"'));
  assert.equal((svg.match(/<path /g) || []).length, (svg.match(/\/>/g) || []).length);
  assert.ok(!svg.includes('undefined'));
  assert.ok(!svg.includes('NaN'));
});

test('coverToSvg produces a well-formed standalone document', () => {
  const svg = coverToSvg(composeCover('space dinosaurs', 'Amara'));
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('aria-label="Amara&apos;s colouring book cover"'));
  assert.equal((svg.match(/<path /g) || []).length, (svg.match(/\/>/g) || []).length);
  assert.ok(!svg.includes('NaN'));
});

/* ------------------------------------------------------------------ */
/* PDF writer                                                          */
/* ------------------------------------------------------------------ */

const pdfText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

const samplePages = () => {
  const plan = planBookPages('space dinosaurs', 'Amara');
  return [
    composeCover('space dinosaurs', 'Amara'),
    ...plan.pages.map((page) => composePage('space dinosaurs', 'Amara', page.index, { motifs: page.motifs })),
  ];
};

test('buildPdf returns a Uint8Array with a PDF 1.4 header and binary comment', () => {
  const bytes = buildPdf(samplePages(), { title: 'Test' });
  assert.ok(bytes instanceof Uint8Array);
  const text = pdfText(bytes);
  assert.equal(PDF_VERSION, '1.4');
  assert.ok(text.startsWith('%PDF-1.4\n'), 'the header version is a wire contract, not a constant');
  assert.deepEqual(Array.from(bytes.slice(10, 14)), [0xe2, 0xe3, 0xcf, 0xd3]);
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

test('buildPdf emits one page object per page with the A4 media box', () => {
  const pages = samplePages();
  const text = pdfText(buildPdf(pages, { title: 'Test' }));
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, pages.length);
  assert.equal((text.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g) || []).length, pages.length);
  assert.ok(text.includes(`/Count ${pages.length}`));
  assert.deepEqual(MEDIA_BOX, [0, 0, 595.28, 841.89]);
});

test('every xref offset lands on its object header', () => {
  const text = pdfText(buildPdf(samplePages(), { title: 'Test' }));
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  const rows = [...text.slice(startxref).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
  assert.ok(rows.length > 1);
  assert.equal(rows[0][3], 'f');
  for (let number = 1; number < rows.length; number += 1) {
    const offset = Number(rows[number][1]);
    assert.equal(rows[number][3], 'n');
    assert.ok(
      text.startsWith(`${number} 0 obj`, offset),
      `object ${number} offset ${offset} lands on ${JSON.stringify(text.slice(offset, offset + 12))}`,
    );
  }
});

test('startxref lands on the xref table and the row count matches /Size', () => {
  const pages = samplePages();
  const text = pdfText(buildPdf(pages, { title: 'Test' }));
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const declared = Number(/xref\n0 (\d+)\n/.exec(text)[1]);
  const rows = [...text.slice(startxref).matchAll(/^\d{10} \d{5} [nf] $/gm)];
  assert.equal(rows.length, declared);
  assert.equal(declared, 2 * pages.length + 4);
});

test('the page tree, trailer and free entry are pinned to the object numbering', () => {
  const pages = samplePages();
  const count = pages.length;
  const text = pdfText(buildPdf(pages, { title: 'Test' }));

  const kids = Array.from({ length: count }, (_, index) => `${3 + 2 * index} 0 R`).join(' ');
  assert.ok(text.includes(`/Kids [${kids}]`), 'the page tree does not reference the page objects');

  for (let index = 0; index < count; index += 1) {
    const pageNumber = 3 + 2 * index;
    assert.ok(
      text.includes(`/Contents ${pageNumber + 1} 0 R`),
      `page object ${pageNumber} does not point at its content stream`,
    );
  }

  const infoNumber = 2 * count + 3;
  const size = infoNumber + 1;
  assert.ok(
    text.includes(`trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoNumber} 0 R >>\nstartxref\n`),
    'the trailer does not declare the right size, root and info object',
  );
  assert.ok(
    text.includes(`xref\n0 ${size}\n0000000000 65535 f \n`),
    'the free entry is not the conventional 65535 generation',
  );
});

test('a page without an explicit size falls back to the A4 media box', () => {
  const stream = pageContentStream({ polylines: [] });
  assert.ok(stream.includes('0 0 595.28 841.89 re'), 'the content stream did not default to A4');

  const text = pdfText(buildPdf([{ polylines: [] }], { title: 'Test' }));
  assert.ok(text.includes('/MediaBox [0 0 595.28 841.89]'), 'the page object did not default to A4');
});

test('every stream length matches its declared /Length', () => {
  const pages = samplePages();
  const text = pdfText(buildPdf(pages, { title: 'Test' }));
  let checked = 0;
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const declared = Number(match[1]);
    const start = match.index + match[0].length;
    const end = text.indexOf('\nendstream', start);
    assert.equal(end - start, declared, 'declared /Length does not match the stream bytes');
    checked += 1;
  }
  assert.equal(checked, pages.length);
});

test('pageContentStream sets white fill, black stroke and round caps', () => {
  const stream = pageContentStream(composePage('space dinosaurs', 'Amara', 0, { motifs: ['star'] }));
  assert.ok(stream.startsWith('1 1 1 rg\n'));
  assert.ok(stream.includes('0 0 595.28 841.89 re'));
  assert.ok(stream.includes('\nf\n'));
  assert.ok(stream.includes('0 0 0 RG'));
  assert.ok(stream.includes('1 J'));
  assert.ok(stream.includes('1 j'));
  assert.ok(!stream.includes('NaN'));
});

test('pageContentStream never emits a stroke thinner than the floor', () => {
  const stream = pageContentStream(composePage('space dinosaurs', 'Amara', 0, { motifs: ['star'] }));
  const widths = [...stream.matchAll(/^([\d.]+) w$/gm)].map((match) => Number(match[1]));
  assert.ok(widths.length > 0);
  for (const width of widths) {
    assert.ok(width >= MIN_STROKE_WIDTH, `stroke width ${width} is below the floor`);
  }
  assert.equal(MIN_STROKE_WIDTH, 4);
});

test('pageContentStream flips Y without mutating the IR', () => {
  const page = {
    polylines: [{ points: [[10, 20], [30, 40]], closed: false, fill: false, width: 4 }],
    width: 595.28,
    height: 841.89,
  };
  const stream = pageContentStream(page);
  assert.ok(stream.includes('10 821.89 m'), 'the first point was not flipped');
  assert.ok(stream.includes('30 801.89 l'), 'the second point was not flipped');
  assert.deepEqual(page.polylines[0].points, [[10, 20], [30, 40]], 'the IR was mutated');
});

test('pageContentStream closes a filled path even when it is open', () => {
  const open = { points: [[0, 0], [10, 0], [10, 10]], closed: false, width: 4 };
  const filled = pageContentStream({ polylines: [{ ...open, fill: true }], width: 595.28, height: 841.89 });
  assert.ok(/\nh\nB$/.test(filled), 'a filled open path was not closed before B');
  const stroked = pageContentStream({ polylines: [{ ...open, fill: false }], width: 595.28, height: 841.89 });
  assert.ok(!/\nh\n/.test(stroked), 'a stroke-only open path was closed');
  assert.ok(/\nS$/.test(stroked));
});

test('pageContentStream emits B for filled paths and S for stroke-only ones', () => {
  const stream = pageContentStream(composePage('space dinosaurs', 'Amara', 0, { motifs: ['rocket', 'star'] }));
  assert.ok(/\nB(\n|$)/.test(stream), 'the rocket window did not emit a filled path');
  assert.ok(/\nS(\n|$)/.test(stream), 'no stroke-only path was emitted');
});

test('pageContentStream skips a polyline it cannot draw', () => {
  const stream = pageContentStream({
    polylines: [
      { points: [[10, 20]], closed: false, fill: false, width: 4 },
      { points: 'not points', closed: false, fill: false, width: 4 },
      { points: [[30, 40], [50, 60]], closed: false, fill: false, width: 4 },
    ],
    width: 595.28,
    height: 841.89,
  });
  assert.ok(!stream.includes('10 821.89 m'), 'a single-point polyline was drawn');
  assert.ok(stream.includes('30 801.89 m'), 'the drawable polyline was dropped');
  assert.equal((stream.match(/ m$/gm) || []).length, 1, 'more than one path was started');
});

test('pdfTextString escapes ASCII and encodes non-ASCII as UTF-16BE', () => {
  assert.equal(pdfTextString('Amara'), '(Amara)');
  assert.equal(pdfTextString('a(b)c'), '(a\\(b\\)c)');
  assert.equal(pdfTextString('back\\slash'), '(back\\\\slash)');
  assert.equal(pdfTextString('Zo\u00eb'), '<FEFF005A006F00EB>');
  assert.equal(pdfTextString('\u00c9'), '<FEFF00C9>');
  assert.equal(pdfTextString('\u{1F600}'), '<FEFFD83DDE00>', 'an astral character was not split into a surrogate pair');
});

test('pdfTextString replaces a lone surrogate instead of emitting it', () => {
  assert.equal(pdfTextString('\uD800'), '<FEFFFFFD>', 'a lone high surrogate was emitted verbatim');
  assert.equal(pdfTextString('\uDC00'), '<FEFFFFFD>', 'a lone low surrogate was emitted verbatim');
  assert.equal(pdfTextString('a\uD800b'), '<FEFF0061FFFD0062>', 'a lone surrogate mid-string was emitted verbatim');
  assert.equal(pdfTextString('\u{1F600}'), '<FEFFD83DDE00>', 'a valid pair was mistaken for lone surrogates');
});

test('buildPdf encodes a non-ASCII title as a hex string', () => {
  const text = pdfText(buildPdf(samplePages(), { title: 'Zo\u00eb' }));
  assert.ok(text.includes('<FEFF005A006F00EB>'));
  assert.ok(!text.includes('Zo\u00eb'));
});

test('buildPdf rejects an empty page list', () => {
  assert.throws(() => buildPdf([]), TypeError);
  assert.throws(() => buildPdf(null), TypeError);
});

/* ------------------------------------------------------------------ */
/* Book orchestrator                                                   */
/* ------------------------------------------------------------------ */

test('generateBook returns a cover plus five distinct pages and a PDF', () => {
  const book = generateBook('space dinosaurs', 'Amara');
  assert.equal(book.title, "Amara's colouring book");
  assert.equal(book.theme, 'space dinosaurs');
  assert.equal(book.name, 'Amara');
  assert.equal(book.filename, 'amara.pdf');
  assert.equal(book.cover.index, 0);
  assert.equal(book.cover.label, 'Cover');
  assert.equal(book.pages.length, PAGE_COUNT);
  assert.deepEqual(book.pages.map((page) => page.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(book.pages.map((page) => page.label), ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5']);
  assert.ok(book.pdfBytes instanceof Uint8Array);
  assert.ok(book.pdfBytes.length > 1000);
});

test('generateBook is byte-identical across calls', () => {
  const first = generateBook('space dinosaurs', 'Amara');
  const second = generateBook('space dinosaurs', 'Amara');
  assert.equal(first.pdfBytes.length, second.pdfBytes.length);
  assert.ok(first.pdfBytes.every((byte, index) => byte === second.pdfBytes[index]));
  assert.deepEqual(first.pages.map((page) => page.svg), second.pages.map((page) => page.svg));
});

test('generateBook varies with the theme and the name', () => {
  const base = generateBook('space dinosaurs', 'Amara');
  const otherTheme = generateBook('under the sea', 'Amara');
  const otherName = generateBook('space dinosaurs', 'Liam');
  assert.notEqual(base.cover.svg, otherTheme.cover.svg);
  assert.notEqual(base.cover.svg, otherName.cover.svg);
  assert.notEqual(base.filename, otherName.filename);
});

test('generateBook rejects invalid input', () => {
  assert.throws(() => generateBook('', 'Amara'), /Enter a theme/);
  assert.throws(() => generateBook('space', ''), /Enter the child's name/);
  assert.throws(() => generateBook('space', 'a'.repeat(MAX_NAME_LENGTH + 1)), /characters or fewer/);
  assert.throws(() => generateBook('a'.repeat(MAX_THEME_LENGTH + 1), 'Amara'), /characters or fewer/);
  assert.throws(() => generateBook('space', 'Am@ra'), /letters, spaces, hyphens and apostrophes/);
});

test('generateBook survives hostile but valid input', () => {
  for (const theme of ['constructor', '<script>alert(1)</script>', 'a\r\nb\u0000']) {
    const book = generateBook(theme, 'Amara');
    assert.equal(book.pages.length, PAGE_COUNT, `${JSON.stringify(theme)} produced the wrong page count`);
    assert.ok(book.pdfBytes.length > 1000, `${JSON.stringify(theme)} produced a tiny PDF`);
    assert.ok(!book.cover.svg.includes('<script'), `${JSON.stringify(theme)} leaked markup into the SVG`);
  }
  assert.throws(
    () => generateBook('space', 'Amara\u0000b'),
    /letters, spaces, hyphens and apostrophes/,
    'a NUL in the name was accepted',
  );
});

test('generateBook sanitises the download filename', () => {
  assert.equal(generateBook('space', 'Zo\u00eb').filename, 'zoe.pdf');
  assert.equal(generateBook('space', "O'Brien").filename, 'obrien.pdf');
  assert.equal(generateBook('space', 'Anne Marie').filename, 'anne-marie.pdf');
});

test('generateBook keeps the pages pairwise distinct and varied', () => {
  for (const theme of ['space dinosaurs', 'under the sea', 'fairy garden', 'rocket', 'unicorns and zeppelins']) {
    const book = generateBook(theme, 'Amara');
    const diversity = bookDiversity(book.pages);
    assert.equal(diversity.distinctSvgs, true, `${theme} produced duplicate pages`);
    assert.ok(
      diversity.distinctMotifSets >= MIN_DISTINCT_PAGE_MOTIF_SETS,
      `${theme} produced only ${diversity.distinctMotifSets} distinct motif sets`,
    );
  }
});

test('bookDiversity reports duplicates it is given', () => {
  const page = { svg: '<svg/>', motifs: ['star', 'moon'] };
  assert.deepEqual(bookDiversity([page, page]), { distinctSvgs: false, distinctMotifSets: 1 });
  assert.deepEqual(
    bookDiversity([page, { svg: '<svg>2</svg>', motifs: ['moon', 'star'] }]),
    { distinctSvgs: true, distinctMotifSets: 1 },
  );
});

test('every preview is a standalone SVG document', () => {
  const book = generateBook('fairy garden', 'Zo\u00eb');
  for (const card of [book.cover, ...book.pages]) {
    assert.ok(card.svg.startsWith('<svg '), `${card.label} is not an SVG`);
    assert.ok(card.svg.endsWith('</svg>'), `${card.label} is truncated`);
    assert.ok(!card.svg.includes('NaN'), `${card.label} contains NaN`);
  }
});
