// scripts/build-site.mjs (T13 DoD) and the pure parts of scripts/a11y-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, validateRepo, dataUrlFor, isExcluded, pageSettings } from '../scripts/build-site.mjs';
import { shiftFixture, fixtureForPath, summarize, missingFetches, FIXTURE_NOW_MS } from '../scripts/a11y-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'build-site.mjs');
const config = (o) => JSON.stringify({ targets: [{ name: 'Blog', url: 'https://example.com/' }], ...o });

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'gu-build-'));
  cpSync(join(ROOT, 'site'), join(dir, 'site'), { recursive: true });
  return dir;
}
const walk = (d, base = d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), base) : [join(d, e.name).slice(base.length + 1)])).sort();

test('repo format is validated before use', () => {
  for (const ok of ['gn0sh/gnosh-uptime', 'a/b', 'Some-Org/repo.name_1', 'gn0sh/gn0sh.github.io']) assert.equal(validateRepo(ok), ok);
  for (const bad of [undefined, '', 'noslash', 'a/b/c', 'a/..', 'a/.', '-a/b', 'a b/c', 'a/b?x', 'a/b#', 'a/<b>', 'a/b\n', `${'a'.repeat(40)}/b`, '"/x']) {
    assert.throws(() => validateRepo(bad), `${JSON.stringify(bad)}`);
  }
  assert.equal(dataUrlFor('gn0sh/gnosh-uptime'), 'https://raw.githubusercontent.com/gn0sh/gnosh-uptime/monitor-data/status.json');
});

test('_site gets the page files only: no fixtures, tests or build helpers', () => {
  const dir = scratch();
  try {
    const { files } = buildSite({ repo: 'o/r', root: dir, configText: config({}), workflowText: null });
    assert.deepEqual(files, ['app.js', 'index.html', 'render.js', 'style.css']);
    assert.deepEqual(walk(join(dir, '_site')), files);
    assert.ok(isExcluded('fixtures/all-up.json') && isExcluded('render.test.js') && isExcluded('meta-inject.js'));
    assert.ok(!isExcluded('app.js') && !isExcluded('style.css'));
    // copied files are byte-identical
    assert.equal(readFileSync(join(dir, '_site', 'app.js'), 'utf8'), readFileSync(join(dir, 'site', 'app.js'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('index.html gets the data URL, repo and page settings as escaped attributes (F2, F10)', () => {
  const dir = scratch();
  try {
    buildSite({ repo: 'gn0sh/gnosh-uptime', root: dir, workflowText: null,
      configText: config({ siteName: 'Rosa & Co "Shop"', contact: 'Email help@example.com', contactLink: 'mailto:help@example.com' }) });
    const html = readFileSync(join(dir, '_site', 'index.html'), 'utf8');
    assert.ok(html.includes('<meta name="gu-data-url" content="https://raw.githubusercontent.com/gn0sh/gnosh-uptime/monitor-data/status.json">'));
    assert.ok(html.includes('<meta name="gu-repo" content="gn0sh/gnosh-uptime">'));
    assert.ok(html.includes('<meta name="gu-site-name" content="Rosa &amp; Co &quot;Shop&quot;">'));
    assert.ok(html.includes('<meta name="gu-contact" content="Email help@example.com">'));
    assert.ok(html.includes('<meta name="gu-contact-link" content="mailto:help@example.com">'));
    assert.equal((html.match(/<meta\b/g) || []).length, (readFileSync(join(dir, 'site', 'index.html'), 'utf8').match(/<meta\b/g) || []).length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unset page settings stay as placeholders the page reads as "not set"', () => {
  const s = pageSettings(config({}), null);
  assert.deepEqual(s, { siteName: null, contact: null, contactLink: null });
});

test('a bad page setting or unreadable config fails the build; other config errors do not', () => {
  assert.throws(() => pageSettings(config({ contact: 'Click javascript:alert(1)' })), /contact/);
  assert.throws(() => pageSettings(config({ contactLink: 'http://example.com' })), /contactLink/);
  assert.throws(() => pageSettings('{ "targets": [ }'), /could not be read/);
  assert.throws(() => pageSettings(null), /could not be read/);
  // A broken target is the monitor's business (config-error issue), not the page's.
  const s = pageSettings(JSON.stringify({ contact: 'Hi', targets: [{ name: 'x', url: 'http://127.0.0.1/' }] }));
  assert.equal(s.contact, 'Hi');
});

test('the build refuses to write outside the repo or over site/', () => {
  const dir = scratch();
  try {
    for (const outDir of ['..', '.', 'site', '/tmp/elsewhere']) {
      assert.throws(() => buildSite({ repo: 'o/r', root: dir, outDir, configText: config({}), workflowText: null }), /Refusing/, outDir);
    }
    assert.ok(existsSync(join(dir, 'site', 'index.html')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: builds from GITHUB_REPOSITORY and exits 1 when it is missing or malformed', () => {
  const env = { ...process.env };
  delete env.GITHUB_REPOSITORY;
  const bad = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8', cwd: ROOT });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /GITHUB_REPOSITORY/);
  const evil = spawnSync(process.execPath, [SCRIPT], { env: { ...env, GITHUB_REPOSITORY: 'o/r"><script>' }, encoding: 'utf8', cwd: ROOT });
  assert.equal(evil.status, 1);
});

test('a11y helper: fixture times move to "now", stale stays stale, paths map safely', () => {
  const now = FIXTURE_NOW_MS + 3 * 86_400_000 + 3_600_000; // 3 days and 1 hour later
  const out = shiftFixture({ lastRunAt: '2026-10-28T14:05:12Z', days: [['2026-10-28', 96, 96]], name: '2026-10-28 shop', n: 1 }, now);
  assert.equal(out.lastRunAt, '2026-10-31T15:05:12Z');
  assert.deepEqual(out.days, [['2026-10-31', 96, 96]]);
  assert.equal(out.name, '2026-10-28 shop');
  assert.equal(fixtureForPath('/a11y/one-down/monitor-data/status.json'), 'one-down');
  for (const p of ['/a11y/../x/monitor-data/status.json', '/a11y/One/monitor-data/status.json', '/x/one-down/monitor-data/status.json']) assert.equal(fixtureForPath(p), null);
  const r = summarize([{ url: 'u', violations: [{ id: 'x', impact: 'minor', help: 'h', nodes: [1] }] }]);
  assert.equal(r.failed, false);
  assert.equal(summarize([{ url: 'u', violations: [{ id: 'x', impact: 'serious', help: 'h', nodes: [1] }] }]).failed, true);
  assert.equal(summarize([]).failed, true);
  // R6: a fixture the page never requested is reported.
  assert.deepEqual(missingFetches(['all-up', 'stale', 'load-error'], new Map([['all-up', 1], ['load-error', 2]])), ['stale']);
  assert.deepEqual(missingFetches(['all-up'], new Map([['all-up', 1]])), []);
});
