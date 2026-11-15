/**
 * Deterministic pseudo-randomness for the colouring book.
 *
 * Every draw in this project comes from here: no Math.random, no Date.now, no
 * locale-dependent ordering. The same seed always produces the same sequence,
 * so the same (theme, name) pair always produces the same book.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over UTF-16 code units. Stable across engines and Node versions.
 *
 * @param {string} input
 * @returns {number} unsigned 32-bit integer
 */
export function hashString(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`hashString expects a string, received ${typeof input}`);
  }
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Mulberry32. Returns a function producing floats in [0, 1).
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  if (!Number.isInteger(seed)) {
    throw new TypeError(`makeRng expects an integer seed, received ${typeof seed}`);
  }
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mix a seed with an index so each page gets its own independent stream while
 * the book as a whole stays reproducible.
 *
 * @param {number} seed
 * @param {number} index
 * @returns {number} unsigned 32-bit integer
 */
export function deriveSeed(seed, index) {
  if (!Number.isInteger(seed)) {
    throw new TypeError(`deriveSeed expects an integer seed, received ${typeof seed}`);
  }
  if (!Number.isInteger(index)) {
    throw new TypeError(`deriveSeed expects an integer index, received ${typeof index}`);
  }
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Integer in [min, max], inclusive.
 *
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randInt(rng, min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new TypeError('randInt expects integer bounds');
  }
  if (max < min) {
    throw new RangeError(`randInt bounds reversed: ${min} > ${max}`);
  }
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * One element drawn uniformly from a non-empty array.
 *
 * @param {() => number} rng
 * @param {readonly unknown[]} items
 * @returns {unknown}
 */
export function pick(rng, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError('pick expects a non-empty array');
  }
  return items[Math.floor(rng() * items.length)];
}

/**
 * `count` distinct elements, in draw order. Never returns duplicates, and
 * clamps to the pool size rather than throwing.
 *
 * @param {() => number} rng
 * @param {readonly unknown[]} items
 * @param {number} count
 * @returns {unknown[]}
 */
export function pickDistinct(rng, items, count) {
  if (!Array.isArray(items)) {
    throw new TypeError('pickDistinct expects an array');
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError(`pickDistinct expects a non-negative integer count, received ${count}`);
  }
  const pool = items.slice();
  const take = Math.min(count, pool.length);
  const out = [];
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
    out.push(pool[i]);
  }
  return out;
}

/**
 * Fisher-Yates shuffle of a copy. The input array is never mutated.
 *
 * @param {() => number} rng
 * @param {readonly unknown[]} items
 * @returns {unknown[]}
 */
export function shuffle(rng, items) {
  if (!Array.isArray(items)) {
    throw new TypeError('shuffle expects an array');
  }
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}
