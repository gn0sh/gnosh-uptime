import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, deriveIntervalMinutes, contactLinksOk, formatError } from '../src/config.js';
import { parseJson, JsonSyntaxError } from '../src/jsonloc.js';

const WF = "on:\n  schedule:\n    - cron: '7,22,37,52 * * * *'\n  workflow_dispatch:\n";
const cfg = (obj) => JSON.stringify(obj, null, 2);
const t = (name, url = `https://${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com/`) => ({ name, url });

test('valid minimal config uses defaults and the derived interval', () => {
  const r = parseConfig(cfg({ targets: [t('Blog')] }), WF);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.targets, [{ name: 'Blog', url: 'https://blog.example.com/' }]);
  assert.equal(r.settings.intervalMinutes, 15);
  assert.equal(r.settings.failuresBeforeAlert, 2);
  assert.equal(r.settings.timeoutMs, 10000);
  assert.equal(r.settings.staleAfterMinutes, 60);
  assert.equal(r.settings.contact, null);
});

test('the shipped example config is valid', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../monitor.config.json', import.meta.url), 'utf8');
  const r = parseConfig(text, WF);
  assert.deepEqual(r.errors, []);
});

test('21 targets: the 21st is invalid, the first 20 are checked', () => {
  const targets = Array.from({ length: 21 }, (_, k) => t(`Site ${k + 1}`));
  const r = parseConfig(cfg({ targets }), WF);
  assert.equal(r.targets.length, 20);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].index, 21);
  assert.match(r.errors[0].reason, /Only 20 sites/);
  assert.match(r.errors[0].entry, /Site #21 "Site 21"/);
  assert.ok(r.errors[0].line > 1);
});

test('duplicate names are rejected case-insensitively', () => {
  const r = parseConfig(cfg({ targets: [t('Shop'), { name: ' shop ', url: 'https://other.example.com/' }] }), WF);
  assert.equal(r.targets.length, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /already uses this name/);
  assert.equal(r.errors[0].index, 2);
});

test('cron */3 is an error and 15 is assumed; 7,22,37,52 gives 15', () => {
  const bad = parseConfig(cfg({ targets: [t('A')] }), "    - cron: '*/3 * * * *'\n");
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].reason, /more often than every 5 minutes/);
  assert.equal(bad.settings.intervalMinutes, 15);
  assert.equal(deriveIntervalMinutes(WF), 15);
});

test('deriveIntervalMinutes cases', () => {
  assert.equal(deriveIntervalMinutes("- cron: '*/5 * * * *'"), 5);
  assert.equal(deriveIntervalMinutes('- cron: "*/7 * * * *"'), 7);
  assert.equal(deriveIntervalMinutes("- cron: '0 * * * *'"), 60);
  assert.equal(deriveIntervalMinutes("- cron: '10-50/20 * * * *'"), 20);
  assert.equal(deriveIntervalMinutes("- cron: '0,30 * * * *'\n- cron: '15,45 * * * *'"), 15);
  assert.equal(deriveIntervalMinutes("- cron: '0 */2 * * *'"), null);
  assert.equal(deriveIntervalMinutes('no schedule here'), null);
  assert.equal(deriveIntervalMinutes("- cron: '61 * * * *'"), null);
  assert.equal(deriveIntervalMinutes(null), null);
});

test('unparseable cron is a config error', () => {
  const r = parseConfig(cfg({ targets: [t('A')] }), "    - cron: '0 3 * * 1'\n");
  assert.match(r.errors[0].reason, /could not be read/);
  assert.equal(r.settings.intervalMinutes, 15);
});

test('missing workflow file uses the default interval without an error', () => {
  const r = parseConfig(cfg({ targets: [t('A')] }), null);
  assert.equal(r.ok, true);
  assert.equal(r.settings.intervalMinutes, 15);
});

test('staleAfterMinutes below 2 x interval is an error', () => {
  const r = parseConfig(cfg({ staleAfterMinutes: 29, targets: [t('A')] }), WF);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].entry, 'Setting "staleAfterMinutes"');
  assert.equal(r.settings.staleAfterMinutes, 60);
  assert.equal(parseConfig(cfg({ staleAfterMinutes: 30, targets: [t('A')] }), WF).ok, true);
  assert.equal(parseConfig(cfg({ staleAfterMinutes: 1441, targets: [t('A')] }), WF).ok, false);
});

test('contact: http: and javascript: are errors; https:, mailto: and 10:30 are ok', () => {
  for (const c of ['See http://example.com', 'javascript:alert(1)', 'Click JavaScript:void(0)', 'ftp://x.example']) {
    const r = parseConfig(cfg({ contact: c, targets: [t('A')] }), WF);
    assert.equal(r.ok, false, c);
    assert.match(r.errors[0].reason, /https:\/\/ or mailto:/);
  }
  for (const c of ['Email mailto:help@example.com', 'See https://example.com/help', 'Open 10:30 to 17:00', 'Note: we reply fast', 'Questions? Email help@example.com']) {
    const r = parseConfig(cfg({ contact: c, targets: [t('A')] }), WF);
    assert.equal(r.ok, true, c);
    assert.equal(r.settings.contact, c);
  }
  assert.equal(contactLinksOk('data:text/html,x'), false);
});

