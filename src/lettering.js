/**
 * Single-stroke vector lettering.
 *
 * Glyphs live in an em box: x runs 0..advance, y runs 0 (cap top) to 1
 * (baseline). Descenders and accents may fall outside that range. Scaling by
 * `size` therefore makes `size` the cap height in points, which is what the
 * cover needs to guarantee.
 *
 * Accented letters are handled by NFD decomposition: the base letter is drawn
 * and the combining mark becomes an accent stroke above the cap line. That is
 * why `Zoë` and `José` render instead of throwing — `validateInputs` accepts
 * them, so the lettering has to as well.
 *
 * Output polylines use the same shape as the motif library, so the page
 * composer treats text and art identically.
 */

const ACCENT_ABOVE = -0.12;

/** Combining marks that have a stroke definition. */
const ACCENTS = {
  '\u0301': [[[0.32, ACCENT_ABOVE], [0.62, -0.34]]], // acute
  '\u0300': [[[0.32, -0.34], [0.62, ACCENT_ABOVE]]], // grave
  '\u0302': [[[0.28, ACCENT_ABOVE], [0.5, -0.34], [0.72, ACCENT_ABOVE]]], // circumflex
  '\u0303': [[[0.28, -0.2], [0.4, -0.3], [0.6, -0.2], [0.72, -0.3]]], // tilde
  '\u0308': [circlePoints(0.34, -0.24, 0.05), circlePoints(0.66, -0.24, 0.05)], // diaeresis
  '\u030a': [circlePoints(0.5, -0.24, 0.1)], // ring
  '\u030c': [[[0.28, -0.34], [0.5, ACCENT_ABOVE], [0.72, -0.34]]], // caron
  '\u0327': [[[0.5, 1.0], [0.5, 1.14], [0.36, 1.2]]], // cedilla
};

function circlePoints(cx, cy, r, segments = 12) {
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  points.push(points[0]);
  return points;
}

function arcPoints(cx, cy, r, startDeg, endDeg, segments = 14) {
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = start + ((end - start) * i) / segments;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return points;
}

function ellipsePoints(cx, cy, rx, ry, segments = 20) {
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  points.push(points[0]);
  return points;
}

/**
 * Uppercase alphabet, digits, and the three punctuation marks the name
 * validator allows. `w` is the advance width in em units.
 */
