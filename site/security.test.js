// SEC1: the page never builds DOM from HTML strings, and the CSP from
// architecture §10 is present in the page shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const read = (f) => readFileSync(DIR + f, 'utf8');

test('no innerHTML, outerHTML, insertAdjacentHTML or document.write in site scripts', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  assert.ok(files.includes('app.js') && files.includes('render.js'));
  for (const f of files) {
    const src = read(f);
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'srcdoc']) {
      assert.ok(!src.includes(bad), `${f} contains ${bad}`);
    }
  }
});

test('index.html has the CSP meta, the data-url meta, one h1 first in main, and no inline script or style', () => {
  const html = read('index.html');
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'">`));
  assert.match(html, /<meta name="gu-data-url" content="[^"]*">/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<main[^>]*>\s*<h1\b/);
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline script');
  assert.ok(!/<style\b/.test(html) && !/\sstyle="/.test(html), 'no inline style');
  assert.ok(!/\son[a-z]+=/.test(html), 'no inline handlers');
});

test('app.js fetches with cache no-store and only from raw.githubusercontent.com', () => {
  const src = read('app.js');
  assert.match(src, /cache: 'no-store'/);
  assert.match(src, /'https:\/\/raw\.githubusercontent\.com\/'/);
});
