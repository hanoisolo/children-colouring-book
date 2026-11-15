/**
 * Browser smoke test.
 *
 * The unit suite proves the pipeline; it cannot prove the page works, because
 * nothing in it loads a document. That gap shipped a build where clicking
 * Generate book did nothing: a file:// page cannot fetch an ES module, so
 * app.js never loaded and the click fell through to a native form submission.
 *
 * This test closes it. It serves the project, loads smoke.html in headless
 * Chromium, and lets that page drive the real index.html in an iframe.
 *
 * Requires a Chromium browser. There is deliberately no silent skip: a browser
 * test that quietly does nothing is how the bug above reached a user.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStaticServer } from './serve.js';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const BROWSER_TIMEOUT_MS = 60000;

function findBrowser() {
  return BROWSERS.find((candidate) => existsSync(candidate)) ?? null;
}

function dumpDom(browser, url, profileDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--user-data-dir=${profileDir}`,
        '--virtual-time-budget=10000',
        '--dump-dom',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`browser did not finish within ${BROWSER_TIMEOUT_MS}ms`));
    }, BROWSER_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (stdout.trim().length === 0) {
        reject(new Error(`browser produced no DOM. stderr: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

test('the real page generates a book in a browser', async () => {
  const browser = findBrowser();
  assert.ok(
    browser,
    'no Chromium browser found. Install Edge or Chrome, or run `node test_colouring_book.js` for the unit suite alone.',
  );

  const server = createStaticServer();
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  const profileDir = mkdtempSync(join(tmpdir(), 'colouring-book-smoke-'));

  try {
    const dom = await dumpDom(browser, `http://127.0.0.1:${port}/smoke.html`, profileDir);

    const titleMatch = /<title>([^<]*)<\/title>/.exec(dom);
    assert.ok(titleMatch, 'the smoke page produced no title, so it never reported');
    assert.notEqual(titleMatch[1], 'PENDING', 'the smoke page never finished driving the form');

    const report = JSON.parse(decodeURIComponent(titleMatch[1]));
    assert.equal(report.failure, undefined, `the smoke page failed: ${report.failure}`);

    assert.equal(report.error, '', 'the page showed an error');
    assert.match(report.status, /^Ready: a cover and 5 pages for Amara\.$/, 'the status line is wrong');
    assert.equal(report.previews, 6, 'the preview grid does not hold a cover plus five pages');
    assert.equal(report.svgs, 6, 'not every preview rendered an SVG');
    assert.equal(report.downloadDisabled, false, 'the download button stayed disabled');
    assert.equal(report.bookTitle, "Amara's colouring book", 'the book title was not written');
    assert.equal(report.bootNoticeHidden, true, 'the boot-error notice fired even though the module loaded');
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
    rmSync(profileDir, { recursive: true, force: true });
  }
});