const GLYPHS = {
  A: { w: 1, s: [[[0, 1], [0.5, 0], [1, 1]], [[0.18, 0.62], [0.82, 0.62]]] },
  B: {
    w: 1,
    s: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.66, 0], [0.84, 0.14], [0.84, 0.36], [0.66, 0.5], [0, 0.5]],
      [[0, 0.5], [0.7, 0.5], [0.88, 0.64], [0.88, 0.86], [0.7, 1], [0, 1]],
    ],
  },
  C: { w: 1, s: [arcPoints(0.5, 0.5, 0.5, 40, 320, 16)] },
  D: { w: 1, s: [[[0, 0], [0, 1]], arcPoints(0.5, 0.5, 0.5, -90, 90, 12)] },
  E: { w: 1, s: [[[0, 0], [0, 1]], [[0, 0], [0.78, 0]], [[0, 0.5], [0.68, 0.5]], [[0, 1], [0.78, 1]]] },
  F: { w: 1, s: [[[0, 0], [0, 1]], [[0, 0], [0.78, 0]], [[0, 0.5], [0.68, 0.5]]] },
  G: {
    w: 1,
    s: [
      arcPoints(0.5, 0.5, 0.5, 40, 320, 16),
      [[0.62, 0.5], [1, 0.5]],
      [[1, 0.5], [1, 0.78]],
    ],
  },
  H: { w: 1, s: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]] },
  I: { w: 0.7, s: [[[0.35, 0], [0.35, 1]], [[0.1, 0], [0.6, 0]], [[0.1, 1], [0.6, 1]]] },
  J: { w: 1, s: [[[0.75, 0], [0.75, 0.78]], arcPoints(0.45, 0.78, 0.3, 0, 180, 10)] },
  K: { w: 1, s: [[[0, 0], [0, 1]], [[0.9, 0], [0, 0.55]], [[0.3, 0.42], [0.95, 1]]] },
  L: { w: 1, s: [[[0, 0], [0, 1]], [[0, 1], [0.8, 1]]] },
  M: { w: 1, s: [[[0, 1], [0, 0], [0.5, 0.62], [1, 0], [1, 1]]] },
  N: { w: 1, s: [[[0, 1], [0, 0], [1, 1], [1, 0]]] },
  O: { w: 1, s: [ellipsePoints(0.5, 0.5, 0.5, 0.5, 20)] },
  P: {
    w: 1,
    s: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.68, 0], [0.86, 0.16], [0.86, 0.38], [0.68, 0.54], [0, 0.54]],
    ],
  },
  Q: { w: 1, s: [ellipsePoints(0.5, 0.5, 0.5, 0.5, 20), [[0.62, 0.66], [1, 1.05]]] },
  R: {
    w: 1,
    s: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.68, 0], [0.86, 0.16], [0.86, 0.38], [0.68, 0.54], [0, 0.54]],
      [[0.5, 0.54], [0.95, 1]],
    ],
  },
  S: {
    w: 1,
    s: [
      [
        [0.85, 0.14], [0.68, 0], [0.3, 0], [0.14, 0.16], [0.14, 0.34],
        [0.3, 0.48], [0.7, 0.54], [0.86, 0.68], [0.86, 0.86], [0.7, 1],
        [0.3, 1], [0.14, 0.86],
      ],
    ],
  },
  T: { w: 1, s: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]] },
  U: { w: 1, s: [[[0, 0], [0, 0.78], [0.16, 1], [0.84, 1], [1, 0.78], [1, 0]]] },
  V: { w: 1, s: [[[0, 0], [0.5, 1], [1, 0]]] },
  W: { w: 1, s: [[[0, 0], [0.22, 1], [0.5, 0.42], [0.78, 1], [1, 0]]] },
  X: { w: 1, s: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]] },
  Y: { w: 1, s: [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]] },
  Z: { w: 1, s: [[[0, 0], [1, 0]], [[1, 0], [0, 1]], [[0, 1], [1, 1]]] },

  0: { w: 1, s: [ellipsePoints(0.5, 0.5, 0.44, 0.5, 20)] },
  1: { w: 1, s: [[[0.2, 0.2], [0.5, 0], [0.5, 1]], [[0.2, 1], [0.8, 1]]] },
  2: {
    w: 1,
    s: [[[0.14, 0.2], [0.3, 0.02], [0.7, 0.02], [0.86, 0.2], [0.86, 0.36], [0.14, 1], [0.86, 1]]],
  },
  3: {
    w: 1,
    s: [
      [[0.14, 0.12], [0.3, 0], [0.7, 0], [0.86, 0.16], [0.86, 0.34], [0.7, 0.48], [0.4, 0.48]],
      [[0.7, 0.48], [0.86, 0.62], [0.86, 0.84], [0.7, 1], [0.3, 1], [0.14, 0.88]],
    ],
  },
  4: { w: 1, s: [[[0.7, 0], [0.1, 0.68], [1, 0.68]], [[0.7, 0], [0.7, 1]]] },
  5: {
    w: 1,
    s: [[
      [0.86, 0], [0.2, 0], [0.16, 0.44], [0.3, 0.38], [0.7, 0.38],
      [0.86, 0.54], [0.86, 0.82], [0.7, 1], [0.3, 1], [0.14, 0.88],
    ]],
  },
  6: {
    w: 1,
    s: [[
      [0.8, 0.06], [0.6, 0], [0.34, 0.04], [0.16, 0.24], [0.14, 0.6],
      [0.2, 0.86], [0.36, 1], [0.64, 1], [0.84, 0.84], [0.84, 0.62],
      [0.66, 0.48], [0.36, 0.48], [0.18, 0.62],
    ]],
  },
  7: { w: 1, s: [[[0.14, 0], [0.86, 0], [0.86, 0.16], [0.44, 1]]] },
  8: { w: 1, s: [ellipsePoints(0.5, 0.26, 0.34, 0.26, 16), ellipsePoints(0.5, 0.74, 0.4, 0.26, 16)] },
  9: {
    w: 1,
    s: [[
      [0.2, 0.94], [0.4, 1], [0.66, 0.96], [0.84, 0.76], [0.86, 0.4],
      [0.8, 0.14], [0.64, 0], [0.36, 0], [0.16, 0.16], [0.16, 0.38],
      [0.34, 0.52], [0.64, 0.52], [0.82, 0.38],
    ]],
  },

  ' ': { w: 0.5, s: [] },
  '-': { w: 0.8, s: [[[0.1, 0.5], [0.7, 0.5]]] },
  "'": { w: 0.4, s: [[[0.2, 0], [0.2, 0.22]]] },
};

