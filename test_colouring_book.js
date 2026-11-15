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
  validateInputs,
  sanitiseFilename,
  buildPlaceholderPages,
} from './app.js';

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
  assert.throws(() => randInt(makeRng(1), 7, 3), RangeError);
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

test('shuffle is a permutation and does not mutate the input', () => {
  const input = ['a', 'b', 'c', 'd', 'e'];
  const out = shuffle(makeRng(7), input);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.deepEqual(input, ['a', 'b', 'c', 'd', 'e']);
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
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /name/i);
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

test('sanitiseFilename produces a filesystem-safe name', () => {
  assert.equal(sanitiseFilename('Amara'), 'amara.pdf');
  assert.equal(sanitiseFilename("O'Brien"), 'obrien.pdf');
  assert.equal(sanitiseFilename('Liam-James'), 'liam-james.pdf');
  assert.equal(sanitiseFilename('  Amara  '), 'amara.pdf');
  assert.equal(sanitiseFilename('Anne Marie'), 'anne-marie.pdf');
});

test('sanitiseFilename folds accents to their base letter', () => {
  assert.equal(sanitiseFilename('Zoë'), 'zoe.pdf');
  assert.equal(sanitiseFilename('José'), 'jose.pdf');
});

test('sanitiseFilename falls back when the name has no usable characters', () => {
  assert.equal(sanitiseFilename('!!!'), 'colouring-book.pdf');
  assert.equal(sanitiseFilename(''), 'colouring-book.pdf');
  assert.equal(sanitiseFilename(null), 'colouring-book.pdf');
  assert.equal(sanitiseFilename(undefined), 'colouring-book.pdf');
});

/* ------------------------------------------------------------------ */
/* Placeholder pages                                                   */
/* ------------------------------------------------------------------ */

test('buildPlaceholderPages is deterministic for the same input', () => {
  const first = buildPlaceholderPages('space dinosaurs', 'Amara');
  const second = buildPlaceholderPages('space dinosaurs', 'Amara');
  assert.deepEqual(first, second);
  assert.equal(first.pages.length, PAGE_COUNT);
});

test('buildPlaceholderPages varies with the name', () => {
  const amara = buildPlaceholderPages('space dinosaurs', 'Amara');
  const liam = buildPlaceholderPages('space dinosaurs', 'Liam');
  assert.notEqual(amara.seed, liam.seed);
});

test('buildPlaceholderPages gives each page a bounded motif subset', () => {
  const book = buildPlaceholderPages('space dinosaurs', 'Amara');
  for (const page of book.pages) {
    assert.ok(page.motifs.length >= 1 && page.motifs.length <= 3, `page ${page.index} has ${page.motifs.length} motifs`);
    assert.equal(new Set(page.motifs).size, page.motifs.length, `page ${page.index} repeats a motif`);
    for (const motif of page.motifs) {
      assert.ok(book.motifs.includes(motif), `page ${page.index} invented motif ${motif}`);
    }
  }
  const signatures = new Set(book.pages.map((page) => page.motifs.join('+')));
  assert.ok(signatures.size >= 2, 'every placeholder page is identical');
});

/* ------------------------------------------------------------------ */
/* Anti-drift: DOM selector parity (AGENTS.md Section 8)               */
/* ------------------------------------------------------------------ */

test('index.html declares exactly the eight contract IDs', () => {
  const html = readSource('./index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(ids, [...CONTRACT_IDS].sort());
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

test('every export in app.js is imported by this suite', () => {
  const expected = [
    'MAX_NAME_LENGTH',
    'MAX_THEME_LENGTH',
    'PAGE_COUNT',
    'buildPlaceholderPages',
    'sanitiseFilename',
    'validateInputs',
  ];
  assert.deepEqual(extractExports(readSource('./app.js')), expected);
  const imported = extractImportedNames(readSource('./test_colouring_book.js'));
  for (const name of expected) {
    assert.ok(imported.has(name), `test suite does not import ${name}`);
  }
});

test('app.js is importable without a DOM', () => {
  assert.equal(typeof validateInputs, 'function');
  assert.equal(typeof sanitiseFilename, 'function');
  assert.equal(typeof buildPlaceholderPages, 'function');
});

/* ------------------------------------------------------------------ */
/* Determinism guard: no non-deterministic or dynamic-evaluation escapes */
/* ------------------------------------------------------------------ */

test('source contains no non-deterministic or dynamic-evaluation escapes', () => {
  const files = ['./app.js', './src/rng.js', './src/themes.js'];
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
