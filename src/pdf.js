/**
 * Minimal PDF 1.4 writer.
 *
 * Consumes the same polyline IR the SVG writer uses — top-down A4 user units,
 * `closed`, `fill`, `stroke`, and `width` in points — and returns a
 * `Uint8Array`. This is the only module that flips Y: the IR stays top-down
 * everywhere else, so the preview and the print cannot drift apart.
 *
 * A page may also carry a JPEG image. The image is embedded as a `/DCTDecode`
 * XObject with its original bytes untouched, because the Gemini image model
 * returns `image/jpeg` and re-encoding it would only lose quality. Vector
 * polylines draw on top of the image, which is how the cover puts the child's
 * name over a generated illustration.
 *
 * Three details are load-bearing and easy to get wrong:
 *
 * 1. **Byte offsets.** The cross-reference table stores the byte offset of every
 *    object. Mixing JS string lengths with multi-byte bytes shifts every
 *    subsequent offset, so the document is assembled as an array of byte chunks
 *    and offsets are accumulated from `chunk.length`, never from a string.
 * 2. **Fill colour.** PDF's default fill colour is black, so a `B` operator
 *    without an explicit `1 1 1 rg` would paint a filled shape solid black. The
 *    fill colour is set to white once per page and never changed.
 * 3. **Graphics state.** `cm` permanently alters the current transformation
 *    matrix, so the image is drawn inside `q`/`Q`. Without that, every polyline
 *    after the image would be scaled by the image's placement matrix.
 *
 * `B` implicitly closes an open path, which would silently change the shape of a
 * `fill: true, closed: false` polyline. Both this writer and the SVG writer
 * therefore close a path whenever it is closed *or* filled, so the two renderers
 * agree on the geometry.
 */

/** PDF version this writer emits. */
export const PDF_VERSION = '1.4';

/** A4 portrait media box in PostScript points. */
export const MEDIA_BOX = Object.freeze([0, 0, 595.28, 841.89]);

/** Thinnest stroke this writer will emit, in points. */
export const MIN_STROKE_WIDTH = 4;

/** Start-of-frame markers that carry the frame dimensions. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function formatNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function asciiBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      throw new Error(`non-ASCII character in PDF structure: ${JSON.stringify(text[i])}`);
    }
    out[i] = code;
  }
  return out;
}

/**
 * Read the frame dimensions out of a JPEG.
 *
 * Segments are walked by their declared length, so an EXIF thumbnail's own
 * start-of-frame marker — which lives inside the APP1 payload — is never
 * mistaken for the main frame. That is the whole reason this is a parser and not
 * a byte scan.
 *
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, components: number }}
 */
export function jpegSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    throw new TypeError('jpegSize expects a Uint8Array of JPEG bytes');
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('not a JPEG: missing the SOI marker');
  }

  let cursor = 2;
  while (cursor + 3 < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    const marker = bytes[cursor + 1];

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      cursor += 2;
      continue;
    }

    // A start-of-scan means the frame header was never found.
    if (marker === 0xda) {
      break;
    }

    const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    if (length < 2) {
      throw new Error('malformed JPEG: segment length below 2');
    }

    if (SOF_MARKERS.has(marker)) {
      if (cursor + 9 >= bytes.length) {
        throw new Error('malformed JPEG: truncated frame header');
      }
      return {
        height: (bytes[cursor + 5] << 8) | bytes[cursor + 6],
        width: (bytes[cursor + 7] << 8) | bytes[cursor + 8],
        components: bytes[cursor + 9],
      };
    }

    cursor += 2 + length;
  }

  throw new Error('malformed JPEG: no start-of-frame marker');
}

