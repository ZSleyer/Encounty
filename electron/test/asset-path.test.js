// Checks that the encounty:// asset resolver keeps requests inside the frontend
// root. Runs on the compiled output with the Node test runner, so it needs no
// test framework and no Electron instance.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveAssetPath } = require('../dist/asset-path.js');

const ROOT = path.resolve('/opt/encounty/frontend-dist');

// pathname is what new URL(...) yields for the request, so these mirror the raw
// URLs a renderer could ask for.
const allowed = [
  ['/', ROOT],
  ['', ROOT],
  ['/index.html', path.join(ROOT, 'index.html')],
  ['/assets/app.js', path.join(ROOT, 'assets/app.js')],
  ['/assets/a%20b.css', path.join(ROOT, 'assets/a b.css')],
  // The URL parser collapses these before the handler sees them.
  ['/etc/passwd', path.join(ROOT, 'etc/passwd')],
];

const refused = [
  '/%2e%2e%2f%2e%2e%2fetc/passwd',
  '/..%2f..%2f..%2fetc/passwd',
  '/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/shadow',
  '/..%2F..%2Fetc/passwd',
  '/%2f%2e%2e%2f%2e%2e%2fetc/passwd',
  // Sibling directory sharing the root's name prefix.
  '/..%2ffrontend-dist-evil%2fx',
  '/%zz',
  '/x%00.html',
];

test('resolves paths inside the frontend root', () => {
  for (const [pathname, want] of allowed) {
    assert.strictEqual(resolveAssetPath(ROOT, pathname), want, `pathname ${pathname}`);
  }
});

test('refuses paths that escape the frontend root', () => {
  for (const pathname of refused) {
    assert.strictEqual(resolveAssetPath(ROOT, pathname), null, `pathname ${pathname}`);
  }
});
