/**
 * Gemini image generation client.
 *
 * The cheapest model in the nano-banana family is `gemini-3.1-flash-lite-image`
 * (Nano Banana 2 Lite). Google's image-generation docs call it "the fastest and
 * cheapest Gemini image workhorse model", and its list price is $0.0336 per 1K
 * image — $30 per million image output tokens, 1120 tokens per image, measured.
 * `gemini-nano-banana-2.1` costs the same at 1K but is the heavier model, and
 * `gemini-3-pro-image` is four times the price.
 *
 * The model returns `image/jpeg`, not PNG. That is not a preference: it is what
 * the endpoint does, and it is why `src/pdf.js` can embed the bytes untouched
 * with `/DCTDecode` instead of inflating and re-encoding a PNG.
 *
 * Everything here is pure except `requestImage` and `generateImages`, which take
 * an injectable `fetch` so the suite can exercise the whole path without a
 * network call.
 */

/** Cheapest nano-banana image model. */
export const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

/**
 * Where the price below comes from, and when it was read.
 *
 * The UI quotes a cost before the user spends anything, so the number it quotes
 * and the number this module bills against have to be the same number. They are
 * derived from the published rate rather than typed twice.
 */
export const IMAGE_PRICE_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing (read 2026-11-15)';

/** Image output tokens the model bills for one 1K image, measured. */
export const IMAGE_TOKENS_PER_IMAGE = 1120;

/** List price per million image output tokens, in USD. */
export const IMAGE_PRICE_PER_MTOKENS = 30;

/** List price per 1K image, in USD, derived from the two constants above. */
export const IMAGE_PRICE_USD = (IMAGE_TOKENS_PER_IMAGE / 1_000_000) * IMAGE_PRICE_PER_MTOKENS;

/** Base URL for the generateContent endpoint. */
export const IMAGE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Portrait 3:4, the closest supported ratio to A4. */
export const IMAGE_ASPECT_RATIO = '3:4';

/** Smallest and cheapest output size. */
export const IMAGE_SIZE = '1K';

/**
 * The only image types this app will render.
 *
 * The model returns JPEG. The PDF writer embeds `/DCTDecode` bytes, so a PNG
 * would produce a corrupt document, and an SVG would be markup reaching an
 * `img.src` data URL. Both are refused rather than passed through.
 */
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg']);

/** Standard base64, no data-URL prefix, no whitespace. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** A model id, with no path separators or traversal. */
const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** How many requests may be in flight at once. */
export const IMAGE_CONCURRENCY = 2;

/** Attempts per image, so one 429 does not fail a whole book. */
export const IMAGE_MAX_ATTEMPTS = 2;

/**
 * The style clause every prompt carries. A colouring page is defined by what it
 * must not contain as much as by what it must, so the negatives are explicit:
 * shading, grey, colour and lettering all ruin a page a child is meant to fill.
 */
export const LINE_ART_STYLE = [
  'A black and white colouring book page for a young child.',
  'Thick clean black outlines on pure white.',
  'No shading, no grey, no colour, no text, no lettering, no words, no numbers.',
  'Large simple shapes with generous white space to colour in.',
  'Nothing cropped at the edges.',
].join(' ');

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decode base64 into bytes without `atob` or `Buffer`, so the same code runs in
 * a browser and in Node.
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
export function base64ToBytes(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let cursor = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    const a = BASE64_LOOKUP[chunk.charCodeAt(0)];
    const b = chunk.length > 1 ? BASE64_LOOKUP[chunk.charCodeAt(1)] : -1;
    const c = chunk.length > 2 ? BASE64_LOOKUP[chunk.charCodeAt(2)] : -1;
    const d = chunk.length > 3 ? BASE64_LOOKUP[chunk.charCodeAt(3)] : -1;
    if (a < 0 || b < 0) {
      throw new Error('invalid base64 payload');
    }
    out[cursor] = (a << 2) | (b >> 4);
    cursor += 1;
    if (c >= 0) {
      out[cursor] = ((b & 15) << 4) | (c >> 2);
      cursor += 1;
    }
    if (d >= 0) {
      out[cursor] = ((c & 3) << 6) | d;
      cursor += 1;
    }
  }
  return out.subarray(0, cursor);
}

/**
 * Prompt for one interior page.
 *
 * The motif list is what makes five pages differ: the planner already chose a
 * distinct motif set per page, so the prompt inherits that variety instead of
 * asking the model for randomness it does not have.
 *
 * The child's name is deliberately not a parameter. It is drawn as vector
 * strokes by `src/lettering.js` and never needs to reach a third party, so it
 * cannot reach one by accident: there is no argument to pass it through.
 *
 * @param {{ theme: string, pageIndex: number, motifs: string[] }} input
 * @returns {string}
 */
