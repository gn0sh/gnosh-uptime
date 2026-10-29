import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGitHub, GitHubError } from '../src/github.js';
import { readData, writeData, serializeData, isValidStoredData, DataSizeError } from '../src/datastore.js';
import { FakeGitHub } from './helpers/fake-github.js';
import { parseConfig } from '../src/config.js';
import { applyRun, isoSeconds } from '../src/state.js';

const REPO = 'gn0sh/gnosh-uptime';

function sample() {
  return {
    v: 1, repo: REPO, siteName: null, lastRunAt: '2026-10-28T14:05:12Z', intervalMinutes: 15, staleAfterMinutes: 60,
    failuresBeforeAlert: 2, contact: null, contactLink: null, configErrorCount: 0,
    targets: [{
      name: 'Blog', url: 'https://example.com/', state: 'up', lastCheckedAt: '2026-10-28T14:05:03Z', lastFailureReason: null,
      failStreak: 0, outageStartedAt: null, issue: null, suppressed: false, days: [['2026-10-27', 96, 96], ['2026-10-28', 57, 56]],
    }],
  };
}

function setup() {
  const fake = new FakeGitHub({ repo: REPO });
  const gh = makeGitHub({ token: 'secret-token', repo: REPO, fetchImpl: fake.fetch() });
  return { fake, gh };
}

test('makeGitHub sends the auth and version headers and rejects bad input', async () => {
  const { fake, gh } = setup();
  await gh('GET', `/repos/${REPO}/labels`);
  const h = fake.calls[0].headers;
  assert.equal(h.authorization, 'Bearer secret-token');
  assert.equal(h['x-github-api-version'], '2022-11-28');
  assert.equal(h.accept, 'application/vnd.github+json');
  assert.throws(() => makeGitHub({ token: 't', repo: 'bad repo' }));
  assert.throws(() => makeGitHub({ token: '', repo: REPO }));
});

test('GitHubError on >= 400 unless allowed; the message never holds the token', async () => {
  const { gh } = setup();
  await assert.rejects(gh('GET', `/repos/${REPO}/nope`), (e) => e instanceof GitHubError && e.status === 404 && !e.message.includes('secret-token'));
  const r = await gh('GET', `/repos/${REPO}/nope`, undefined, { allow: [404] });
  assert.equal(r.status, 404);
});

test('first run: branch 404 gives data null, then bootstrap via blobs, trees, commits(parents []) and refs', async () => {
  const { fake, gh } = setup();
  const read = await readData(gh);
  assert.deepEqual(read, { data: null, sha: null, warning: null });
  const res = await writeData(gh, sample(), null);
  assert.equal(res.bootstrapped, true);
  const posts = fake.calls.filter((c) => c.method === 'POST').map((c) => c.path.replace(`/repos/${REPO}`, ''));
  assert.deepEqual(posts, ['/git/blobs', '/git/trees', '/git/commits', '/git/refs']);
  const commit = fake.calls.find((c) => c.path.endsWith('/git/commits')).body;
  assert.deepEqual(commit.parents, []);
  assert.equal(fake.calls.find((c) => c.path.endsWith('/git/refs')).body.ref, 'refs/heads/monitor-data');
  assert.deepEqual(JSON.parse(fake.fileText('monitor-data', 'status.json')), sample());
  const again = await readData(gh);
  assert.deepEqual(again.data, sample());
  assert.equal(typeof again.sha, 'string');
});

test('normal write: PUT with sha to the data branch', async () => {
  const { fake, gh } = setup();
  const sha = fake.putFile('monitor-data', 'status.json', JSON.stringify(sample()));
  const { data, sha: readSha } = await readData(gh);
  assert.equal(readSha, sha);
  data.lastRunAt = '2026-10-28T14:20:00Z';
  await writeData(gh, data, readSha);
  const put = fake.callsTo('PUT', /contents\/status\.json/)[0];
  assert.equal(put.body.sha, sha);
  assert.equal(put.body.branch, 'monitor-data');
  assert.equal(put.body.message, 'data: run 2026-10-28T14:20:00Z');
  assert.equal(JSON.parse(fake.fileText('monitor-data', 'status.json')).lastRunAt, '2026-10-28T14:20:00Z');
});