/**
 * Centre an image on a page without distorting it.
 *
 * One function, used by the PDF placement matrix and by the browser preview, so
 * the printed page and the on-screen page cannot disagree about where the
 * artwork sits.
 *
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} [pageWidth]
 * @param {number} [pageHeight]
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function fitImageRect(imageWidth, imageHeight, pageWidth = MEDIA_BOX[2], pageHeight = MEDIA_BOX[3]) {
  const iw = Number(imageWidth);
  const ih = Number(imageHeight);
  if (!Number.isFinite(iw) || !Number.isFinite(ih) || iw <= 0 || ih <= 0) {
    throw new TypeError('fitImageRect expects positive image dimensions');
  }
  const scale = Math.min(pageWidth / iw, pageHeight / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, w, h };
}

/**
 * Encode a document-info string. Plain ASCII becomes a literal string; anything
 * else becomes a UTF-16BE hex string with a byte-order mark, because a raw UTF-8
 * literal would be read as PDFDocEncoding and mangle names like `Zoë`.
 *
 * @param {string} value
 * @returns {string}
 */
export function pdfTextString(value) {
  const text = String(value);
  if (/^[\x20-\x7e]*$/.test(text)) {
    return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;
  }
  let hex = 'FEFF';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code > 0xffff) {
      const offset = code - 0x10000;
      hex += (0xd800 + (offset >> 10)).toString(16).padStart(4, '0').toUpperCase();
      hex += (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, '0').toUpperCase();
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // A lone surrogate is not a code point. Emitting it verbatim would write
      // ill-formed UTF-16BE, so substitute the replacement character.
      hex += 'FFFD';
    } else {
      hex += code.toString(16).padStart(4, '0').toUpperCase();
    }
  }
  return `<${hex}>`;
}

/**
 * Build one page's content stream.
 *
 * @param {{
 *   polylines?: Array<object>,
 *   image?: { rect?: { x: number, y: number, w: number, h: number } },
 *   width?: number,
 *   height?: number,
 * }} page
 * @returns {string}
 */
export function pageContentStream(page) {
  const width = page.width ?? MEDIA_BOX[2];
  const height = page.height ?? MEDIA_BOX[3];
  const lines = [
    '1 1 1 rg',
    `0 0 ${formatNumber(width)} ${formatNumber(height)} re`,
    'f',
  ];

  if (page.image) {
    const rect = page.image.rect ?? fitImageRect(
      page.image.width ?? width,
      page.image.height ?? height,
      width,
      height,
    );
    // `cm` is not scoped, so the image placement is wrapped in q/Q. Without it
    // every polyline below would inherit the image's matrix.
    lines.push('q');
    lines.push(
      `${formatNumber(rect.w)} 0 0 ${formatNumber(rect.h)}`
        + ` ${formatNumber(rect.x)} ${formatNumber(height - rect.y - rect.h)} cm`,
    );
    lines.push('/Im0 Do');
    lines.push('Q');
  }

  lines.push('0 0 0 RG');
  lines.push('1 J');
  lines.push('1 j');

  for (const line of page.polylines ?? []) {
    if (!Array.isArray(line.points) || line.points.length < 2) {
      continue;
    }
    const strokeWidth = Math.max(MIN_STROKE_WIDTH, line.width ?? MIN_STROKE_WIDTH);
    lines.push(`${formatNumber(strokeWidth)} w`);
    const [first, ...rest] = line.points;
    lines.push(`${formatNumber(first[0])} ${formatNumber(height - first[1])} m`);
    for (const [x, y] of rest) {
      lines.push(`${formatNumber(x)} ${formatNumber(height - y)} l`);
    }
    if (line.closed || line.fill) {
      lines.push('h');
    }
    if (line.fill && line.stroke === false) {
      // A fill with no stroke: the white band behind the cover name. `B` would
      // outline it in black.
      lines.push('f');
    } else {
      lines.push(line.fill ? 'B' : 'S');
    }
  }

  return lines.join('\n');
}

/**
 * Build a complete PDF document.
 *
 * Object numbers are allocated rather than hardcoded, because a page that
 * carries an image needs an extra object. The allocation order keeps the
 * vector-only numbering identical to the original writer — catalog 1, pages 2,
 * then a page/content pair per page, then any image objects, then the info
 * dictionary — so a book without images produces the same document it always
 * did.
 *
 * @param {Array<{
 *   polylines?: Array<object>,
 *   image?: { bytes: Uint8Array, width?: number, height?: number, rect?: object },
 *   width?: number,
 *   height?: number,
 * }>} pages
 * @param {{ title?: string, producer?: string }} [options]
 * @returns {Uint8Array}
 */