export function buildPagePrompt({ theme, pageIndex, motifs }) {
  const subject = Array.isArray(motifs) && motifs.length > 0
    ? motifs.join(', ')
    : 'a cheerful scene';
  return [
    LINE_ART_STYLE,
    `Theme: ${String(theme).trim()}.`,
    `Draw: ${subject}.`,
    `This is page ${Number(pageIndex) + 1} of the book.`,
    'Centred composition, one clear scene, full page.',
  ].join(' ');
}

/**
 * Prompt for the cover.
 *
 * The top third is reserved and left empty on purpose: the child's name is drawn
 * there as vector strokes by `src/lettering.js`, because an image model will
 * misspell a name and a misspelled name is a defect rather than a cosmetic
 * issue. Asking for the space keeps the band from slicing artwork.
 *
 * Like `buildPagePrompt`, this takes no name. An earlier version asked the model
 * not to write the name and had to name it to do so, which sent a child's first
 * name to Google in every request. Forbidding all text achieves the same layout
 * without transmitting anything about the child.
 *
 * @param {{ theme: string }} input
 * @returns {string}
 */
export function buildCoverPrompt({ theme }) {
  return [
    LINE_ART_STYLE,
    `Theme: ${String(theme).trim()}.`,
    'This is the cover of a colouring book.',
    'Compose the illustration in the lower two thirds of the page.',
    'Leave the top third completely empty white space for a title.',
    'Do not write any text, lettering, words or numbers.',
  ].join(' ');
}

/**
 * Estimated spend for a book, in USD.
 *
 * @param {number} count
 * @returns {number}
 */
export function estimateImageCost(count) {
  const images = Number(count);
  if (!Number.isFinite(images) || images <= 0) {
    return 0;
  }
  return images * IMAGE_PRICE_USD;
}

/**
 * Build the HTTP request for one image.
 *
 * @param {{ prompt: string, model?: string, aspectRatio?: string, imageSize?: string }} input
 * @returns {{ url: string, headers: Record<string, string>, body: string }}
 */
export function buildImageRequest({ prompt, model, aspectRatio, imageSize }) {
  const resolvedModel = model ?? IMAGE_MODEL;
  // The model is interpolated into the URL path. It is never user-supplied
  // today, but a slash or a `..` here would silently retarget the request, so
  // the shape is checked rather than assumed.
  if (!MODEL_NAME_RE.test(resolvedModel)) {
    throw new Error(`unknown image model: ${resolvedModel}`);
  }
  return {
    url: `${IMAGE_ENDPOINT}/${resolvedModel}:generateContent`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: String(prompt) }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: aspectRatio ?? IMAGE_ASPECT_RATIO,
          imageSize: imageSize ?? IMAGE_SIZE,
        },
      },
    }),
  };
}

/**
 * Pull the image out of a generateContent response.
 *
 * @param {any} json
 * @returns {{ mimeType: string, base64: string, bytes: Uint8Array }}
 */
export function parseImageResponse(json) {
  const candidates = json?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const blocked = json?.promptFeedback?.blockReason;
    throw new Error(
      blocked
        ? `the image service blocked this prompt (${blocked}); try a different theme`
        : 'the image service returned no candidates',
    );
  }

  const candidate = candidates[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== 'STOP') {
    throw new Error(`the image service stopped early (${finish}); try a different theme`);
  }

  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error('the image service returned no content parts');
  }

  const imagePart = parts.find((part) => part && part.inlineData && part.inlineData.data);
  if (!imagePart) {
    throw new Error('the image service returned no image');
  }

  const { mimeType, data } = imagePart.inlineData;
  // The response is remote data that ends up in an `img.src` data URL and in a
  // PDF XObject, so it is checked rather than trusted. The model returns JPEG;
  // anything else is a surprise worth refusing rather than rendering.
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`the image service returned an unsupported type (${mimeType})`);
  }
  if (typeof data !== 'string' || !BASE64_RE.test(data) || data.length % 4 !== 0) {
    throw new Error('the image service returned malformed image data');
  }
  return {
    mimeType,
    base64: data,
    bytes: base64ToBytes(data),
  };
}

/**
 * Turn a failed HTTP response into a message a parent can act on.
 *
 * @param {number} status
 * @param {string} detail
 * @returns {Error}
 */
export function imageErrorForStatus(status, detail) {
  const suffix = detail ? ` ${detail}` : '';
  if (status === 400) {
    return new Error(`The image service rejected the request (400).${suffix}`);
  }
  if (status === 401 || status === 403) {
    return new Error(`The API key was rejected (${status}). Check it in Google AI Studio.${suffix}`);
  }
  if (status === 429) {
    return new Error(`Rate limit or quota reached (429). Wait a moment and try again.${suffix}`);
  }
  if (status >= 500) {
    return new Error(`The image service is unavailable (${status}). Try again shortly.${suffix}`);
  }
  return new Error(`The image service returned ${status}.${suffix}`);
}