test('contact longer than 200 chars, and with a newline, are errors', () => {
  assert.equal(parseConfig(cfg({ contact: 'x'.repeat(201), targets: [t('A')] }), WF).ok, false);
  assert.equal(parseConfig(cfg({ contact: 'x'.repeat(200), targets: [t('A')] }), WF).ok, true);
  assert.equal(parseConfig(cfg({ contact: 'a\nb', targets: [t('A')] }), WF).ok, false);
});

test('contactLink must be https: or mailto:', () => {
  assert.equal(parseConfig(cfg({ contactLink: 'mailto:help@example.com', targets: [t('A')] }), WF).settings.contactLink, 'mailto:help@example.com');
  assert.equal(parseConfig(cfg({ contactLink: 'https://example.com/help', targets: [t('A')] }), WF).ok, true);
  for (const l of ['http://example.com', 'javascript:alert(1)', 'nope', 42]) {
    assert.equal(parseConfig(cfg({ contactLink: l, targets: [t('A')] }), WF).ok, false, String(l));
  }
});

test('unknown keys are errors, at top level and in targets; "//" note keys are allowed', () => {
  const r = parseConfig(cfg({ timeout: 5, targets: [{ name: 'A', url: 'https://a.example.com/', urll: 'x' }] }), WF);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].entry, /timeout/);
  assert.match(r.errors[1].reason, /not a known setting for a site/);
  assert.equal(r.targets.length, 0);
  assert.equal(parseConfig(cfg({ '//': 'my notes', targets: [t('A')] }), WF).ok, true);
});

test('invalid settings fall back to defaults', () => {
  const r = parseConfig(cfg({ failuresBeforeAlert: 0, timeoutSeconds: 31, targets: [t('A')] }), WF);
  assert.equal(r.errors.length, 2);
  assert.equal(r.settings.failuresBeforeAlert, 2);
  assert.equal(r.settings.timeoutMs, 10000);
  const ok = parseConfig(cfg({ failuresBeforeAlert: 3, timeoutSeconds: 5, targets: [t('A')] }), WF);
  assert.equal(ok.settings.failuresBeforeAlert, 3);
  assert.equal(ok.settings.timeoutMs, 5000);
});

test('bad target entries are skipped with the design problem text, good ones kept', () => {
  const r = parseConfig(cfg({
    targets: [
      { url: 'https://a.example.com/' },
      { name: 'NoUrl' },
      { name: 'Ftp', url: 'ftp://x.example.com/' },
      { name: 'Private', url: 'http://192.168.1.1/' },
      { name: 'Local', url: 'http://printer.local/' },
      { name: 'Creds', url: 'https://u:p@x.example.com/' },
      { name: 'x'.repeat(51), url: 'https://long.example.com/' },
      { name: 'Ctl\u0007', url: 'https://ctl.example.com/' },
      'just a string',
      t('Good'),
    ],
  }), WF);
  assert.deepEqual(r.targets.map((x) => x.name), ['Good']);
  const reasons = r.errors.map((e) => e.reason);
  assert.match(reasons[0], /needs a "name"/);
  assert.equal(r.errors[0].entry, 'Site #1 (no name)');
  assert.match(reasons[1], /needs a "url"/);
  assert.match(reasons[2], /must start with https:\/\/ or http:\/\//);
  assert.match(reasons[3], /private or local network/);
  assert.match(reasons[4], /local name/);
  assert.match(reasons[5], /username or password/);
  assert.match(reasons[6], /50 characters or fewer/);
  assert.match(reasons[7], /one line/);
  assert.match(reasons[8], /must be written as/);
  // the bad URL itself never appears in an error (it may hold credentials)
  assert.ok(!JSON.stringify(r.errors).includes('u:p@'));
});

test('a 50-character name is fine; names are trimmed', () => {
  const r = parseConfig(cfg({ targets: [{ name: `  ${'n'.repeat(50)}  `, url: 'https://a.example.com' }] }), WF);
  assert.equal(r.ok, true);
  assert.equal(r.targets[0].name, 'n'.repeat(50));
  assert.equal(r.targets[0].url, 'https://a.example.com/');
});

test('targets missing, not a list, or empty are errors', () => {
  assert.match(parseConfig('{}', WF).errors[0].reason, /needs a "targets" list/);
  assert.match(parseConfig('{"targets": {}}', WF).errors[0].reason, /must be a list/);
  assert.match(parseConfig('{"targets": []}', WF).errors[0].reason, /empty/);
});

test('invalid JSON is one config error with line and column, and parsed=false', () => {
  const text = '{\n  "targets": [\n    { "name": "A", "url": "https://a.example.com/" },\n  ]\n}\n';
  const r = parseConfig(text, WF);
  assert.equal(r.parsed, false);
  assert.equal(r.targets.length, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 3);
  assert.match(r.errors[0].reason, /not valid JSON/);
  assert.match(r.errors[0].reason, /extra comma/);
  assert.equal(formatError(r.errors[0]).startsWith('Line 3, The config file:'), true);
});

test('missing config file is an error', () => {
  const r = parseConfig(null, WF);
  assert.equal(r.parsed, false);
  assert.match(r.errors[0].reason, /could not be found/);
});

test('duplicate keys are reported', () => {
  const r = parseConfig('{"timeoutSeconds": 5, "timeoutSeconds": 6, "targets": [{"name":"A","url":"https://a.example.com/"}]}', WF);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /more than once/);
});