export function buildPdf(pages, options = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new TypeError('buildPdf expects a non-empty array of pages');
  }

  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (bytes) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  push(asciiBytes(`%PDF-${PDF_VERSION}\n`));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageCount = pages.length;
  const catalogNumber = 1;
  const pagesNumber = 2;
  const pageNumbers = pages.map((_, index) => 3 + 2 * index);
  const contentNumbers = pages.map((_, index) => 4 + 2 * index);
  const firstImageNumber = 3 + 2 * pageCount;
  const imageNumbers = [];
  let nextImageNumber = firstImageNumber;
  for (const page of pages) {
    if (page.image) {
      imageNumbers.push(nextImageNumber);
      nextImageNumber += 1;
    } else {
      imageNumbers.push(0);
    }
  }
  const infoNumber = nextImageNumber;
  const size = infoNumber + 1;

  offsets[catalogNumber] = offset;
  push(asciiBytes(`${catalogNumber} 0 obj\n<< /Type /Catalog /Pages ${pagesNumber} 0 R >>\nendobj\n`));

  const kids = pageNumbers.map((number) => `${number} 0 R`).join(' ');
  offsets[pagesNumber] = offset;
  push(asciiBytes(
    `${pagesNumber} 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`,
  ));

  pages.forEach((page, index) => {
    const pageNumber = pageNumbers[index];
    const contentNumber = contentNumbers[index];
    const imageNumber = imageNumbers[index];
    const content = asciiBytes(pageContentStream(page));
    const width = formatNumber(page.width ?? MEDIA_BOX[2]);
    const height = formatNumber(page.height ?? MEDIA_BOX[3]);
    const resources = imageNumber > 0
      ? `<< /XObject << /Im0 ${imageNumber} 0 R >> >>`
      : '<< >>';

    offsets[pageNumber] = offset;
    push(
      asciiBytes(
        `${pageNumber} 0 obj\n<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${width} ${height}]`
          + ` /Resources ${resources} /Contents ${contentNumber} 0 R >>\nendobj\n`,
      ),
    );

    offsets[contentNumber] = offset;
    push(asciiBytes(`${contentNumber} 0 obj\n<< /Length ${content.length} >>\nstream\n`));
    push(content);
    push(asciiBytes('\nendstream\nendobj\n'));
  });

  pages.forEach((page, index) => {
    const imageNumber = imageNumbers[index];
    if (imageNumber === 0) {
      return;
    }
    const bytes = page.image.bytes;
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('a page image must be a Uint8Array of JPEG bytes');
    }
    const frame = jpegSize(bytes);
    const imageWidth = page.image.width ?? frame.width;
    const imageHeight = page.image.height ?? frame.height;
    const colorSpace = frame.components === 1 ? '/DeviceGray' : '/DeviceRGB';

    offsets[imageNumber] = offset;
    push(asciiBytes(
      `${imageNumber} 0 obj\n<< /Type /XObject /Subtype /Image`
        + ` /Width ${imageWidth} /Height ${imageHeight}`
        + ` /ColorSpace ${colorSpace} /BitsPerComponent 8`
        + ` /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
    ));
    push(bytes);
    push(asciiBytes('\nendstream\nendobj\n'));
  });

  const title = options.title ?? 'Colouring Book';
  const producer = options.producer ?? 'children-colouring-book';
  offsets[infoNumber] = offset;
  push(
    asciiBytes(
      `${infoNumber} 0 obj\n<< /Title ${pdfTextString(title)} /Producer ${pdfTextString(producer)} >>\nendobj\n`,
    ),
  );

  const xrefOffset = offset;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let number = 1; number < size; number += 1) {
    xref += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  push(asciiBytes(xref));

  push(
    asciiBytes(
      `trailer\n<< /Size ${size} /Root ${catalogNumber} 0 R /Info ${infoNumber} 0 R >>\n`
        + `startxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const document = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    document.set(chunk, cursor);
    cursor += chunk.length;
  }
  return document;
}
