import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { FakeGitHub } from './helpers/fake-github.js';

const WORKFLOW = "on:\n  schedule:\n    - cron: '7,22,37,52 * * * *'\n  workflow_dispatch:\n";
const PUBLIC = { 'up.example.com': '93.184.216.34', 'down.example.com': '93.184.216.35', 'new.example.com': '93.184.216.36' };

function project(t, config) {
  const root = mkdtempSync(join(tmpdir(), 'gu-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/monitor.yml'), WORKFLOW);
  const setConfig = (c) => writeFileSync(join(root, 'monitor.config.json'), typeof c === 'string' ? c : JSON.stringify(c, null, 2));
  setConfig(config);
  const summaryFile = join(root, 'summary.md');
  writeFileSync(summaryFile, '');
  return { root, setConfig, summaryFile };
}

function harness(t, config) {
  const p = project(t, config);
  const clock = { t: Date.parse('2026-10-28T10:07:00Z') };
  const fake = new FakeGitHub({ now: () => new Date(clock.t) });
  const requests = [];
  const deps = {
    root: p.root,
    env: { GITHUB_STEP_SUMMARY: p.summaryFile, GITHUB_REPOSITORY: fake.repo },
    gh: fake.client(),
    now: () => new Date(clock.t),
    resolver: async (host) => {
      if (!PUBLIC[host]) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
      return [{ address: PUBLIC[host], family: 4 }];
    },
    transport: async ({ url, address }) => {
      requests.push({ href: url.href, address });
      if (url.hostname === 'down.example.com') return { status: 503, location: null };
      return { status: 200, location: null };
    },
    log: () => {},
    error: () => {},
  };
  const runOnce = async () => {
    const code = await main(['run'], deps);
    clock.t += 15 * 60000;
    return code;
  };
  const stored = () => {
    const text = fake.fileText('monitor-data', 'status.json');
    return text === null ? null : JSON.parse(text);
  };
  return { ...p, fake, deps, clock, requests, runOnce, stored };
}

const good = { name: 'Up', url: 'https://up.example.com/' };
const down = { name: 'Down', url: 'https://down.example.com/' };

test('C6 scheduled: one bad entry plus two good targets: success, both checked, exactly one config-error issue over 3 runs', async (t) => {
  const h = harness(t, { targets: [good, { name: 'Bad', url: 'ftp://x.example.com/' }, { name: 'Up2', url: 'https://new.example.com/' }] });
  for (let k = 0; k < 3; k++) assert.equal(await h.runOnce(), 0);
  const cfgIssues = h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'config-error'));
  assert.equal(cfgIssues.length, 1);
  assert.equal(cfgIssues[0].state, 'open');
  assert.match(cfgIssues[0].body, /Site 2 \*\*` Bad `\*\*/);
  const data = h.stored();
  assert.deepEqual(data.targets.map((x) => [x.name, x.state]), [['Up', 'up'], ['Up2', 'up']]);
  assert.equal(data.configErrorCount, 1);
  assert.equal(h.requests.filter((r) => r.href.startsWith('ftp')).length, 0);
  const summary = readFileSync(h.summaryFile, 'utf8');
  assert.match(summary, /### Monitor run/);
  assert.match(summary, /\| ` Up ` \| up \|/);
  assert.match(summary, /Status data written: \d+ bytes/);
  // fixing the config closes the issue on the next run
  h.setConfig({ targets: [good] });
  assert.equal(await h.runOnce(), 0);
  assert.equal(cfgIssues[0].state, 'closed');
});

test('K5: back-to-back runs against a down target give exactly one outage issue', async (t) => {
  const h = harness(t, { targets: [down, good] });
  for (let k = 0; k < 4; k++) assert.equal(await h.runOnce(), 0);
  const outage = h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'outage'));
  assert.equal(outage.length, 1);
  assert.equal(outage[0].title, 'Down is down');
  assert.equal(outage[0].locked, true);
  assert.equal(h.stored().targets[0].issue, outage[0].number);
  assert.equal(h.stored().targets[0].failStreak, 4);
});