function detailFromBody(text) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message;
    return typeof message === 'string' ? message.slice(0, 200) : '';
  } catch {
    return '';
  }
}

/**
 * Request one image.
 *
 * `fetch` is resolved from `globalThis` at call time rather than captured, so a
 * test can stub it after the module loads.
 *
 * @param {{ apiKey: string, prompt: string, model?: string, fetchImpl?: Function, signal?: AbortSignal }} input
 * @returns {Promise<{ mimeType: string, base64: string, bytes: Uint8Array }>}
 */
export async function requestImage({ apiKey, prompt, model, fetchImpl, signal }) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key.length === 0) {
    throw new Error('Enter a Gemini API key to generate images.');
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('This environment has no fetch, so images cannot be generated.');
  }

  const request = buildImageRequest({ prompt, model });
  let response;
  try {
    response = await doFetch(request.url, {
      method: 'POST',
      headers: { ...request.headers, 'x-goog-api-key': key },
      body: request.body,
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(
      'Could not reach the image service. If you opened this file from disk, '
        + 'run `npm start` and use http://localhost:8000 instead.',
    );
  }

  if (!response.ok) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    throw imageErrorForStatus(response.status, detailFromBody(text));
  }

  const json = await response.json();
  return parseImageResponse(json);
}

/**
 * Request one image, retrying a 429 once.
 *
 * Shared by the fail-fast and the settled generators so the retry policy cannot
 * drift between them.
 *
 * @param {{ apiKey: string, prompt: string, model?: string, fetchImpl?: Function, signal?: AbortSignal }} input
 * @returns {Promise<{ mimeType: string, base64: string, bytes: Uint8Array }>}
 */
async function requestWithRetry({ apiKey, prompt, model, fetchImpl, signal }) {
  let lastError;
  for (let attempt = 0; attempt < IMAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestImage({ apiKey, prompt, model, fetchImpl, signal });
    } catch (error) {
      lastError = error;
      const retryable = /\(429\)/.test(error?.message ?? '');
      if (!retryable || attempt === IMAGE_MAX_ATTEMPTS - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Request several images with a concurrency cap, preserving input order.
 *
 * Six parallel requests invite a 429, so at most `concurrency` are in flight and
 * a 429 is retried once before the book fails.
 *
 * This is the fail-fast form: the first unrecoverable failure rejects the whole
 * call. `generateImagesSettled` is the form that keeps going, and it is what the
 * book generator uses, because a parent who has already paid for three images
 * should not lose them to a failure on the fourth.
 *
 * @param {{ apiKey: string, prompts: string[], model?: string, fetchImpl?: Function, concurrency?: number, signal?: AbortSignal }} input
 * @returns {Promise<Array<{ mimeType: string, base64: string, bytes: Uint8Array }>>}
 */
export async function generateImages({
  apiKey,
  prompts,
  model,
  fetchImpl,
  concurrency = IMAGE_CONCURRENCY,
  signal,
}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new TypeError('generateImages expects a non-empty array of prompts');
  }

  const limit = Math.max(1, Math.min(Number(concurrency) || 1, prompts.length));
  const results = new Array(prompts.length);
  let next = 0;

  async function worker() {
    while (next < prompts.length) {
      const index = next;
      next += 1;
      results[index] = await requestWithRetry({
        apiKey,
        prompt: prompts[index],
        model,
        fetchImpl,
        signal,
      });
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Request several images, recording each slot's outcome instead of throwing.
 *
 * Returns parallel arrays: `images[i]` is the image or `null`, and `errors[i]`
 * is the failure or `null`. An abort still propagates, because a user who
 * cancelled wants the requests to stop rather than to be told which ones failed.
 *
 * @param {{ apiKey: string, prompts: string[], model?: string, fetchImpl?: Function, concurrency?: number, signal?: AbortSignal }} input
 * @returns {Promise<{ images: Array<object|null>, errors: Array<Error|null> }>}
 */
export async function generateImagesSettled({
  apiKey,
  prompts,
  model,
  fetchImpl,
  concurrency = IMAGE_CONCURRENCY,
  signal,
}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new TypeError('generateImagesSettled expects a non-empty array of prompts');
  }

  const limit = Math.max(1, Math.min(Number(concurrency) || 1, prompts.length));
  const images = new Array(prompts.length).fill(null);
  const errors = new Array(prompts.length).fill(null);
  let next = 0;

  async function worker() {
    while (next < prompts.length) {
      const index = next;
      next += 1;
      try {
        images[index] = await requestWithRetry({
          apiKey,
          prompt: prompts[index],
          model,
          fetchImpl,
          signal,
        });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw error;
        }
        errors[index] = error;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return { images, errors };
}