test('file missing on an existing branch: PUT without sha, no bootstrap', async () => {
  const { fake, gh } = setup();
  fake.putFile('monitor-data', 'other.txt', 'x');
  const r = await writeData(gh, sample(), null);
  assert.equal(r.bootstrapped, false);
  assert.equal(fake.callsTo('POST', /git\//).length, 0);
  assert.equal(fake.callsTo('PUT', /contents/)[0].body.sha, undefined);
});

test('409 on a stale sha: the write throws and the old data is untouched (no second write)', async () => {
  const { fake, gh } = setup();
  fake.putFile('monitor-data', 'status.json', JSON.stringify(sample()));
  const before = fake.fileText('monitor-data', 'status.json');
  const changed = { ...sample(), lastRunAt: '2026-10-28T15:00:00Z' };
  await assert.rejects(writeData(gh, changed, 'stale-sha'), (e) => e.status === 409);
  assert.equal(fake.fileText('monitor-data', 'status.json'), before);
  assert.equal(fake.callsTo('PUT', /contents/).length, 1);
});

test('malformed or tampered JSON gives data null with the sha kept and a warning', async () => {
  for (const text of ['{not json', JSON.stringify({ ...sample(), v: 2 }), JSON.stringify({ ...sample(), extra: 1 })]) {
    const { fake, gh } = setup();
    const sha = fake.putFile('monitor-data', 'status.json', text);
    const r = await readData(gh);
    assert.equal(r.data, null);
    assert.equal(r.sha, sha);
    assert.match(r.warning, /starts fresh/);
  }
});

test('no call ever targets the default branch', async () => {
  const { fake, gh } = setup();
  await readData(gh);
  await writeData(gh, sample(), null);
  const { data, sha } = await readData(gh);
  await writeData(gh, data, sha);
  for (const c of fake.calls) {
    assert.ok(!/ref=main|heads\/main/.test(c.path), c.path);
    if (c.body?.branch) assert.equal(c.body.branch, 'monitor-data');
  }
  assert.equal(fake.calls.some((c) => c.path.includes('/contents/') && c.method === 'GET' && !c.path.includes('ref=monitor-data')), false);
});

test('size assertions: record, header and total', () => {
  assert.doesNotThrow(() => serializeData(sample()));
  const bigRecord = sample();
  bigRecord.targets[0].url = `https://example.com/${'a'.repeat(1100)}`;
  assert.throws(() => serializeData(bigRecord), DataSizeError);
  const bigHeader = { ...sample(), contact: '\u{1F600}'.repeat(600) };
  assert.throws(() => serializeData(bigHeader), DataSizeError);
  const bigTotal = sample();
  bigTotal.targets = Array.from({ length: 40 }, (_, k) => ({ ...sample().targets[0], name: `T${k}`, days: Array.from({ length: 400 }, () => ['2026-01-01', 99999, 99999]) }));
  assert.throws(() => serializeData(bigTotal), /over 262144 bytes/);
});

test('worst case at 20 targets with max-length fields stays well under the bounds', () => {
  const d = sample();
  d.contact = 'x'.repeat(200);
  d.targets = Array.from({ length: 20 }, (_, k) => ({
    ...sample().targets[0],
    name: `${k}`.padEnd(50, 'n'),
    url: `https://example.com/${'p'.repeat(470)}`,
    lastFailureReason: 'too many redirects',
    outageStartedAt: '2026-10-28T14:05:03Z',
    issue: 123456,
    days: Array.from({ length: 90 }, (_, i) => [new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), 288, 288]),
  }));
  const text = serializeData(d);
  assert.ok(text.length < 79104, String(text.length));
  assert.equal(isValidStoredData(JSON.parse(text)), true);
});

const tamper = [
  ['issue as string path', (d) => { d.targets[0].issue = '1/lock'; }],
  ['issue zero', (d) => { d.targets[0].issue = 0; }],
  ['lastRunAt with comment breakout', (d) => { d.lastRunAt = '2026-10-28T14:05:12Z-->'; }],
  ['unknown state', (d) => { d.targets[0].state = 'Working'; }],
  ['free-text reason', (d) => { d.targets[0].lastFailureReason = '<b>hi</b>'; }],
  ['ok > checks', (d) => { d.targets[0].days[0] = ['2026-10-27', 1, 2]; }],
  ['days not ascending', (d) => { d.targets[0].days.reverse(); }],
  ['private url', (d) => { d.targets[0].url = 'http://127.0.0.1/'; }],
  ['extra target key', (d) => { d.targets[0].html = 'x'; }],
  ['duplicate names', (d) => { d.targets.push({ ...d.targets[0], name: 'BLOG' }); }],
  ['bad repo', (d) => { d.repo = 'evil/../x y'; }],
  ['javascript contactLink', (d) => { d.contactLink = 'javascript:alert(1)'; }],
  ['bidi in name', (d) => { d.targets[0].name = 'Blog‮'; }],
];
for (const [label, fn] of tamper) {
  test(`isValidStoredData rejects: ${label}`, () => {
    const d = sample();
    fn(d);
    assert.equal(isValidStoredData(d), false);
  });
}
test('isValidStoredData accepts the sample', () => assert.equal(isValidStoredData(sample()), true));

// QA T14 property: if parseConfig says ok, a worst-case run of that config
// serializes without throwing and reads back as valid (scenarios from
// docs/qa/uptime-monitor-t14.md, Phase 1).

function worstCaseRoundTrip(configText) {
  const cfg = parseConfig(configText, null);
  if (!cfg.ok) return { ok: false, cfg };
  const now = new Date('2026-10-28T10:07:00Z');
  const results = cfg.targets.map((t) => ({ name: t.name, url: t.url, up: false, reason: 'too many redirects', checkedAt: isoSeconds(now) }));
  const { data } = applyRun(null, results, { settings: cfg.settings, configErrorCount: 99, repo: 'a-long-owner-name/a.long_repo-name' }, now);
  for (const t of data.targets) {
    t.issue = Number.MAX_SAFE_INTEGER;
    t.failStreak = 99999;
    t.suppressed = true;
    t.lastCheckedAt = '2026-10-28T10:07:00.000Z';
    t.outageStartedAt = '2026-10-28T10:07:00.000Z';
    t.days = Array.from({ length: 90 }, (_, i) => [new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), 288, 288]);
  }
  const text = serializeData(data); // must not throw
  return { ok: true, cfg, text, valid: isValidStoredData(JSON.parse(text)) };
}

