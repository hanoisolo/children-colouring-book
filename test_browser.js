/**
 * Browser smoke tests.
 *
 * The unit suite proves the pipeline; it cannot prove the page works, because
 * nothing in it loads a document. That gap shipped a build where clicking
 * Generate book did nothing: a file:// page cannot fetch an ES module, so
 * app.js never loaded and the click fell through to a native form submission.
 *
 * These tests close it. They serve the project, load smoke.html in headless
 * Chromium, and let that page drive the real index.html in an iframe. A third
 * test loads the built single file straight from disk, because the shipped
 * artifact is what a user actually opens.
 *
 * Requires a Chromium browser. There is deliberately no silent skip: a browser
 * test that quietly does nothing is how the bug above reached a user.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--user-data-dir=${profileDir}`,
        '--virtual-time-budget=15000',
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
      resolvePromise(stdout);
    });
  });
}

function readReport(dom) {
  const titleMatch = /<title>([^<]*)<\/title>/.exec(dom);
  assert.ok(titleMatch, 'the smoke page produced no title, so it never reported');
  assert.notEqual(titleMatch[1], 'PENDING', 'the smoke page never finished driving the form');
  const report = JSON.parse(decodeURIComponent(titleMatch[1]));
  assert.equal(report.failure, undefined, `the smoke page failed: ${report.failure}`);
  return report;
}

async function withServer(run) {
  const server = createStaticServer();
  await new Promise((resolvePromise) => { server.listen(0, '127.0.0.1', resolvePromise); });
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    await new Promise((resolvePromise) => { server.close(resolvePromise); });
  }
}

test('the real page generates a book in a browser', async () => {
  const browser = findBrowser();
  assert.ok(
    browser,
    'no Chromium browser found. Install Edge or Chrome, or run `node test_colouring_book.js` for the unit suite alone.',
  );

  const profileDir = mkdtempSync(join(tmpdir(), 'colouring-book-smoke-'));

  try {
    const dom = await withServer((port) => (
      dumpDom(browser, `http://127.0.0.1:${port}/smoke.html`, profileDir)
    ));
    const report = readReport(dom);

    assert.equal(report.error, '', 'the page showed an error');
    assert.match(report.status, /^Ready: a cover and 5 pages for Amara\.$/, 'the status line is wrong');
    assert.equal(report.previews, 6, 'the preview grid does not hold a cover plus five pages');
    assert.equal(report.svgs, 6, 'not every preview rendered an SVG');
    assert.equal(report.downloadDisabled, false, 'the download button stayed disabled');
    assert.equal(report.bookTitle, "Amara's colouring book", 'the book title was not written');
    assert.equal(report.bootNoticeHidden, true, 'the boot-error notice fired even though the module loaded');
    // The offline promise is that vector mode touches the network zero times.
    // smoke.html installs a counting fetch in this mode too, so this is a real
    // measurement rather than a constant.
    assert.equal(report.fetchCalls, 0, 'vector mode made a network request');
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test('the page generates an image book when a key is present', async () => {
  const browser = findBrowser();
  assert.ok(browser, 'no Chromium browser found.');

  const profileDir = mkdtempSync(join(tmpdir(), 'colouring-book-image-'));

  try {
    const dom = await withServer((port) => (
      dumpDom(browser, `http://127.0.0.1:${port}/smoke.html?mode=image`, profileDir)
    ));
    const report = readReport(dom);

    assert.equal(report.mode, 'image');
    assert.equal(report.error, '', 'the page showed an error');
    assert.equal(report.previews, 6, 'the preview grid does not hold a cover plus five pages');
    assert.equal(report.imgs, 6, 'not every preview rendered an image');
    assert.equal(report.svgs, 1, 'the cover overlay is missing or duplicated');
    assert.equal(report.downloadDisabled, false, 'the download button stayed disabled');
    assert.equal(report.bookTitle, "Amara's colouring book", 'the book title was not written');
    assert.equal(report.fetchCalls, 6, 'the page did not request six images');
    assert.match(
      report.status,
      /^Ready: a cover and 5 pages for Amara\. Cost about \$0\.20\.$/,
      'the status line does not report the cost',
    );
    assert.match(report.costNote, /\$0\.20 per book/, 'the cost note is wrong');
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test('the built single file works from disk with no server', async () => {
  const browser = findBrowser();
  assert.ok(browser, 'no Chromium browser found.');

  // Deliberately no build() here. This test exists to prove the file a user
  // actually opens works, so it must read the committed artifact. Rebuilding
  // first would test a fresh bundle and leave a stale committed one unproven —
  // which is exactly the gap this test used to have. The unit suite's
  // freshness test is what keeps the committed file honest.
  const built = readFileSync(resolve('dist/colouring-book.html'), 'utf8');

  const harness = `
<script>
(function () {
  var deadline = 8000;
  function report(data) { document.title = encodeURIComponent(JSON.stringify(data)); }
  function drive() {
    try {
      document.getElementById('theme-input').value = 'space dinosaurs';
      document.getElementById('name-input').value = 'Amara';
      document.getElementById('generate-btn').click();
    } catch (e) { report({ failure: 'drive: ' + e.message }); return; }
    setTimeout(function () {
      report({
        status: document.getElementById('status').textContent,
        error: document.getElementById('error').textContent,
        previews: document.querySelectorAll('#preview [data-role="page-preview"]').length,
        svgs: document.querySelectorAll('#preview svg').length,
        downloadDisabled: document.getElementById('download-btn').disabled,
        bookTitle: document.getElementById('book-title').textContent
      });
    }, 800);
  }
  var waited = 0;
  function tick() {
    if (window.__bookBooted) { drive(); return; }
    waited += 50;
    if (waited > deadline) { report({ failure: 'never booted' }); return; }
    setTimeout(tick, 50);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
})();
</script>
`;

  const dir = mkdtempSync(join(tmpdir(), 'colouring-book-dist-'));
  const file = join(dir, 'colouring-book.html');
  writeFileSync(file, built.replace('</body>', `${harness}</body>`), 'utf8');

  try {
    const dom = await dumpDom(browser, pathToFileURL(file).href, join(dir, 'profile'));
    const report = readReport(dom);

    assert.equal(report.error, '', 'the built page showed an error');
    assert.match(report.status, /^Ready: a cover and 5 pages for Amara\.$/, 'the status line is wrong');
    assert.equal(report.previews, 6, 'the built page did not render six previews');
    assert.equal(report.svgs, 6, 'the built page did not render six SVGs');
    assert.equal(report.downloadDisabled, false, 'the built page left the download disabled');
    assert.equal(report.bookTitle, "Amara's colouring book", 'the built page did not write the title');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
