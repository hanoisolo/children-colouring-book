/**
 * DOM controller for the colouring book.
 *
 * Phase 2 scope: validate the form, plan the motif assignment for each page,
 * compose the cover and five interior pages as polylines, and render them as
 * inline SVG previews. The PDF writer arrives in Phase 3; the download button
 * stays disabled until there is a real file to download.
 *
 * The pure helpers are exported so the headless suite can exercise them
 * without a DOM. Importing this module in Node is safe: the DOM wiring only
 * runs when `document` exists.
 */

import { deriveSeed, hashString, makeRng, pick, pickDistinct, randInt, shuffle } from './src/rng.js';
import { motifsForTheme, normaliseTheme } from './src/themes.js';
import { MOTIF_NAMES } from './src/motifs.js';
import { hasGlyph } from './src/lettering.js';
import { MAX_PAGE_MOTIFS, MIN_PAGE_MOTIFS, composePage, pageToSvg } from './src/page.js';
import { composeCover, coverToSvg } from './src/cover.js';

export const MAX_THEME_LENGTH = 60;
export const MAX_NAME_LENGTH = 20;
export const PAGE_COUNT = 5;

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
 * Compose the whole book as SVG strings: one cover plus `PAGE_COUNT` pages.
 *
 * @param {string} theme
 * @param {string} name
 * @returns {{
 *   seed: number,
 *   motifs: string[],
 *   matched: boolean,
 *   cover: { index: number, label: string, svg: string },
 *   pages: Array<{ index: number, label: string, svg: string }>,
 * }}
 */
export function buildPreviewPages(theme, name) {
  const book = planBookPages(theme, name);
  const cover = composeCover(theme, name);

  const pages = book.pages.map((page) => {
    const composed = composePage(theme, name, page.index, { motifs: page.motifs });
    return {
      index: page.index + 1,
      label: `Page ${page.index + 1}`,
      svg: pageToSvg(composed),
    };
  });

  return {
    seed: book.seed,
    motifs: book.motifs,
    matched: book.matched,
    cover: { index: 0, label: 'Cover', svg: coverToSvg(cover) },
    pages,
  };
}

/**
 * Replace the preview grid with one card per book page.
 *
 * @param {HTMLElement} previewEl
 * @param {HTMLElement} bookTitle
 * @param {{ name: string }} input
 * @param {ReturnType<typeof buildPreviewPages>} book
 */
function renderPreviews(previewEl, bookTitle, input, book) {
  for (const node of previewEl.querySelectorAll('[data-role="page-preview"]')) {
    node.remove();
  }

  bookTitle.textContent = `${input.name}'s colouring book`;

  for (const card of [book.cover, ...book.pages]) {
    const figure = document.createElement('figure');
    figure.className = 'page-preview';
    figure.setAttribute('data-role', 'page-preview');
    figure.setAttribute('data-page-index', String(card.index));
    figure.innerHTML = card.svg;

    const svg = figure.firstElementChild;
    if (svg && svg.tagName.toLowerCase() === 'svg') {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }

    const caption = document.createElement('figcaption');
    caption.textContent = card.label;

    figure.append(caption);
    previewEl.append(figure);
  }
}

function init() {
  const themeInput = document.getElementById('theme-input');
  const nameInput = document.getElementById('name-input');
  const generateBtn = document.getElementById('generate-btn');
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const previewEl = document.getElementById('preview');
  const downloadBtn = document.getElementById('download-btn');
  const bookTitle = document.getElementById('book-title');

  const form = themeInput.form;
  if (!form) {
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const result = validateInputs(themeInput.value, nameInput.value);
    if (!result.ok) {
      errorEl.textContent = result.errors.join(' ');
      statusEl.textContent = '';
      downloadBtn.disabled = true;
      return;
    }

    let book;
    try {
      book = buildPreviewPages(result.theme, result.name);
    } catch (error) {
      errorEl.textContent = error.message;
      statusEl.textContent = '';
      downloadBtn.disabled = true;
      return;
    }

    errorEl.textContent = '';
    renderPreviews(previewEl, bookTitle, result, book);
    statusEl.textContent = `Preview ready for ${result.name}: a cover and ${book.pages.length} pages.`;
    downloadBtn.disabled = true;
    generateBtn.setAttribute('aria-busy', 'false');
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
