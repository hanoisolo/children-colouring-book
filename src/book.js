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
import { MAIN_WEIGHT, MOTIF_NAMES } from './motifs.js';
import { hasGlyph, layoutText, measureText } from './lettering.js';
import {
  MAX_PAGE_MOTIFS,
  MIN_PAGE_MOTIFS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  composePage,
  pageToSvg,
  polylinesToSvg,
  toPagePolylines,
} from './page.js';
import { composeCover, coverToSvg, fitName } from './cover.js';
import { buildPdf, fitImageRect, jpegSize } from './pdf.js';
import {
  IMAGE_MODEL,
  buildCoverPrompt,
  buildPagePrompt,
  estimateImageCost,
  generateImages,
} from './imagegen.js';

export const MAX_THEME_LENGTH = 60;
export const MAX_NAME_LENGTH = 20;
export const PAGE_COUNT = 5;

/** How many of the interior pages must carry a distinct motif multiset. */
export const MIN_DISTINCT_PAGE_MOTIF_SETS = 4;

const NAME_PATTERN = /^\p{L}[\p{L} '\-]*$/u;

/**
 * Windows refuses to create a file whose stem is a reserved device name, with
 * any extension. A child called `Con` would otherwise get a download that
 * silently fails on Windows.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

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
  const safe = base || 'colouring-book';
  return `${WINDOWS_RESERVED.test(safe) ? `${safe}-book` : safe}.pdf`;
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

/** Horizontal inset of the cover name band, in points. */
export const COVER_BAND_INSET = 40;

/**
 * Compose a cover from a generated illustration plus the child's name.
 *
 * The name is drawn as vector strokes, not asked of the image model, because a
 * model will misspell a name and a misspelled name is a defect rather than a
 * cosmetic issue. A white band across the top of the page carries the name, and
 * its height follows the fitted name block so a wrapped 20-character name cannot
 * overflow it.
 *
 * The band and the name are one polyline set, so the PDF and the browser preview
 * render the same geometry from the same source.
 *
 * @param {{ theme: string, name: string, image: { bytes: Uint8Array, base64?: string, mimeType?: string } }} input
 * @returns {object}
 */
export function composeImageCover({ theme, name, image }) {
  const cleanName = String(name).trim().replace(/\s+/g, ' ');
  const frame = jpegSize(image.bytes);
  const rect = fitImageRect(frame.width, frame.height, PAGE_WIDTH, PAGE_HEIGHT);

  const fitted = fitName(cleanName, { maxWidth: PAGE_WIDTH - 2 * COVER_BAND_INSET });
  const lineGap = fitted.size * 1.35;
  const blockHeight = (fitted.lines.length - 1) * lineGap + fitted.size;
  const padding = fitted.size * 0.35;
  const bandHeight = blockHeight + 2 * padding;

  const polylines = [
    {
      points: [[0, 0], [PAGE_WIDTH, 0], [PAGE_WIDTH, bandHeight], [0, bandHeight]],
      closed: true,
      fill: true,
      stroke: false,
      width: 4,
    },
  ];

  fitted.lines.forEach((line, index) => {
    const lineWidth = measureText(line, { size: fitted.size });
    polylines.push(
      ...toPagePolylines(
        layoutText(line, {
          x: (PAGE_WIDTH - lineWidth) / 2,
          y: padding + index * lineGap,
          size: fitted.size,
          weight: MAIN_WEIGHT,
        }),
      ),
    );
  });

  const placed = { ...image, width: frame.width, height: frame.height, rect };

  return {
    index: 0,
    label: 'Cover',
    image: placed,
    overlaySvg: polylinesToSvg(polylines, {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      label: `${cleanName}'s colouring book cover`,
    }),
    bandHeight,
    nameLines: fitted.lines,
    nameSize: fitted.size,
    motifs: [],
    pdfPage: { polylines, image: placed, width: PAGE_WIDTH, height: PAGE_HEIGHT },
  };
}

/**
 * Generate a complete book from images.
 *
 * Six requests: one cover, five interior pages. The prompts are deterministic —
 * the same theme and name always ask for the same six pictures — but the images
 * themselves are not, so the byte-identical guarantee that holds for
 * `generateBook` does not hold here. That is the trade the user asked for.
 *
 * @param {{
 *   theme: string,
 *   name: string,
 *   apiKey: string,
 *   fetchImpl?: Function,
 *   model?: string,
 *   signal?: AbortSignal,
 * }} input
 * @returns {Promise<object>}
 */
export async function generateImageBook({ theme, name, apiKey, fetchImpl, model, signal }) {
  const result = validateInputs(theme, name);
  if (!result.ok) {
    throw new Error(result.errors.join(' '));
  }

  const plan = planBookPages(result.theme, result.name);
  const prompts = [
    buildCoverPrompt({ theme: result.theme, name: result.name }),
    ...plan.pages.map((page) => buildPagePrompt({
      theme: result.theme,
      name: result.name,
      pageIndex: page.index,
      motifs: page.motifs,
    })),
  ];

  const images = await generateImages({ apiKey, prompts, model, fetchImpl, signal });
  const [coverImage, ...pageImages] = images;

  const cover = composeImageCover({
    theme: result.theme,
    name: result.name,
    image: coverImage,
  });

  const pages = pageImages.map((image, index) => {
    const frame = jpegSize(image.bytes);
    return {
      index: index + 1,
      label: `Page ${index + 1}`,
      image: {
        ...image,
        width: frame.width,
        height: frame.height,
        rect: fitImageRect(frame.width, frame.height, PAGE_WIDTH, PAGE_HEIGHT),
      },
      motifs: plan.pages[index].motifs,
    };
  });

  const title = `${result.name}'s colouring book`;
  const pdfBytes = buildPdf(
    [
      cover.pdfPage,
      ...pages.map((page) => ({
        polylines: [],
        image: page.image,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
      })),
    ],
    { title },
  );

  return {
    title,
    theme: result.theme,
    name: result.name,
    filename: sanitiseFilename(result.name),
    mode: 'image',
    cover,
    pages,
    pdfBytes,
    costUsd: estimateImageCost(images.length),
  };
}

/**
 * What the next click will cost, said before it is clicked.
 *
 * Pure so the suite can pin the wording without a DOM. `app.js` only assigns
 * the result to a text node.
 *
 * @param {boolean} hasKey
 * @returns {string}
 */
export function costNoteText(hasKey) {
  return hasKey
    ? `${PAGE_COUNT + 1} images with ${IMAGE_MODEL}, about `
      + `$${estimateImageCost(PAGE_COUNT + 1).toFixed(2)} per book.`
    : 'No key: the book is drawn offline as vector art, at no cost.';
}

/**
 * The status line shown while the images are being drawn.
 *
 * @returns {string}
 */
export function drawingStatusText() {
  return `Drawing ${PAGE_COUNT + 1} pictures. This takes a few seconds.`;
}

/**
 * The status line shown once a book is ready.
 *
 * Vector books keep the original wording exactly, because a baseline test pins
 * it. Image books append the cost, because the user paid for it and should see
 * what it came to.
 *
 * @param {{ mode: string, pages: Array<object>, name: string, costUsd?: number }} book
 * @returns {string}
 */
export function readyStatusText(book) {
  const base = `Ready: a cover and ${book.pages.length} pages for ${book.name}.`;
  return book.mode === 'image'
    ? `${base} Cost about $${book.costUsd.toFixed(2)}.`
    : base;
}