test('K5: a run that opened an issue and then failed to write does not cause a duplicate', async (t) => {
  const h = harness(t, { targets: [down] });
  assert.equal(await h.runOnce(), 0);
  let failPut = true;
  h.fake.hooks.push((m, p) => (failPut && m === 'PUT' && p.includes('/contents/') ? { status: 500, json: {} } : undefined));
  assert.equal(await h.runOnce(), 1); // issue opened, write failed
  assert.equal(h.fake.issues.length, 1);
  failPut = false;
  assert.equal(await h.runOnce(), 0);
  assert.equal(h.fake.issues.length, 1);
  assert.equal(h.stored().targets[0].issue, 1);
});

test('S7: stored lastRunAt 3 hours ago, then two runs: exactly one monitor-stale issue', async (t) => {
  const h = harness(t, { targets: [good] });
  assert.equal(await h.runOnce(), 0);
  const data = h.stored();
  data.lastRunAt = new Date(h.clock.t - 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  h.fake.putFile('monitor-data', 'status.json', JSON.stringify(data));
  assert.equal(await h.runOnce(), 0);
  assert.equal(await h.runOnce(), 0);
  const stale = h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'monitor-stale'));
  assert.equal(stale.length, 1);
  assert.match(stale[0].title, /^Monitor was stale from .* UTC to .* UTC$/);
});

test('S7: a retry of the same gap (the first run died after opening the issue) gives one issue', async (t) => {
  const h = harness(t, { targets: [good] });
  assert.equal(await h.runOnce(), 0);
  h.clock.t += 3 * 3600000;
  h.fake.hooks.push((m, p) => (m === 'PUT' && p.includes('/contents/') ? { status: 500, json: {} } : undefined));
  assert.equal(await h.runOnce(), 1);
  h.fake.hooks.length = 0;
  assert.equal(await h.runOnce(), 0);
  assert.equal(h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'monitor-stale')).length, 1);
});

test('D5: a run that throws before the write leaves the stored data unchanged and exits non-zero', async (t) => {
  const h = harness(t, { targets: [good] });
  assert.equal(await h.runOnce(), 0);
  const before = h.fake.fileText('monitor-data', 'status.json');
  h.fake.hooks.push((m, p) => (m === 'GET' && p.includes('/contents/status.json') ? { status: 500, json: {} } : undefined));
  assert.equal(await h.runOnce(), 1);
  assert.equal(h.fake.fileText('monitor-data', 'status.json'), before);
  assert.match(readFileSync(h.summaryFile, 'utf8'), /The run failed/);
});

test('D5: a 409 on the data write is an infrastructure failure (exit 1)', async (t) => {
  const h = harness(t, { targets: [good] });
  assert.equal(await h.runOnce(), 0);
  h.fake.hooks.push((m, p) => (m === 'PUT' && p.includes('/contents/') ? { status: 409, json: {} } : undefined));
  assert.equal(await h.runOnce(), 1);
});

test('C1: a new valid target appears in the data after one run', async (t) => {
  const h = harness(t, { targets: [good] });
  assert.equal(await h.runOnce(), 0);
  h.setConfig({ targets: [good, { name: 'New', url: 'https://new.example.com/' }] });
  assert.equal(await h.runOnce(), 0);
  assert.deepEqual(h.stored().targets.map((x) => x.name), ['Up', 'New']);
  assert.equal(h.stored().targets[1].state, 'up');
});

test('D1: every write goes to the data branch; the first run bootstraps it', async (t) => {
  const h = harness(t, { targets: [good] });
  for (let k = 0; k < 3; k++) assert.equal(await h.runOnce(), 0);
  assert.equal(h.fake.branches.has('main'), false);
  assert.equal(h.fake.branches.get('monitor-data').commits.length, 3);
  assert.equal(h.fake.callsTo('POST', /git\/commits/).length, 1);
});

test('SC-11: invalid JSON config: exit 0, config-error issue with the line, no checks, data kept', async (t) => {
  const h = harness(t, { targets: [good] });
  assert.equal(await h.runOnce(), 0);
  const before = h.fake.fileText('monitor-data', 'status.json');
  h.setConfig('{\n  "targets": [\n    { "name": "Up", "url": "https://up.example.com/" },\n  ]\n}\n');
  const n = h.requests.length;
  assert.equal(await h.runOnce(), 0);
  assert.equal(h.requests.length, n);
  assert.equal(h.fake.fileText('monitor-data', 'status.json'), before);
  const issue = h.fake.issues.find((i) => i.labels.some((l) => l.name === 'config-error'));
  assert.match(issue.body, /line 3/);
  assert.match(issue.body, /not valid JSON/);
});