/** Default letter spacing, in em units. */
export const DEFAULT_LETTER_SPACING = 0.06;

function resolveGlyph(char) {
  const direct = GLYPHS[char];
  if (direct) {
    return direct;
  }
  const decomposed = [...char.normalize('NFD')];
  if (decomposed.length > 1) {
    const base = GLYPHS[decomposed[0]];
    if (base) {
      const accentStrokes = [];
      for (const mark of decomposed.slice(1)) {
        const accent = ACCENTS[mark];
        if (!accent) {
          throw new Error(`unsupported character: ${JSON.stringify(char)}`);
        }
        accentStrokes.push(...accent);
      }
      return { w: base.w, s: [...base.s, ...accentStrokes] };
    }
  }
  throw new Error(`unsupported character: ${JSON.stringify(char)}`);
}

/**
 * Whether this module can draw the character.
 *
 * @param {string} char
 * @returns {boolean}
 */
export function hasGlyph(char) {
  try {
    resolveGlyph(char);
    return true;
  } catch {
    return false;
  }
}

/**
 * Width of a string in points.
 *
 * @param {string} text
 * @param {{ size?: number, letterSpacing?: number }} [options]
 * @returns {number}
 */
export function measureText(text, options = {}) {
  const size = options.size ?? 1;
  const letterSpacing = options.letterSpacing ?? DEFAULT_LETTER_SPACING;
  const chars = [...text];
  let width = 0;
  for (let i = 0; i < chars.length; i += 1) {
    width += resolveGlyph(chars[i]).w;
    if (i < chars.length - 1) {
      width += letterSpacing;
    }
  }
  return width * size;
}

/**
 * Lay a string out as polylines in page coordinates.
 *
 * @param {string} text
 * @param {{ x?: number, y?: number, size?: number, letterSpacing?: number, weight?: number }} [options]
 * @returns {Array<{ points: Array<[number, number]>, closed: boolean, fill: boolean, weight: number }>}
 */
export function layoutText(text, options = {}) {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const size = options.size ?? 100;
  const letterSpacing = options.letterSpacing ?? DEFAULT_LETTER_SPACING;
  const weight = options.weight ?? 1;

  const polylines = [];
  let cursor = 0;
  for (const char of text) {
    const glyph = resolveGlyph(char);
    for (const strokePoints of glyph.s) {
      polylines.push({
        points: strokePoints.map(([gx, gy]) => [x + (cursor + gx) * size, y + gy * size]),
        closed: false,
        fill: false,
        weight,
      });
    }
    cursor += glyph.w + letterSpacing;
  }
  return polylines;
}

/**
 * Largest size at or below `maxSize` that fits `maxWidth`, never below
 * `minSize`. A caller that gets `minSize` back must wrap the text itself.
 *
 * @param {string} text
 * @param {{ maxWidth: number, maxSize?: number, minSize?: number, letterSpacing?: number }} options
 * @returns {number}
 */
export function fitText(text, options) {
  const maxWidth = options.maxWidth;
  const maxSize = options.maxSize ?? 120;
  const minSize = options.minSize ?? 60;
  const letterSpacing = options.letterSpacing ?? DEFAULT_LETTER_SPACING;
  const emWidth = measureText(text, { size: 1, letterSpacing });
  if (emWidth <= 0) {
    return maxSize;
  }
  const fitted = Math.floor(maxWidth / emWidth);
  return Math.max(minSize, Math.min(maxSize, fitted));
}
