/**
 * Live end-to-end check against the real Gemini image API.
 *
 * Not part of the suite: it costs about $0.20 and needs a key. Run it by hand
 * after changing the image pipeline, to prove the stubbed tests still describe
 * the real service.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { generateImageBook, readyStatusText, costNoteText } from '../src/book.js';
import { IMAGE_MODEL, IMAGE_PRICE_USD } from '../src/imagegen.js';
import { jpegSize } from '../src/pdf.js';

function readKey() {
  const envPath = join(homedir(), '.vibe', '.env');
  const text = readFileSync(envPath, 'utf8');
  const match = /^\s*GEMINI_API_KEY\s*=\s*(.+)$/m.exec(text);
  if (!match) {
    throw new Error('GEMINI_API_KEY not found in ~/.vibe/.env');
  }
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const key = readKey();
console.log(`key loaded: ${key.length} chars (not printed)`);
console.log(`model: ${IMAGE_MODEL} at $${IMAGE_PRICE_USD} per image`);
console.log(`cost note: ${costNoteText(true)}`);

const started = Date.now();
const book = await generateImageBook({
  theme: 'space dinosaurs',
  name: 'Amara',
  apiKey: key,
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\ngenerated in ${elapsed}s`);
console.log(`mode: ${book.mode}`);
console.log(`pages: ${book.pages.length}`);
console.log(`title: ${book.title}`);
console.log(`filename: ${book.filename}`);
console.log(`cost: $${book.costUsd.toFixed(4)}`);
console.log(`status: ${readyStatusText(book)}`);
console.log(`pdf: ${book.pdfBytes.length} bytes`);

// Every page image must be a real JPEG the PDF writer can embed.
for (const page of book.pages) {
  const frame = jpegSize(page.image.bytes);
  console.log(`  page ${page.index}: ${frame.width}x${frame.height}, ${frame.components} components, ${page.image.bytes.length} bytes, ${page.image.mimeType}`);
}

// The PDF must carry one DCTDecode XObject per image and a valid xref.
const pdfText = new TextDecoder('latin1').decode(book.pdfBytes);
const dct = (pdfText.match(/\/DCTDecode/g) || []).length;
const xrefRows = (pdfText.match(/^\d{10} \d{5} n\s*$/gm) || []).length;
console.log(`\nDCTDecode XObjects: ${dct} (expected 6)`);
console.log(`xref rows: ${xrefRows} (expected 22)`);

// The key must not be anywhere in the artifact.
if (pdfText.includes(key)) {
  throw new Error('THE KEY LEAKED INTO THE PDF');
}
console.log('key absent from the PDF: yes');

// The cover must leave the top third clear for the name band.
const cover = book.cover;
console.log(`cover band height: ${cover.bandHeight} pt of ${cover.pdfPage.height} pt`);

if (dct !== 6) throw new Error(`expected 6 DCTDecode XObjects, found ${dct}`);
if (book.pages.length !== 5) throw new Error('expected 5 pages');
if (book.costUsd <= 0) throw new Error('cost was not recorded');

console.log('\nLIVE: PASS');