test('a target removed from config disappears from the data after one run (D4)', async (t) => {
  const h = harness(t, { targets: [good, down] });
  for (let k = 0; k < 2; k++) await h.runOnce();
  h.setConfig({ targets: [good] });
  assert.equal(await h.runOnce(), 0);
  assert.deepEqual(h.stored().targets.map((x) => x.name), ['Up']);
  assert.equal(h.fake.issues[0].state, 'closed');
});

test('validate: exit 1 with plain errors and line numbers on stdout and in the summary; exit 0 when valid', async (t) => {
  const p = project(t, { targets: [good, { name: 'Bad', url: 'http://localhost/' }] });
  const lines = [];
  const code = await main(['validate'], { root: p.root, env: { GITHUB_STEP_SUMMARY: p.summaryFile }, log: (s) => lines.push(s) });
  assert.equal(code, 1);
  assert.ok(lines.some((l) => /^- Line \d+, Site #2 "Bad": The address is a local name/.test(l)), lines.join('\n'));
  assert.match(readFileSync(p.summaryFile, 'utf8'), /has 1 problem/);
  p.setConfig({ targets: [good] });
  assert.equal(await main(['validate'], { root: p.root, env: {}, log: () => {} }), 0);
  p.setConfig('{"targets": [}');
  const out = [];
  assert.equal(await main(['validate'], { root: p.root, env: {}, log: (s) => out.push(s) }), 1);
  assert.match(out.join('\n'), /Line 1, The config file: The file is not valid JSON/);
});

test('keepalive: 403 gives a warning and a summary line, exit 0; missing token also exit 0', async (t) => {
  const p = project(t, { targets: [good] });
  const fake = new FakeGitHub();
  fake.enableStatus = 403;
  const lines = [];
  const code = await main(['keepalive'], { root: p.root, gh: fake.client(), env: { GITHUB_STEP_SUMMARY: p.summaryFile, GITHUB_REPOSITORY: fake.repo }, log: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.match(lines[0], /^::warning::Keepalive failed \(HTTP 403\)/);
  assert.match(readFileSync(p.summaryFile, 'utf8'), /Keepalive failed/);
  assert.equal(await main(['keepalive'], { root: p.root, env: {}, log: () => {} }), 0);
});

test('unknown command exits 2', async () => {
  assert.equal(await main(['nope'], { error: () => {} }), 2);
});

test('run without a token fails cleanly (exit 1) and never prints a token', async (t) => {
  const p = project(t, { targets: [good] });
  const errs = [];
  assert.equal(await main(['run'], { root: p.root, env: { GITHUB_REPOSITORY: 'a/b' }, log: () => {}, error: (s) => errs.push(s) }), 1);
  assert.match(errs.join('\n'), /GITHUB_TOKEN is missing/);
});

test('review F3: issues API failures are warnings; checks run and data is still written with correct streaks', async (t) => {
  for (const status of [500, 410]) {
    const h = harness(t, { targets: [down, good] });
    h.fake.hooks.push((m, p) => (/\/(issues|labels)/.test(p) ? { status, json: {} } : undefined));
    const codes = [];
    for (let k = 0; k < 3; k++) codes.push(await h.runOnce());
    assert.deepEqual(codes, status === 410 ? [0, 0, 0] : [1, 1, 1], `HTTP ${status}`);
    const data = h.stored();
    assert.equal(data.targets[0].failStreak, 3);
    assert.equal(data.targets[0].issue, null);
    assert.deepEqual(data.targets[1].days[0].slice(1), [3, 3]);
    assert.match(readFileSync(h.summaryFile, 'utf8'), /Warning: Listing outage issues failed/);
    // once Issues work again, the next run opens exactly one issue
    h.fake.hooks.length = 0;
    assert.equal(await h.runOnce(), 0);
    assert.equal(h.fake.issues.length, 1);
    assert.equal(h.stored().targets[0].issue, 1);
  }
});

test('review F2: a down target whose entry turns invalid keeps its history and open issue', async (t) => {
  const h = harness(t, { targets: [down, good] });
  for (let k = 0; k < 3; k++) await h.runOnce();
  const before = h.stored().targets[0];
  assert.equal(before.issue, 1);
  h.setConfig({ targets: [{ name: 'Down', url: 'https://down.example.com/?token=abc' }, good] });
  for (let k = 0; k < 2; k++) assert.equal(await h.runOnce(), 0);
  const data = h.stored();
  assert.deepEqual(data.targets.map((x) => x.name), ['Down', 'Up']);
  assert.deepEqual(data.targets[0], before);
  assert.equal(data.configErrorCount, 1);
  assert.equal(h.fake.issues[0].state, 'open');
  assert.equal(h.requests.filter((r) => r.href.includes('token')).length, 0);
  // fixed again: it is checked and continues the same outage
  h.setConfig({ targets: [down, good] });
  assert.equal(await h.runOnce(), 0);
  assert.equal(h.stored().targets[0].failStreak, 4);
  assert.equal(h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'outage')).length, 1);
});

test('review F2: carried entries keep config order', async (t) => {
  const h = harness(t, { targets: [good, down, { name: 'New', url: 'https://new.example.com/' }] });
  await h.runOnce();
  h.setConfig({ targets: [good, { name: 'Down', url: 'ftp://down.example.com/' }, { name: 'New', url: 'https://new.example.com/' }] });
  await h.runOnce();
  assert.deepEqual(h.stored().targets.map((x) => x.name), ['Up', 'Down', 'New']);
});

for (const [label, config] of [
  ['"targets" misspelled', { tagrets: [good] }],
  ['"targets" not a list', { targets: { a: 1 } }],
  ['"targets" empty', { targets: [] }],
  ['every entry invalid', { targets: [{ name: 'Up', url: 'ftp://up.example.com/' }] }],
]) {
  test(`review F2: ${label} with existing data: check nothing, write nothing, one config-error issue`, async (t) => {
    const h = harness(t, { targets: [down, good] });
    for (let k = 0; k < 2; k++) await h.runOnce();
    const before = h.fake.fileText('monitor-data', 'status.json');
    const n = h.requests.length;
    h.setConfig(config);
    for (let k = 0; k < 2; k++) assert.equal(await h.runOnce(), 0);
    assert.equal(h.fake.fileText('monitor-data', 'status.json'), before);
    assert.equal(h.requests.length, n);
    assert.equal(h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'config-error')).length, 1);
    const outage = h.fake.issues.find((i) => i.labels.some((l) => l.name === 'outage'));
    assert.equal(outage.state, 'open');
  });
}