test('line numbers point at the bad entry', () => {
  const text = '{\n  "targets": [\n    { "name": "A", "url": "https://a.example.com/" },\n    { "name": "B",\n      "url": "ftp://b.example.com/" }\n  ]\n}\n';
  const r = parseConfig(text, WF);
  assert.equal(r.errors[0].line, 5);
  assert.equal(formatError(r.errors[0]), 'Line 5, Site #2 "B": The address must start with https:// or http://.');
});

const jsonCases = [
  ['{"a": 1,}', 1, /extra comma/],
  ['{\n"a": [1, 2,]\n}', 2, /extra comma after the last item/],
  ['{\n  "a": "unterminated\n}', 2, /missing its closing double quote/],
  ['{\n  name: "x"\n}', 2, /double quotes, like "name"/],
  ["{'a': 1}", 1, /single quotes/],
  ['{"a": 1\n "b": 2}', 2, /comma is missing/],
  ['{"a": [1 2]}', 1, /comma is missing between two items/],
  ['{"a" 1}', 1, /colon/],
  ['{"a": 1', 1, /ends too early/],
  ['{"a": 1} x', 1, /extra text/],
  ['// hi\n{}', 1, /Comments/],
  ['{"a": tru}', 1, /double quotes/],
  ['', 1, /empty/],
  ['{"a": 01}', 1, /comma is missing|number/],
];
for (const [text, line, re] of jsonCases) {
  test(`parseJson error: ${JSON.stringify(text)}`, () => {
    assert.throws(() => parseJson(text), (e) => e instanceof JsonSyntaxError && e.line === line && re.test(e.message));
  });
}

test('parseJson parses valid JSON like JSON.parse', () => {
  const samples = ['{"a":[1,2,{"b":null}],"c":"x\\n\\u00e9\\"","d":-1.5e3,"e":true,"f":false}', '[]', '"s"', '﻿{"a":1}'];
  for (const s of samples) assert.deepEqual(parseJson(s).value, JSON.parse(s.replace(/^﻿/, '')));
  const { value } = parseJson('{"__proto__": {"x": 1}}');
  assert.equal(({}).x, undefined);
  assert.deepEqual(Object.keys(value), ['__proto__']);
});

test('F3: javascript, data, vbscript and file schemes are rejected in contact even before a digit', () => {
  for (const c of ['JaVaScRiPt:0,alert(1)', 'javascript:0', 'data:text/html,<b>x</b>', 'vbscript:1', 'file:1', 'Use https://ok.example and javascript:1']) {
    assert.equal(parseConfig(cfg({ contact: c, targets: [t('A')] }), WF).ok, false, c);
  }
  for (const l of ['JaVaScRiPt:0', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
    assert.equal(parseConfig(cfg({ contactLink: l, targets: [t('A')] }), WF).ok, false, l);
  }
});

test('F9: Unicode control and format characters are rejected in names, siteName and contact', () => {
  for (const ch of ['‮', '⁦', '​', '\u0085', '\u2028']) {
    assert.equal(parseConfig(cfg({ targets: [{ name: `Shop${ch}x`, url: 'https://a.example.com/' }] }), WF).ok, false, `name ${escape(ch)}`);
    assert.equal(parseConfig(cfg({ contact: `Hi${ch}`, targets: [t('A')] }), WF).ok, false, `contact ${escape(ch)}`);
    assert.equal(parseConfig(cfg({ siteName: `Co${ch}`, targets: [t('A')] }), WF).ok, false, `siteName ${escape(ch)}`);
  }
  assert.equal(parseConfig(cfg({ targets: [{ name: 'Café Ünïcode 日本', url: 'https://a.example.com/' }] }), WF).ok, true);
});

test('F11: query parameters that look like secrets are rejected', () => {
  for (const u of ['https://a.example.com/health?token=abc', 'https://a.example.com/?API_KEY=1', 'https://a.example.com/?x=1&access-token=2', 'https://a.example.com/?sig=z', 'https://a.example.com/?Password=z']) {
    const r = parseConfig(cfg({ targets: [{ name: 'A', url: u }] }), WF);
    assert.equal(r.ok, false, u);
    assert.match(r.errors[0].reason, /looks like a password or key/);
    assert.ok(!r.errors[0].reason.includes('abc'));
  }
  assert.equal(parseConfig(cfg({ targets: [{ name: 'A', url: 'https://a.example.com/?page=2&keyword=x' }] }), WF).ok, true);
});

test('F7: bad ports are config errors', () => {
  const r = parseConfig(cfg({ targets: [{ name: 'A', url: 'http://a.example.com:22/' }] }), WF);
  assert.match(r.errors[0].reason, /port/);
});
