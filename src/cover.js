/**
 * Cover composition.
 *
 * The cover is the one page that carries text, so it owns the name-fitting
 * rule: the child's name is uppercased, wrapped to at most four lines, and
 * never drawn below 60 pt cap height. A 20-character name needs three lines at
 * that floor, which is why wrapping exists at all rather than a single
 * shrinking line.
 *
 * Composition reuses the interior page's polyline IR and SVG writer, so the
 * cover and the pages cannot drift apart in stroke handling or fill semantics.
 */

import { DETAIL_WEIGHT, MAIN_WEIGHT, MOTIF_NAMES, drawMotif } from './motifs.js';
import { deriveSeed, hashString, makeRng, pickDistinct } from './rng.js';
import { motifsForTheme, normaliseTheme } from './themes.js';
import { hasGlyph, layoutText, measureText } from './lettering.js';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  polylinesToSvg,
  strokeWidthFor,
  toPagePolylines,
} from './page.js';

/** Fixed cover title. */
export const COVER_TITLE = 'MY COLOURING BOOK';

/** Smallest cap height the name may be drawn at, in points. */
export const MIN_NAME_SIZE = 60;

/** Largest cap height the name may be drawn at, in points. */
export const MAX_NAME_SIZE = 120;

/** Most lines the name may wrap to. */
export const MAX_NAME_LINES = 4;

const COVER_FRAME_INSET = 20;
const COVER_INNER_INSET = 30;
const TEXT_WIDTH = 495;
const TITLE_SIZE = 26;
const TITLE_Y = 150;
const NAME_CENTRE_Y = 400;
const SUBTITLE_SIZE = 20;
const SUBTITLE_Y = 620;
const ORNAMENT_RADIUS = 8;
const MOTIF_BOX = 100;
const MOTIF_ROW_Y = 730;