test('review F1: config -> run -> write -> read round trip with encoded, IDN and 4-byte values keeps state', async (t) => {
  const name = '\u{1F600}'.repeat(50);
  const path = 'é'.repeat(78); // 78 chars in, 468 once percent-encoded: href 493 chars
  const config = {
    siteName: 'Ü'.repeat(60),
    contact: '\u{1F4E7}'.repeat(200),
    contactLink: `https://bücher.example/${'ö'.repeat(60)}`,
    targets: [
      { name, url: 'https://down.example.com/a b/c d?q=x y' },
      { name: 'Accent', url: `https://down.example.com/${path}` },
      { name: 'IDN', url: 'https://bücher.example/' },
    ],
  };
  const h = harness(t, config);
  h.deps.resolver = async () => [{ address: '93.184.216.35', family: 4 }];
  for (let k = 0; k < 3; k++) assert.equal(await h.runOnce(), 0);
  const data = h.stored();
  assert.ok(data, 'data written');
  assert.deepEqual(data.targets.map((x) => [x.failStreak, x.days[0][1]]), [[3, 3], [3, 3], [0, 3]]);
  assert.equal(data.targets[2].url, 'https://xn--bcher-kva.example/');
  assert.equal(h.fake.issues.filter((i) => i.labels.some((l) => l.name === 'outage')).length, 2);
  assert.equal(data.contactLink.startsWith('https://xn--bcher-kva.example/'), true);
  assert.ok(data.targets[1].url.length <= 500);
});

test('review F1: a path that only exceeds 500 chars once encoded is a config error, not a silent reset', async (t) => {
  const { parseConfig } = await import('../src/config.js');
  const r = parseConfig(JSON.stringify({ targets: [{ name: 'A', url: `https://a.example.com/${'é'.repeat(100)}` }] }), null);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].reason, /once special characters are encoded/);
  const l = parseConfig(JSON.stringify({ contactLink: `https://a.example.com/${'é'.repeat(100)}`, targets: [good] }), null);
  assert.equal(l.ok, false);
});
