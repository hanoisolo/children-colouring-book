/**
 * Interior page composition and SVG serialisation.
 *
 * One canonical polyline IR serves both renderers: every line is a list of
 * `[x, y]` points in top-down A4 user units (595.28 x 841.89 pt, y increasing
 * downwards), plus `closed`, `fill`, and `width` in points. The SVG writer
 * consumes it here; the PDF writer will consume the same array in Phase 3 and
 * is the only place that flips Y.
 *
 * `fill` matters more than it looks. The SVG preview can hide an overlap by
 * painting a shape white, but a stroke-only PDF cannot: two motifs crossing
 * would show their interior lines. Carrying `fill` through the IR lets the PDF
 * emit `B` (fill and stroke) where the SVG emitted `fill="#ffffff"`, so the
 * preview and the print stay honest about each other.
 */

import { DETAIL_WEIGHT, MAIN_WEIGHT, MOTIF_NAMES, drawMotif } from './motifs.js';
import { deriveSeed, hashString, makeRng, pick, pickDistinct, randInt, shuffle } from './rng.js';
import { motifsForTheme, normaliseTheme } from './themes.js';

/** A4 width in PostScript points. */
export const PAGE_WIDTH = 595.28;

/** A4 height in PostScript points. */
export const PAGE_HEIGHT = 841.89;

/** Outer decorative border inset. */
export const FRAME_INSET = 24;

/** Inner decorative border inset. */
export const INNER_FRAME_INSET = 32;

/** Baseline of the ground line, low enough to leave room for the motif grid. */
export const GROUND_Y = Math.round(PAGE_HEIGHT * 0.72);

/** Fewest motifs an interior page may carry. */
export const MIN_PAGE_MOTIFS = 3;

/** Most motifs an interior page may carry. */
export const MAX_PAGE_MOTIFS = 7;

/** Stroke width, in points, for a relative weight of 1. */
export const STROKE_BASE = 5.5;

/** Thinnest stroke the composer will emit, in points. Crayon-friendly floor. */
export const STROKE_FLOOR = 4;

const FRAME_STROKE = 4;
const INNER_FRAME_STROKE = 1.5;
const GROUND_STROKE = 3;

/**
 * Convert a relative motif weight to an absolute stroke width in points.
 *
 * @param {number} weight
 * @returns {number}
 */
export function strokeWidthFor(weight) {
  return Math.max(STROKE_FLOOR, weight * STROKE_BASE);
}

/**
 * Normalise any polyline set into the page IR, resolving `weight` to `width`.
 *
 * @param {Array<{ points: Array<[number, number]>, closed?: boolean, fill?: boolean, weight?: number, width?: number }>} polylines
 * @returns {Array<{ points: Array<[number, number]>, closed: boolean, fill: boolean, width: number }>}
 */
export function toPagePolylines(polylines) {
  return polylines.map((line) => ({
    points: line.points,
    closed: line.closed ?? false,
    fill: line.fill ?? false,
    width: line.width ?? strokeWidthFor(line.weight ?? MAIN_WEIGHT),
  }));
}

function rect(x, y, w, h, width) {
  return {
    points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
    closed: true,
    fill: false,
    width,
  };
}

function selectMotifs(theme, rng) {
  const { motifs } = motifsForTheme(theme);
  const drawable = motifs.filter((name) => MOTIF_NAMES.includes(name));
  const pool = drawable.length > 0 ? drawable : MOTIF_NAMES;
  const count = randInt(rng, MIN_PAGE_MOTIFS, MAX_PAGE_MOTIFS);
  const chosen = [pick(rng, pool)];
  const rest = MOTIF_NAMES.filter((name) => !chosen.includes(name));
  chosen.push(...pickDistinct(rng, rest, count - 1));
  return shuffle(rng, chosen);
}

/**
 * Compose one interior page.
 *
 * Motifs sit on a jittered grid. Each is scaled to 0.8 of its cell and its
 * centre moves by at most 0.1 of a cell, so the worst-case bounding box is
 * exactly the cell: neighbours can touch but never overlap.
 *
 * @param {string} theme
 * @param {string} name
 * @param {number} index zero-based page index
 * @param {{ motifs?: string[] }} [options] explicit motif names, bypassing selection
 * @returns {{
 *   index: number,
 *   seed: number,
 *   motifs: string[],
 *   placements: Array<{ name: string, bounds: { x: number, y: number, w: number, h: number } }>,
 *   polylines: Array<object>,
 *   width: number,
 *   height: number,
 * }}
 */
