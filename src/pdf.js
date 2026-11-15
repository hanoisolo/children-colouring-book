/**
 * Minimal PDF 1.4 writer.
 *
 * Consumes the same polyline IR the SVG writer uses — top-down A4 user units,
 * `closed`, `fill`, and `width` in points — and returns a `Uint8Array`. This is
 * the only module that flips Y: the IR stays top-down everywhere else, so the
 * preview and the print cannot drift apart.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 * 1. **Byte offsets.** The cross-reference table stores the byte offset of every
 *    object. Mixing JS string lengths with multi-byte bytes shifts every
 *    subsequent offset, so the document is assembled as an array of byte chunks
 *    and offsets are accumulated from `chunk.length`, never from a string.
 * 2. **Fill colour.** PDF's default fill colour is black, so a `B` operator
 *    without an explicit `1 1 1 rg` would paint a filled shape solid black. The
 *    fill colour is set to white once per page and never changed.
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
    } else {
      hex += code.toString(16).padStart(4, '0').toUpperCase();
    }
  }
  return `<${hex}>`;
}

/**
 * Build one page's content stream.
 *
 * @param {{ polylines: Array<object>, width?: number, height?: number }} page
 * @returns {string}
 */
export function pageContentStream(page) {
  const width = page.width ?? MEDIA_BOX[2];
  const height = page.height ?? MEDIA_BOX[3];
  const lines = [
    '1 1 1 rg',
    `0 0 ${formatNumber(width)} ${formatNumber(height)} re`,
    'f',
    '0 0 0 RG',
    '1 J',
    '1 j',
  ];

  for (const line of page.polylines) {
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
    lines.push(line.fill ? 'B' : 'S');
  }

  return lines.join('\n');
}

/**
 * Build a complete PDF document.
 *
 * @param {Array<{ polylines: Array<object>, width?: number, height?: number }>} pages
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
  const infoNumber = 2 * pageCount + 3;
  const size = infoNumber + 1;

  offsets[1] = offset;
  push(asciiBytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));

  const kids = pages.map((_, index) => `${3 + 2 * index} 0 R`).join(' ');
  offsets[2] = offset;
  push(asciiBytes(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`));

  pages.forEach((page, index) => {
    const pageNumber = 3 + 2 * index;
    const contentNumber = pageNumber + 1;
    const content = asciiBytes(pageContentStream(page));
    const width = formatNumber(page.width ?? MEDIA_BOX[2]);
    const height = formatNumber(page.height ?? MEDIA_BOX[3]);

    offsets[pageNumber] = offset;
    push(
      asciiBytes(
        `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]` +
          ` /Resources << >> /Contents ${contentNumber} 0 R >>\nendobj\n`,
      ),
    );

    offsets[contentNumber] = offset;
    push(asciiBytes(`${contentNumber} 0 obj\n<< /Length ${content.length} >>\nstream\n`));
    push(content);
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
      `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoNumber} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
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
