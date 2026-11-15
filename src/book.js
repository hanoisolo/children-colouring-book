/**
 * Book orchestrator.
 *
 * Owns the whole pipeline from two strings to a downloadable document:
 * validation, motif planning, cover and page composition, SVG serialisation for
 * the preview, and the PDF bytes for the download. Everything here is pure, so
 * the headless suite exercises exactly the path the browser takes.
 *
 * `generateBook` refuses to return a book that fails its own quality bar. Two
 * pages that render identically, or five pages built from the same handful of
 * motifs, are a defect rather than a cosmetic issue, so the check throws instead
 * of shipping a dull book.
 */

import { deriveSeed, hashString, makeRng, pick, pickDistinct, randInt, shuffle } from './rng.js';
import { motifsForTheme, normaliseTheme } from './themes.js';
import { MOTIF_NAMES } from './motifs.js';
import { hasGlyph } from './lettering.js';
import { MAX_PAGE_MOTIFS, MIN_PAGE_MOTIFS, composePage, pageToSvg } from './page.js';
import { composeCover, coverToSvg } from './cover.js';
import { buildPdf } from './pdf.js';

export const MAX_THEME_LENGTH = 60;
export const MAX_NAME_LENGTH = 20;
export const PAGE_COUNT = 5;

/** How many of the interior pages must carry a distinct motif multiset. */
export const MIN_DISTINCT_PAGE_MOTIF_SETS = 4;

const NAME_PATTERN = /^\p{L}[\p{L} '\-]*$/u;

/**
 * Validate and normalise the two form inputs.
 *
 * @param {string} theme
 * @param {string} name
 * @returns {{ ok: boolean, errors: string[], theme: string, name: string }}
 */
export function validateInputs(theme, name) {
  const errors = [];
  const cleanTheme = typeof theme === 'string' ? theme.trim().replace(/\s+/g, ' ') : '';
  const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';

  if (cleanTheme.length === 0) {
    errors.push('Enter a theme, for example "space dinosaurs".');
  } else if (cleanTheme.length > MAX_THEME_LENGTH) {
    errors.push(`Theme must be ${MAX_THEME_LENGTH} characters or fewer.`);
  }

  if (cleanName.length === 0) {
    errors.push("Enter the child's name.");
  } else if (cleanName.length > MAX_NAME_LENGTH) {
    errors.push(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  } else if (!NAME_PATTERN.test(cleanName)) {
    errors.push('Name may only contain letters, spaces, hyphens and apostrophes.');
  } else if ([...cleanName.toUpperCase()].some((char) => !hasGlyph(char))) {
    errors.push('Name may only use letters the book can draw.');
  }

  return { ok: errors.length === 0, errors, theme: cleanTheme, name: cleanName };
}

/**
 * Filesystem-safe download name. Accents are folded to their base letter,
 * apostrophes dropped, any other run of non-alphanumerics collapsed to a
 * single hyphen, with a `.pdf` suffix.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitiseFilename(name) {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'colouring-book'}.pdf`;
}

/**
 * Plan which motifs each page draws.
 *
 * Every page gets between `MIN_PAGE_MOTIFS` and `MAX_PAGE_MOTIFS` distinct
 * motifs, at least one of them drawn from the theme's own vocabulary, and each
 * page derives its own seed so the five pages differ from one another while
 * the whole book stays reproducible.
 *
 * @param {string} theme
 * @param {string} name
 * @returns {{ seed: number, motifs: string[], matched: boolean, pages: Array<{ index: number, motifs: string[] }> }}
 */
export function planBookPages(theme, name) {
  const { motifs, matched } = motifsForTheme(theme);
  const drawable = motifs.filter((motif) => MOTIF_NAMES.includes(motif));
  const pool = drawable.length > 0 ? drawable : MOTIF_NAMES;
  const seed = hashString(`${normaliseTheme(theme)}\u0000${String(name).trim().toLowerCase()}`);

  const pages = [];
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const rng = makeRng(deriveSeed(seed, index));
    const count = randInt(rng, MIN_PAGE_MOTIFS, MAX_PAGE_MOTIFS);
    const chosen = [pick(rng, pool)];
    const rest = MOTIF_NAMES.filter((motif) => !chosen.includes(motif));
    chosen.push(...pickDistinct(rng, rest, count - 1));
    pages.push({ index, motifs: shuffle(rng, chosen) });
  }

  return { seed, motifs, matched, pages };
}

/**
 * Measure how varied a set of composed pages is.
 *
 * @param {Array<{ svg: string, motifs: string[] }>} pages
 * @returns {{ distinctSvgs: boolean, distinctMotifSets: number }}
 */
export function bookDiversity(pages) {
  const svgs = pages.map((page) => page.svg);
  const multisets = pages.map((page) => [...page.motifs].sort().join('+'));
  return {
    distinctSvgs: new Set(svgs).size === svgs.length,
    distinctMotifSets: new Set(multisets).size,
  };
}

/**
 * Generate a complete book.
 *
 * @param {string} theme
 * @param {string} name
 * @returns {{
 *   title: string,
 *   theme: string,
 *   name: string,
 *   filename: string,
 *   cover: { index: number, label: string, svg: string, motifs: string[] },
 *   pages: Array<{ index: number, label: string, svg: string, motifs: string[] }>,
 *   pdfBytes: Uint8Array,
 * }}
 */
export function generateBook(theme, name) {
  const result = validateInputs(theme, name);
  if (!result.ok) {
    throw new Error(result.errors.join(' '));
  }

  const plan = planBookPages(result.theme, result.name);
  const cover = composeCover(result.theme, result.name);
  const composed = plan.pages.map((page) => (
    composePage(result.theme, result.name, page.index, { motifs: page.motifs })
  ));

  const pages = composed.map((page) => ({
    index: page.index + 1,
    label: `Page ${page.index + 1}`,
    svg: pageToSvg(page),
    motifs: page.motifs,
  }));

  const diversity = bookDiversity(pages);
  if (!diversity.distinctSvgs) {
    throw new Error('generated pages are not pairwise distinct');
  }
  if (diversity.distinctMotifSets < MIN_DISTINCT_PAGE_MOTIF_SETS) {
    throw new Error(
      `only ${diversity.distinctMotifSets} distinct page motif sets, need ${MIN_DISTINCT_PAGE_MOTIF_SETS}`,
    );
  }

  const title = `${result.name}'s colouring book`;

  return {
    title,
    theme: result.theme,
    name: result.name,
    filename: sanitiseFilename(result.name),
    cover: {
      index: 0,
      label: 'Cover',
      svg: coverToSvg(cover),
      motifs: cover.motifs,
    },
    pages,
    pdfBytes: buildPdf([cover, ...composed], { title }),
  };
}
