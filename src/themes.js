/**
 * Theme interpretation: turn a free-text theme into a vocabulary of motifs.
 *
 * The mapping is deliberately small and explicit. A theme that matches nothing
 * falls back to FALLBACK_MOTIFS, which is a documented, reachable set rather
 * than an error, so the app always produces a book.
 */

/** Words that carry no motif meaning and are dropped before matching. */
export const STOPWORDS = Object.freeze([
  'the',
  'a',
  'an',
  'of',
  'and',
  'in',
  'on',
  'under',
  'my',
  'with',
]);

/** Every motif the art engine can draw. */
export const MOTIF_VOCABULARY = Object.freeze([
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
  'bird',
  'boat',
  'robot',
  'cupcake',
  'snowflake',
]);

/** Used when a theme matches no keyword at all. */
export const FALLBACK_MOTIFS = Object.freeze([
  'star',
  'cloud',
  'sun',
  'flower',
  'tree',
  'butterfly',
]);

/**
 * Keyword to motif list. Keys are singular and lowercase; plural forms are
 * resolved by singularise() before lookup.
 */
export const MOTIF_KEYWORDS = Object.freeze({
  space: ['star', 'planet', 'rocket', 'moon'],
  star: ['star'],
  planet: ['planet'],
  rocket: ['rocket'],
  moon: ['moon'],
  astronaut: ['rocket', 'star', 'planet'],
  alien: ['planet', 'star'],
  dinosaur: ['dinosaur'],
  dino: ['dinosaur'],
  trex: ['dinosaur'],
  jurassic: ['dinosaur'],
  sea: ['fish', 'shell', 'wave'],
  ocean: ['fish', 'shell', 'wave'],
  underwater: ['fish', 'shell', 'wave'],
  fish: ['fish'],
  shell: ['shell'],
  wave: ['wave'],
  beach: ['shell', 'wave', 'sun'],
  garden: ['flower', 'tree', 'butterfly'],
  flower: ['flower'],
  tree: ['tree'],
  butterfly: ['butterfly'],
  fairy: ['flower', 'butterfly', 'star'],
  jungle: ['tree', 'bird', 'butterfly'],
  forest: ['tree', 'bird', 'mountain'],
  safari: ['tree', 'sun', 'bird'],
  sky: ['cloud', 'sun', 'star'],
  cloud: ['cloud'],
  sun: ['sun'],
  sunny: ['sun'],
  house: ['house'],
  home: ['house'],
  balloon: ['balloon'],
  party: ['balloon', 'cupcake', 'star'],
  cat: ['cat'],
  kitten: ['cat'],
  dog: ['dog'],
  puppy: ['dog'],
  pet: ['cat', 'dog'],
  car: ['car'],
  truck: ['car'],
  mountain: ['mountain'],
  rainbow: ['rainbow'],
  bird: ['bird'],
  boat: ['boat'],
  ship: ['boat'],
  robot: ['robot'],
  cupcake: ['cupcake'],
  cake: ['cupcake'],
  snow: ['snowflake'],
  snowflake: ['snowflake'],
  winter: ['snowflake'],
  farm: ['house', 'tree', 'cloud'],
  city: ['house', 'car', 'star'],
  night: ['moon', 'star', 'cloud'],
  bug: ['butterfly', 'flower'],
  insect: ['butterfly', 'flower'],
});

/**
 * Trim, lowercase, and collapse internal whitespace.
 *
 * @param {string} theme
 * @returns {string}
 */
export function normaliseTheme(theme) {
  if (typeof theme !== 'string') {
    throw new TypeError(`normaliseTheme expects a string, received ${typeof theme}`);
  }
  return theme.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Candidate singular forms, most literal first. English plurals are irregular
 * enough that guessing one form is unreliable, so callers get the ladder.
 *
 * @param {string} word
 * @returns {string[]}
 */
export function singularCandidates(word) {
  if (typeof word !== 'string') {
    throw new TypeError(`singularCandidates expects a string, received ${typeof word}`);
  }
  const out = [word];
  if (word.length > 4 && word.endsWith('ies')) {
    out.push(`${word.slice(0, -3)}y`);
    return out;
  }
  if (word.length > 3 && word.endsWith('es')) {
    out.push(word.slice(0, -2));
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    out.push(word.slice(0, -1));
  }
  return out;
}

/**
 * Best singular guess: the first candidate the vocabulary knows, otherwise the
 * most-stripped candidate. Vocabulary-aware, so 'houses' resolves to 'house'
 * while 'fishes' resolves to 'fish'.
 *
 * @param {string} word
 * @returns {string}
 */
export function singularise(word) {
  const candidates = singularCandidates(word);
  for (const candidate of candidates) {
    if (Object.hasOwn(MOTIF_KEYWORDS, candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

/**
 * Lowercase word tokens with stopwords removed, singularised, and deduplicated
 * in first-seen order.
 *
 * @param {string} theme
 * @returns {string[]}
 */
export function tokeniseTheme(theme) {
  const words = normaliseTheme(theme).split(/[^a-z0-9]+/).filter(Boolean);
  const seen = new Set();
  const tokens = [];
  for (const word of words) {
    if (STOPWORDS.includes(word)) {
      continue;
    }
    const token = singularise(word);
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Resolve a theme to its motif list.
 *
 * @param {string} theme
 * @returns {{ tokens: string[], motifs: string[], matched: boolean }}
 */
export function motifsForTheme(theme) {
  const tokens = tokeniseTheme(theme);
  const seen = new Set();
  const motifs = [];
  for (const token of tokens) {
    const mapped = MOTIF_KEYWORDS[token];
    if (!mapped) {
      continue;
    }
    for (const motif of mapped) {
      if (seen.has(motif)) {
        continue;
      }
      seen.add(motif);
      motifs.push(motif);
    }
  }
  if (motifs.length === 0) {
    return { tokens, motifs: [...FALLBACK_MOTIFS], matched: false };
  }
  return { tokens, motifs, matched: true };
}

/**
 * Whether the art engine can draw this motif.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownMotif(name) {
  return MOTIF_VOCABULARY.includes(name);
}
