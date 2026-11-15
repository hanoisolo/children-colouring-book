/**
 * DOM controller for the colouring book.
 *
 * Phase 1 scope: validate the form, resolve the theme to a motif vocabulary,
 * and render deterministic placeholder cards. The art engine and the PDF
 * writer arrive in later phases; the download button stays disabled until
 * there is a real book to download.
 *
 * The pure helpers are exported so the headless suite can exercise them
 * without a DOM. Importing this module in Node is safe: the DOM wiring only
 * runs when `document` exists.
 */

import { deriveSeed, hashString, makeRng, pickDistinct } from './src/rng.js';
import { motifsForTheme, normaliseTheme } from './src/themes.js';

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
 * Deterministic placeholder pages for the current theme and name. Each page
 * draws its own motif subset from its own derived seed, so the cards differ
 * from each other while the whole set stays reproducible.
 *
 * @param {string} theme
 * @param {string} name
 * @returns {{ seed: number, motifs: string[], matched: boolean, pages: Array<{ index: number, motifs: string[] }> }}
 */
export function buildPlaceholderPages(theme, name) {
  const { motifs, matched } = motifsForTheme(theme);
  const seed = hashString(`${normaliseTheme(theme)}\u0000${String(name).trim().toLowerCase()}`);
  const pages = [];
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const rng = makeRng(deriveSeed(seed, index));
    pages.push({ index, motifs: pickDistinct(rng, motifs, Math.min(3, motifs.length)) });
  }
  return { seed, motifs, matched, pages };
}

/**
 * Replace the preview grid with one card per book page.
 *
 * @param {HTMLElement} previewEl
 * @param {HTMLElement} bookTitle
 * @param {{ name: string }} input
 * @param {{ motifs: string[], pages: Array<{ index: number, motifs: string[] }> }} book
 */
function renderPlaceholders(previewEl, bookTitle, input, book) {
  for (const node of previewEl.querySelectorAll('[data-role="page-preview"]')) {
    node.remove();
  }

  bookTitle.textContent = `${input.name}'s colouring book`;

  const cards = [
    { index: 0, label: 'Cover', motifs: book.motifs.slice(0, 3) },
    ...book.pages.map((page) => ({
      index: page.index + 1,
      label: `Page ${page.index + 1}`,
      motifs: page.motifs,
    })),
  ];

  for (const card of cards) {
    const figure = document.createElement('figure');
    figure.className = 'page-preview';
    figure.setAttribute('data-role', 'page-preview');
    figure.setAttribute('data-page-index', String(card.index));

    const caption = document.createElement('figcaption');
    caption.textContent = card.label;

    const list = document.createElement('p');
    list.className = 'motif-list';
    list.textContent = card.motifs.join(' \u00b7 ');

    figure.append(caption, list);
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

    errorEl.textContent = '';
    const book = buildPlaceholderPages(result.theme, result.name);
    renderPlaceholders(previewEl, bookTitle, result, book);
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
