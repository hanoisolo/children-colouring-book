#!/usr/bin/env node
/**
 * Single-file build.
 *
 * The app is ES modules, and a browser refuses to fetch a module from a
 * `file://` page because the origin is opaque. That is why the served app needs
 * `npm start`. This build removes the server from the picture: it inlines the
 * stylesheet and bundles `app.js` plus every module it imports into one classic
 * `<script>`, producing `dist/colouring-book.html` — a single file that works
 * when opened straight from disk.
 *
 * The bundler is deliberately small and dependency-free. It understands exactly
 * the module syntax this project uses: static named imports, and named exports
 * of functions, consts and classes. There are no default exports, no re-exports
 * and no dynamic imports, so a full parser would be ceremony.
 *
 * Each module becomes an immediately-invoked function returning its exports, so
 * module scopes stay separate and two modules may use the same local name
 * without colliding.
 *
 *   node build.js
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root, derived from this file's location. */
export const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Module the bundle starts from. */
export const ENTRY = 'app.js';

/** Where the single-file build is written. */
export const OUTPUT = 'dist/colouring-book.html';

const IMPORT_PATTERN = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;

const EXPORT_PREFIX = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;

const EXPORT_NAME_PATTERNS = [
  /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+const\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+let\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+var\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+class\s+([A-Za-z_$][\w$]*)/gm,
];

/**
 * A stable, collision-free identifier for a module.
 *
 * @param {string} file absolute path
 * @returns {string}
 */
export function moduleId(file) {
  const stem = relative(ROOT, file).replace(/\.js$/, '').replace(/[^A-Za-z0-9]/g, '_');
  return `__mod_${stem}`;
}

/**
 * Rewrite one module: imports become destructuring from the dependency's
 * identifier, and `export` keywords are dropped.
 *
 * @param {string} file absolute path
 * @returns {{ file: string, deps: string[], exports: string[], body: string }}
 */
export function transformModule(file) {
  const source = readFileSync(file, 'utf8');
  const deps = [];

  const body = source.replace(IMPORT_PATTERN, (match, names, specifier) => {
    const depFile = resolve(dirname(file), specifier);
    deps.push(depFile);
    const bindings = names
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => name.replace(/\s+as\s+/, ': '));
    return `const { ${bindings.join(', ')} } = ${moduleId(depFile)};`;
  });

  const exported = [];
  for (const pattern of EXPORT_NAME_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      exported.push(match[1]);
    }
  }

  return { file, deps, exports: exported, body: body.replace(EXPORT_PREFIX, '') };
}

/**
 * Walk the import graph depth-first and return the modules in dependency order.
 *
 * @param {string} entry absolute path
 * @returns {Array<{ file: string, deps: string[], exports: string[], body: string }>}
 */
export function collectModules(entry) {
  const order = [];
  const seen = new Set();

  function visit(file) {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    const mod = transformModule(file);
    for (const dep of mod.deps) {
      visit(dep);
    }
    order.push(mod);
  }

  visit(entry);
  return order;
}

/**
 * Turn the module list into one classic script.
 *
 * @param {Array<{ file: string, exports: string[], body: string }>} modules
 * @returns {string}
 */
export function bundleScript(modules) {
  const parts = modules.map((mod) => {
    const returned = mod.exports.length > 0
      ? `\n  return { ${mod.exports.join(', ')} };`
      : '';
    return `const ${moduleId(mod.file)} = (function () {\n${mod.body}${returned}\n})();`;
  });

  return `(function () {\n'use strict';\n\n${parts.join('\n\n')}\n})();`;
}

/**
 * Remove the `file://` boot-check script.
 *
 * The notice it reveals can never be true in the bundle, because everything is
 * inline, so shipping it would only be a way to show a false alarm.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripBootScript(html) {
  return html.replace(/<script>([\s\S]*?)<\/script>/g, (match, body) => (
    body.includes('__bookBooted') ? '' : match
  ));
}

/**
 * Assemble the single-file document.
 *
 * @param {{ html: string, css: string, script: string }} input
 * @returns {string}
 */
export function bundleHtml({ html, css, script }) {
  const withoutBoot = stripBootScript(html);
  const withStyle = withoutBoot.replace(
    /<link rel="stylesheet" href="styles\.css">/,
    `<style>\n${css.trim()}\n</style>`,
  );
  const safeScript = script.replace(/<\/script>/gi, '<\\/script>');
  return withStyle.replace(
    /<script type="module" src="app\.js"><\/script>/,
    `<script>\n${safeScript}\n</script>`,
  );
}

/**
 * Build the single file and write it.
 *
 * @param {{ root?: string, out?: string }} [options]
 * @returns {{ path: string, bytes: number, modules: number }}
 */
export function build({ root = ROOT, out = OUTPUT } = {}) {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
  const modules = collectModules(resolve(root, ENTRY));
  const script = bundleScript(modules);
  const document = bundleHtml({ html, css, script });

  const target = resolve(root, out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, document, 'utf8');

  return { path: target, bytes: Buffer.byteLength(document, 'utf8'), modules: modules.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = build();
  console.log(`build: wrote ${result.bytes} bytes from ${result.modules} modules to ${relative(ROOT, result.path)}`);
}
