import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectMeta, escapeAttr } from './meta-inject.js';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const count = (s, re) => (s.match(re) || []).length;

test('F2: a hostile contact stays inside one attribute and adds no element', () => {
  const evil = `"><meta http-equiv="refresh" content="0;url=https://evil.example"><script>alert(1)</script>'`;
  const out = injectMeta(html, { dataUrl: 'https://raw.githubusercontent.com/o/r/monitor-data/status.json',
    repo: 'o/r', siteName: evil, contact: evil, contactLink: evil });
  assert.equal(count(out, /<meta name="gu-contact"/g), 1);
  assert.equal(count(out, /<meta\b/g), count(html, /<meta\b/g), 'no new meta element');
  assert.equal(count(out, /<script\b/g), count(html, /<script\b/g), 'no new script element');
  assert.equal(count(out, /http-equiv="refresh"/g), 0);
  assert.ok(out.includes(`<meta name="gu-contact" content="${escapeAttr(evil)}">`));
  assert.ok(!/[<>"]/.test(escapeAttr(evil).replace(/&(amp|lt|gt|quot|#39);/g, '')));
});

test('unset values keep the placeholder; the page treats that as not set', () => {
  const out = injectMeta(html, { dataUrl: 'https://raw.githubusercontent.com/o/r/monitor-data/status.json' });
  assert.ok(out.includes('content="https://raw.githubusercontent.com/o/r/monitor-data/status.json"'));
  assert.ok(out.includes('content="%GU_CONTACT%"'));
  assert.throws(() => injectMeta(html, { contact: '%GU_X%' }));
  assert.throws(() => injectMeta(html, { contact: 5 }));
  assert.throws(() => injectMeta('<p>no placeholders</p>', {}));
});

test('replacement patterns like $& in values are inserted literally', () => {
  const out = injectMeta(html, { contact: 'Pay $& now $1' });
  assert.ok(out.includes('content="Pay $&amp; now $1"'));
});