export function composePage(theme, name, index, options = {}) {
  const seed = deriveSeed(
    hashString(`${normaliseTheme(theme)}\u0000${String(name).trim().toLowerCase()}`),
    index,
  );
  const rng = makeRng(seed);
  const motifs = options.motifs ? [...options.motifs] : selectMotifs(theme, rng);

  const polylines = [
    rect(FRAME_INSET, FRAME_INSET, PAGE_WIDTH - 2 * FRAME_INSET, PAGE_HEIGHT - 2 * FRAME_INSET, FRAME_STROKE),
    rect(
      INNER_FRAME_INSET,
      INNER_FRAME_INSET,
      PAGE_WIDTH - 2 * INNER_FRAME_INSET,
      PAGE_HEIGHT - 2 * INNER_FRAME_INSET,
      INNER_FRAME_STROKE,
    ),
  ];

  const contentLeft = INNER_FRAME_INSET + 8;
  const contentRight = PAGE_WIDTH - INNER_FRAME_INSET - 8;
  const contentTop = INNER_FRAME_INSET + 24;
  const contentBottom = GROUND_Y - 16;
  const contentW = contentRight - contentLeft;
  const contentH = contentBottom - contentTop;

  polylines.push({
    points: [[contentLeft, GROUND_Y], [contentRight, GROUND_Y]],
    closed: false,
    fill: false,
    width: GROUND_STROKE,
  });

  const tufts = 5;
  for (let i = 0; i < tufts; i += 1) {
    const tx = contentLeft + ((i + 0.5) / tufts) * contentW + (rng() - 0.5) * 12;
    polylines.push({
      points: [[tx - 6, GROUND_Y + 10], [tx, GROUND_Y + 2], [tx + 6, GROUND_Y + 10]],
      closed: false,
      fill: false,
      width: strokeWidthFor(DETAIL_WEIGHT),
    });
  }

  const cols = motifs.length <= 4 ? 2 : 3;
  const rows = Math.ceil(motifs.length / cols);
  const cellW = contentW / cols;
  const cellH = contentH / rows;
  const placements = [];

  motifs.forEach((motifName, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = contentLeft + (col + 0.5) * cellW + (rng() - 0.5) * 0.2 * cellW;
    const cy = contentTop + (row + 0.5) * cellH + (rng() - 0.5) * 0.2 * cellH;

    const { polylines: drawn, bounds } = drawMotif(motifName, rng);
    if (bounds.w <= 0 || bounds.h <= 0) {
      return;
    }
    const fit = Math.min((0.8 * cellW) / bounds.w, (0.8 * cellH) / bounds.h);
    const ox = cx - (bounds.x + bounds.w / 2) * fit;
    const oy = cy - (bounds.y + bounds.h / 2) * fit;

    placements.push({
      name: motifName,
      bounds: { x: ox + bounds.x * fit, y: oy + bounds.y * fit, w: bounds.w * fit, h: bounds.h * fit },
    });

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

  return { index, seed, motifs, placements, polylines, width: PAGE_WIDTH, height: PAGE_HEIGHT };
}

function formatNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * SVG path data for one polyline.
 *
 * @param {{ points: Array<[number, number]>, closed?: boolean }} line
 * @returns {string}
 */
export function polylineToPathData(line) {
  const parts = line.points.map(
    ([x, y], i) => `${i === 0 ? 'M' : 'L'}${formatNumber(x)} ${formatNumber(y)}`,
  );
  if (line.closed) {
    parts.push('Z');
  }
  return parts.join(' ');
}

/**
 * Serialise a polyline set as a standalone SVG document.
 *
 * @param {Array<object>} polylines
 * @param {{ width?: number, height?: number, label?: string }} [options]
 * @returns {string}
 */
export function polylinesToSvg(polylines, options = {}) {
  const width = options.width ?? PAGE_WIDTH;
  const height = options.height ?? PAGE_HEIGHT;
  const label = options.label ?? 'Colouring page';

  const body = polylines
    .map((line) => {
      const fill = line.fill ? '#ffffff' : 'none';
      const strokeWidth = formatNumber(line.width ?? strokeWidthFor(line.weight ?? MAIN_WEIGHT));
      return (
        `<path d="${polylineToPathData(line)}" fill="${fill}" stroke="#000000"` +
        ` stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}"` +
    ` width="${formatNumber(width)}" height="${formatNumber(height)}" role="img"` +
    ` aria-label="${escapeXml(label)}">${body}</svg>`
  );
}

/**
 * Serialise a composed page.
 *
 * @param {{ index: number, polylines: Array<object>, width: number, height: number }} page
 * @returns {string}
 */
export function pageToSvg(page) {
  return polylinesToSvg(page.polylines, {
    width: page.width,
    height: page.height,
    label: `Colouring page ${page.index + 1}`,
  });
}