const emoji = (n) => '\u{1F600}'.repeat(n);
const lone = (n) => '\\ud800'.repeat(n); // as JSON escapes in the config text
const asciiUrl = (len) => `https://example.com/${'a'.repeat(len - 20)}`;
const targetsOf = (url, name = (k) => `${emoji(48)}${String(k).padStart(2, '0')}`) => Array.from({ length: 20 }, (_, k) => ({ name: name(k), url }));
const uniqueUrls = (make) => Array.from({ length: 20 }, (_, k) => make(k));

const scenarios = [
  ['A: 20 x (emoji name 50ch, ASCII url 500ch)', JSON.stringify({ targets: uniqueUrls((k) => ({ name: `${emoji(48)}${String(k).padStart(2, '0')}`, url: asciiUrl(500) })) }), true],
  ['B: A + ASCII header maxima', JSON.stringify({ siteName: 's'.repeat(60), contact: 'c'.repeat(200), contactLink: `https://example.com/${'l'.repeat(480)}`, targets: targetsOf(asciiUrl(500)) }), true],
  ['C: A + multibyte header (siteName 60 emoji, contact 200 emoji)', JSON.stringify({ siteName: emoji(60), contact: emoji(200), targets: targetsOf(asciiUrl(500)) }), true],
  ['D: multibyte header + contactLink 500ch', JSON.stringify({ siteName: emoji(60), contact: emoji(200), contactLink: `https://example.com/${'l'.repeat(480)}`, targets: [{ name: 'A', url: 'https://example.com/' }] }), true],
  ['E: url 500ch with 150 quotes', JSON.stringify({ targets: [{ name: 'A', url: `https://example.com/${'"'.repeat(150)}${'a'.repeat(330)}` }] }), false],
  ['F: url 500ch with spaces', JSON.stringify({ targets: [{ name: 'A', url: `https://example.com/${'a '.repeat(240)}` }] }), false],
  ['H: url 470ch ASCII + 10 quotes', JSON.stringify({ targets: [{ name: 'A', url: `https://example.com/${'"'.repeat(10)}${'a'.repeat(470)}` }] }), false],
  ['I: lone-surrogate header + contactLink 500ch + names 50', `{"siteName":"${lone(60)}","contact":"${lone(200)}","contactLink":"https://example.com/${'c'.repeat(480)}","targets":[{"name":"${lone(50)}","url":"https://example.com/"}]}`, false],
  ['I2: lone surrogate only in a name', `{"targets":[{"name":"${lone(50)}","url":"https://example.com/"}]}`, false],
  ['I3: lone surrogate only in contact', `{"contact":"${lone(200)}","targets":[{"name":"A","url":"https://example.com/"}]}`, false],
  ['paired surrogates via escapes are fine', `{"siteName":"${'\\ud83d\\ude00'.repeat(60)}","targets":[{"name":"${'\\ud83d\\ude00'.repeat(50)}","url":"https://example.com/"}]}`, true],
];

for (const [label, text, expectOk] of scenarios) {
  test(`QA T14 property, scenario ${label}`, () => {
    const r = worstCaseRoundTrip(text);
    assert.equal(r.ok, expectOk, JSON.stringify(r.cfg.errors));
    if (r.ok) {
      assert.equal(r.valid, true);
      const { targets, ...header } = JSON.parse(r.text);
      assert.ok(Buffer.byteLength(JSON.stringify(header)) <= 2048);
    } else {
      assert.ok(r.cfg.errors.length > 0);
    }
  });
}

test('QA T14: isValidStoredData rejects lone surrogates in stored text', () => {
  const d = sample();
  d.targets[0].name = 'Blog\ud800';
  assert.equal(isValidStoredData(d), false);
  const e = sample();
  e.contact = '\udc00';
  assert.equal(isValidStoredData(e), false);
});
