/**
 * Zero-dependency static file server for local development.
 *
 * The app is ES modules, and a browser refuses to fetch a module from a
 * `file://` page — the origin is opaque, so the request is a CORS failure. That
 * is why opening `index.html` straight from disk does nothing. This is the
 * smallest thing that serves it properly.
 *
 *   npm start
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Map a request path onto a file inside `root`, or `null` if it escapes.
 *
 * @param {string} root
 * @param {string} requestPath
 * @returns {string | null}
 */
export function resolveRequestPath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const requested = decoded === '/' ? '/index.html' : decoded;
  const target = normalize(join(root, requested));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(prefix) ? target : null;
}

/**
 * @param {string} [root]
 * @returns {import('node:http').Server}
 */
export function createStaticServer(root = ROOT) {
  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const target = resolveRequestPath(root, pathname);

    if (!target) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }

    try {
      const body = await readFile(target);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8000);
  createStaticServer().listen(port, '127.0.0.1', () => {
    console.log(`Serving ${ROOT} at http://localhost:${port}`);
  });
}