function wrapWords(text, size, maxWidth) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureText(candidate, { size }) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function wrapChars(text, size, maxWidth) {
  const lines = [];
  let current = '';
  for (const char of text) {
    const candidate = current + char;
    if (current && measureText(candidate, { size }) > maxWidth) {
      lines.push(current);
      current = char === ' ' ? '' : char;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/**
 * Largest cap height at which the name fits `maxWidth` in at most `maxLines`
 * lines, preferring word boundaries. Only when no size at or above `minSize`
 * works does it fall back to breaking inside a word at `minSize`.
 *
 * @param {string} text
 * @param {{ maxWidth?: number, maxSize?: number, minSize?: number, maxLines?: number }} [options]
 * @returns {{ lines: string[], size: number }}
 */
export function fitName(text, options = {}) {
  const maxWidth = options.maxWidth ?? TEXT_WIDTH;
  const maxSize = options.maxSize ?? MAX_NAME_SIZE;
  const minSize = options.minSize ?? MIN_NAME_SIZE;
  const maxLines = options.maxLines ?? MAX_NAME_LINES;
  const upper = String(text).toUpperCase();

  for (let size = maxSize; size >= minSize; size -= 1) {
    const lines = wrapWords(upper, size, maxWidth);
    const fits = lines.length <= maxLines
      && lines.every((line) => measureText(line, { size }) <= maxWidth);
    if (fits) {
      return { lines, size };
    }
  }
  return { lines: wrapChars(upper, minSize, maxWidth), size: minSize };
}

function drawableText(text) {
  return [...String(text)]
    .filter((char) => hasGlyph(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function rect(x, y, w, h, width) {
  return {
    points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
    closed: true,
    fill: false,
    width,
  };
}

function circle(cx, cy, r, width, segments = 16) {
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return { points, closed: true, fill: false, width };
}

/**
 * Compose the cover.
 *
 * @param {string} theme
 * @param {string} name
 * @returns {{
 *   seed: number,
 *   name: string,
 *   theme: string,
 *   title: string,
 *   subtitle: string,
 *   nameSize: number,
 *   nameLines: string[],
 *   motifs: string[],
 *   polylines: Array<object>,
 *   width: number,
 *   height: number,
 * }}
 */
export function composeCover(theme, name) {
  const cleanName = String(name).trim().replace(/\s+/g, ' ');
  const upper = cleanName.toUpperCase();
  const unsupported = [...upper].filter((char) => !hasGlyph(char));
  if (unsupported.length > 0) {
    throw new Error(`name contains characters the book cannot draw: ${unsupported.join(' ')}`);
  }

  const seed = hashString(
    `cover\u0000${normaliseTheme(theme)}\u0000${cleanName.toLowerCase()}`,
  );
  const rng = makeRng(seed);

  const polylines = [
    rect(
      COVER_FRAME_INSET,
      COVER_FRAME_INSET,
      PAGE_WIDTH - 2 * COVER_FRAME_INSET,
      PAGE_HEIGHT - 2 * COVER_FRAME_INSET,
      4,
    ),
    rect(
      COVER_INNER_INSET,
      COVER_INNER_INSET,
      PAGE_WIDTH - 2 * COVER_INNER_INSET,
      PAGE_HEIGHT - 2 * COVER_INNER_INSET,
      1.5,
    ),
  ];

  const corners = [
    [COVER_INNER_INSET, COVER_INNER_INSET],
    [PAGE_WIDTH - COVER_INNER_INSET, COVER_INNER_INSET],
    [COVER_INNER_INSET, PAGE_HEIGHT - COVER_INNER_INSET],
    [PAGE_WIDTH - COVER_INNER_INSET, PAGE_HEIGHT - COVER_INNER_INSET],
  ];
  for (const [cx, cy] of corners) {
    polylines.push(circle(cx, cy, ORNAMENT_RADIUS, strokeWidthFor(DETAIL_WEIGHT)));
  }

  const titleWidth = measureText(COVER_TITLE, { size: TITLE_SIZE });
  polylines.push(
    ...toPagePolylines(
      layoutText(COVER_TITLE, {
        x: (PAGE_WIDTH - titleWidth) / 2,
        y: TITLE_Y,
        size: TITLE_SIZE,
        weight: MAIN_WEIGHT,
      }),
    ),
  );

  const fitted = fitName(cleanName, { maxWidth: TEXT_WIDTH });
  const lineGap = fitted.size * 1.35;
  const blockTop = NAME_CENTRE_Y - (fitted.lines.length * lineGap) / 2;
  fitted.lines.forEach((line, i) => {
    const lineWidth = measureText(line, { size: fitted.size });
    polylines.push(
      ...toPagePolylines(
        layoutText(line, {
          x: (PAGE_WIDTH - lineWidth) / 2,
          y: blockTop + i * lineGap + fitted.size,
          size: fitted.size,
          weight: MAIN_WEIGHT,
        }),
      ),
    );
  });

  const subtitle = drawableText(String(theme).toUpperCase()) || 'COLOURING FUN';
  const subtitleWidth = measureText(subtitle, { size: SUBTITLE_SIZE });
  polylines.push(
    ...toPagePolylines(
      layoutText(subtitle, {
        x: (PAGE_WIDTH - subtitleWidth) / 2,
        y: SUBTITLE_Y,
        size: SUBTITLE_SIZE,
        weight: DETAIL_WEIGHT,
      }),
    ),
  );

  const { motifs } = motifsForTheme(theme);
  const drawable = motifs.filter((motif) => MOTIF_NAMES.includes(motif));
  const pool = drawable.length > 0 ? drawable : MOTIF_NAMES;
  const chosen = pickDistinct(rng, pool, Math.min(3, pool.length));
  const boxW = (TEXT_WIDTH / 3) * 0.8;

  chosen.forEach((motifName, i) => {
    const cx = (PAGE_WIDTH - TEXT_WIDTH) / 2 + (TEXT_WIDTH / 3) * (i + 0.5);
    const { polylines: drawn, bounds } = drawMotif(motifName, rng);
    if (bounds.w <= 0 || bounds.h <= 0) {
      return;
    }
    const fit = Math.min(boxW / bounds.w, MOTIF_BOX / bounds.h);
    const ox = cx - (bounds.x + bounds.w / 2) * fit;
    const oy = MOTIF_ROW_Y - (bounds.y + bounds.h / 2) * fit;
    polylines.push(
      ...toPagePolylines(
        drawn.map((line) => ({
          points: line.points.map(([x, y]) => [ox + x * fit, oy + y * fit]),
          closed: line.closed,
          fill: line.fill,
          weight: line.weight,
        })),
      ),
    );
  });

  return {
    seed,
    name: cleanName,
    theme: String(theme).trim(),
    title: COVER_TITLE,
    subtitle,
    nameSize: fitted.size,
    nameLines: fitted.lines,
    motifs: chosen,
    polylines,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  };
}

/**
 * Serialise a composed cover.
 *
 * @param {ReturnType<typeof composeCover>} cover
 * @returns {string}
 */
export function coverToSvg(cover) {
  return polylinesToSvg(cover.polylines, {
    width: cover.width,
    height: cover.height,
    label: `${cover.name}'s colouring book cover`,
  });
}
