import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inert, code, inertTitle, fmtDuration, fmtTime, ensureLabels, listBotIssues, syncOutages, syncConfigErrorIssue,
  reportStaleGap, outageBody, outageTitle, configErrorBody, LABELS, parseStaleLog, STALE_LOG_TITLE, STALE_LOG_MAX,
} from '../src/issues.js';
import { applyRun, isoSeconds, targetId } from '../src/state.js';
import { FakeGitHub, BOT } from './helpers/fake-github.js';

const settings = { failuresBeforeAlert: 2, intervalMinutes: 15, staleAfterMinutes: 60, timeoutMs: 10000 };
const ZW = '​';

/** True if text has no live mention, link, HTML or issue reference in Markdown. */
function looksInert(s) {
  return !/@[A-Za-z0-9]/.test(s) && !/#\d/.test(s) && !/https?:\/\//.test(s) && !/(^|[^\\])<[a-z/!]/i.test(s) && !/(^|[^\\])\]\(/.test(s) && !/(^|[^\\])&[a-z]+;/i.test(s);
}

test('inert() neutralizes mentions, links, HTML, references and entities (SEC2)', () => {
  const out = inert('@octocat [x](https://evil.example) <b>#1 &commat;user www.evil.example');
  assert.ok(looksInert(out), out);
  assert.ok(out.includes(`@${ZW}octocat`));
  assert.ok(out.includes(`#${ZW}1`));
  assert.ok(out.includes('\\[x\\]\\('));
  assert.ok(out.includes('\\<b\\>'));
  assert.ok(out.includes('\\&commat;'));
  assert.ok(out.includes(`www${ZW}`));
  assert.equal(inert('a\nb‮c'), 'a b c');
});

test('code() wraps values in a fence longer than any backtick run (F4)', () => {
  assert.equal(code('Shop'), '` Shop `');
  assert.equal(code('a`b'), '`` a`b ``');
  assert.equal(code('``x'), '``` ``x ```');
  assert.equal(code('`'), '`` ` ``');
  assert.equal(code('&commat;octocat'), '` &commat;octocat `');
  assert.equal(code(''), '(empty)');
  assert.equal(code('a‮\n b'), '` a b `');
});

test('inertTitle has no backslash escapes and breaks mentions and references (F9)', () => {
  const t = inertTitle('Blog.example @octocat #12 https://x.example ‮evil');
  assert.equal(t.includes('\\'), false);
  assert.ok(t.startsWith('Blog.example'));
  assert.ok(looksInert(t), t);
  assert.equal(outageTitle('Shop'), 'Shop is down');
});

test('fmtDuration and fmtTime follow design §3.6', () => {
  assert.equal(fmtDuration(5 * 60000), '5 minutes');
  assert.equal(fmtDuration(60000), '1 minute');
  assert.equal(fmtDuration(10000), '1 minute');
  assert.equal(fmtDuration(75 * 60000), '1 hour 15 minutes');
  assert.equal(fmtDuration(295 * 60000), '4 hours 55 minutes');
  assert.equal(fmtDuration(120 * 60000), '2 hours');
  assert.equal(fmtDuration((51 * 60 + 20) * 60000), '2 days 3 hours');
  assert.equal(fmtDuration(72 * 3600000), '3 days');
  assert.equal(fmtTime('2026-10-28T14:05:12Z'), '2026-10-28 14:05 UTC');
});

test('A6: labels are created only when missing', async () => {
  const fake = new FakeGitHub();
  fake.labels.set('outage', { name: 'outage' });
  const gh = fake.client();
  assert.deepEqual(await ensureLabels(gh), ['monitor-stale', 'config-error']);
  assert.deepEqual(await ensureLabels(gh), []);
  assert.equal(fake.callsTo('POST', /labels$/).length, 2);
  assert.equal(fake.labels.get('config-error').description, LABELS[2].description);
});

test('listBotIssues filters out issues by people, pull requests and other labels (F14)', async () => {
  const fake = new FakeGitHub();
  fake.addIssue({ title: 'bot', body: 'x', labels: ['outage'] });
  fake.addIssue({ title: 'human', body: 'x', labels: ['outage'], user: { login: 'mallory', type: 'User' } });
  fake.addIssue({ title: 'fake bot', body: 'x', labels: ['outage'], user: { login: 'github-actions[bot]', type: 'User' } });
  fake.addIssue({ title: 'pr', body: 'x', labels: ['outage'], pull_request: true });
  const list = await listBotIssues(fake.client(), 'outage');
  assert.deepEqual(list.map((i) => i.title), ['bot']);
});

function runWith(prev, up, k, open) {
  const now = new Date(Date.parse('2026-10-28T10:07:00Z') + k * 15 * 60000);
  return applyRun(prev, [{ name: 'Shop', url: 'https://shop.example.com/', up, reason: up ? null : 'timeout', checkedAt: isoSeconds(now) }],
    { settings, configErrorCount: 0, repo: 'gn0sh/gnosh-uptime', openIssueNumbers: open }, now);
}

async function cycle(fake, prev, up, k) {
  const gh = fake.client();
  const openIssues = await listBotIssues(gh, 'outage');
  const out = runWith(prev, up, k, new Set(openIssues.map((i) => i.number)));
  const warnings = [];
  await syncOutages(gh, { actions: out.actions, data: out.data, openIssues, settings, warn: (w) => warnings.push(w) });
  return { data: out.data, warnings };
}

test('outage open is locked (F1), adopts an existing marker issue (K5) and recovery comments and closes (A4)', async () => {
  const fake = new FakeGitHub();
  let { data } = await cycle(fake, null, false, 0);
  assert.equal(fake.issues.length, 0);
  ({ data } = await cycle(fake, data, false, 1));
  assert.equal(fake.issues.length, 1);
  const issue = fake.issues[0];
  assert.equal(issue.locked, true);
  assert.equal(issue.lock_reason, 'resolved');
  assert.equal(issue.title, 'Shop is down');
  assert.ok(issue.body.includes(`<!-- gnosh-uptime:outage:${targetId('Shop')} -->`));
  assert.ok(issue.body.includes('2026-10-28 10:07 UTC'));
  assert.ok(issue.body.includes('No answer within 10 seconds (timeout)'));
  assert.ok(issue.body.includes('` https://shop.example.com/ `'));
  assert.equal(data.targets[0].issue, issue.number);
  for (let k = 2; k < 5; k++) ({ data } = await cycle(fake, data, false, k));
  assert.equal(fake.issues.length, 1);
  ({ data } = await cycle(fake, data, true, 5));
  assert.equal(issue.state, 'closed');
  assert.equal(issue.state_reason, 'completed');
  assert.match(issue.comments[0], /is working again/);
  assert.match(issue.comments[0], /about 1 hour 15 minutes/);
  assert.match(issue.comments[0], /\| Failed checks \| 5 \|/);
});

test('K5: data lost after an issue was opened: the existing marker issue is adopted, not duplicated', async () => {
  const fake = new FakeGitHub();
  let { data } = await cycle(fake, null, false, 0);
  ({ data } = await cycle(fake, data, false, 1));
  assert.equal(fake.issues.length, 1);
  fake.issues[0].locked = false;
  // the run died before writing: replay from the older data
  const replay = await cycle(fake, null, false, 2);
  assert.equal(fake.issues.length, 1);
  assert.equal(replay.data.targets[0].issue, fake.issues[0].number);
  assert.equal(fake.issues[0].locked, true);
  const replay2 = await cycle(fake, (await cycle(fake, null, false, 3)).data, false, 4);
  assert.equal(fake.issues.length, 1);
  assert.equal(replay2.data.targets[0].issue, fake.issues[0].number);
});

test('F14: a planted issue with our marker by a person is never adopted', async () => {
  const fake = new FakeGitHub();
  fake.addIssue({ title: 'Shop is down', body: `<!-- gnosh-uptime:outage:${targetId('Shop')} -->`, labels: ['outage'], user: { login: 'mallory', type: 'User' } });
  let { data } = await cycle(fake, null, false, 0);
  ({ data } = await cycle(fake, data, false, 1));
  assert.equal(fake.issues.length, 2);
  assert.equal(data.targets[0].issue, 2);
  assert.equal(fake.issues[0].comments.length, 0);
});

test('A7 + SC-8: a person closes the issue; no reopen; recovery comment on the closed issue', async () => {
  const fake = new FakeGitHub();
  let { data } = await cycle(fake, null, false, 0);
  ({ data } = await cycle(fake, data, false, 1));
  const issue = fake.issues[0];
  issue.state = 'closed';
  for (let k = 2; k < 5; k++) ({ data } = await cycle(fake, data, false, k));
  assert.equal(fake.issues.length, 1);
  assert.equal(issue.state, 'closed');
  ({ data } = await cycle(fake, data, true, 5));
  assert.equal(issue.state, 'closed');
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0], /is working again/);
  assert.doesNotMatch(issue.comments[0], /Closing this issue/);
  assert.equal(fake.callsTo('PATCH', /issues\/1$/).length, 0);
});

test('F5: a tampered issue number in data is never commented on or closed', async () => {
  const fake = new FakeGitHub();
  const pr = fake.addIssue({ title: 'Someone else', body: 'x', labels: ['bug'], user: { login: 'alice', type: 'User' } });
  let { data } = await cycle(fake, null, false, 0);
  data.targets[0].issue = pr.number; // tampered
  data.targets[0].failStreak = 3;
  const res = await cycle(fake, data, true, 1);
  assert.equal(pr.comments.length, 0);
  assert.equal(pr.state, 'open');
  assert.equal(res.warnings.length, 1);
});

test('removed target: its open issue is closed as no longer monitored', async () => {
  const fake = new FakeGitHub();
  let { data } = await cycle(fake, null, false, 0);
  ({ data } = await cycle(fake, data, false, 1));
  const gh = fake.client();
  const openIssues = await listBotIssues(gh, 'outage');
  const now = new Date('2026-10-28T12:00:00Z');
  const out = applyRun(data, [], { settings, configErrorCount: 0, repo: 'gn0sh/gnosh-uptime', openIssueNumbers: new Set([1]) }, now);
  await syncOutages(gh, { actions: out.actions, data: out.data, openIssues, settings });
  assert.equal(fake.issues[0].state, 'closed');
  assert.match(fake.issues[0].comments[0], /No longer monitored/);
});

test('lock failure is a warning, not a failure', async () => {
  const fake = new FakeGitHub();
  fake.hooks.push((m, p) => (m === 'PUT' && p.endsWith('/lock') ? { status: 403, json: {} } : undefined));
  let { data } = await cycle(fake, null, false, 0);
  const r = await cycle(fake, data, false, 1);
  assert.equal(fake.issues.length, 1);
  assert.match(r.warnings[0], /Could not lock issue #1/);
});

test('A8/SEC2: outage body holds only monitor text and neutralized config values', () => {
  const name = '@octocat [x](https://evil.example) <b>#1 &commat;someone www.evil.example a`b';
  const body = outageBody({ name, url: 'https://shop.example.com/?q=<script>', reason: 'HTTP 503', outageStartedAt: '2026-10-28T10:07:00Z', failedCount: 2 }, settings);
  assert.ok(body.includes('`` @octocat [x](https://evil.example) <b>#1 &commat;someone www.evil.example a`b ``'));
  assert.ok(body.includes('The site answered with HTTP 503'));
  const outsideCode = body.replace(/(`+) [\s\S]*? \1/g, '');
  assert.ok(!outsideCode.includes('octocat'));
  assert.ok(!outsideCode.includes('<script>'));
  assert.ok(!outsideCode.includes('<b>'));
});

const badErrors = [{ entry: 'Site #3 "Bad"', reason: 'The address must start with https:// or http://.', line: 9, index: 3, name: '@octocat [x](https://evil.example)' }];

test('C6: 3 runs with one bad entry give exactly one config-error issue; closes with a comment when valid', async () => {
  const fake = new FakeGitHub();
  const gh = fake.client();
  const r1 = await syncConfigErrorIssue(gh, { errors: badErrors, validCount: 2 });
  const r2 = await syncConfigErrorIssue(gh, { errors: badErrors, validCount: 2 });
  const r3 = await syncConfigErrorIssue(gh, { errors: badErrors, validCount: 2 });
  assert.deepEqual([r1.action, r2.action, r3.action], ['opened', 'unchanged', 'unchanged']);
  assert.equal(fake.issues.length, 1);
  const issue = fake.issues[0];
  assert.equal(issue.locked, true);
  assert.equal(issue.title, 'Config file has problems: some sites are not being checked');
  assert.ok(issue.body.includes('| Site 3 **` @octocat [x](https://evil.example) `** (line 9) |'));
  assert.ok(issue.body.includes('Your other **2** site(s)'));
  const r4 = await syncConfigErrorIssue(gh, { errors: [...badErrors, { entry: 'Setting "timeoutSeconds"', reason: 'Must be a whole number from 1 to 30.', line: 4 }], validCount: 2 });
  assert.equal(r4.action, 'updated');
  assert.equal(fake.issues.length, 1);
  assert.match(issue.comments.at(-1), /The list of problems changed. There are now 2 problem/);
  const r5 = await syncConfigErrorIssue(gh, { errors: [], validCount: 3 });
  assert.equal(r5.action, 'closed');
  assert.equal(issue.state, 'closed');
  assert.match(issue.comments.at(-1), /no problems now. All \*\*3\*\* site\(s\)/);
  assert.equal((await syncConfigErrorIssue(gh, { errors: [], validCount: 3 })).action, 'none');
});

test('config-error body: reasons are inert and the bad URL is not repeated', () => {
  const { body } = configErrorBody([{ entry: 'Site #1 "A"', reason: '"@octocat" is not a known setting for a site.', line: 3, index: 1, name: 'A' }], 0, 'gn0sh/gnosh-uptime');
  const row = body.split('\n').find((l) => l.startsWith('| Site 1'));
  assert.ok(looksInert(row.replace(/`[^`]*`/g, '')), row);
});

test('S7: a gap over 8 hours reported twice (retry) gives one issue, also after the owner closed it', async () => {
  const fake = new FakeGitHub({ now: () => new Date('2026-10-28T18:05:00Z') });
  const gh = fake.client();
  const gap = { from: '2026-10-28T09:10:00Z', to: '2026-10-28T18:05:00Z', minutes: 535 };
  const r1 = await reportStaleGap(gh, { gap, settings, now: new Date('2026-10-28T18:05:00Z') });
  assert.equal(r1.action, 'opened');
  const issue = fake.issues[0];
  assert.equal(issue.title, 'Monitor was stale from 2026-10-28 09:10 UTC to 2026-10-28 18:05 UTC');
  assert.match(issue.body, /did not run for \*\*8 hours 55 minutes\*\*/);
  assert.match(issue.body, /#if-checks-stop/);
  assert.equal(issue.locked, true);
  issue.state = 'closed';
  const r2 = await reportStaleGap(gh, { gap: { ...gap, to: '2026-10-28T18:20:00Z' }, settings, now: new Date('2026-10-28T18:20:00Z') });
  assert.equal(r2.action, 'exists');
  assert.equal(fake.issues.length, 1);
});

test('S7: gaps up to 8 hours go to one rolling log issue, edited in place with no comments', async () => {
  const fake = new FakeGitHub({ now: () => new Date('2026-10-29T06:23:00Z') });
  const gh = fake.client();
  const gaps = [
    { from: '2026-10-29T00:53:00Z', to: '2026-10-29T06:23:00Z' },
    { from: '2026-10-29T06:23:00Z', to: '2026-10-29T13:39:00Z' },
    { from: '2026-10-29T13:39:00Z', to: '2026-10-29T21:39:00Z' }, // exactly 8 hours: still logged
  ];
  for (const g of gaps) assert.equal((await reportStaleGap(gh, { gap: g, settings, now: new Date(g.to) })).action, 'logged');
  assert.equal(fake.issues.length, 1);
  const log = fake.issues[0];
  assert.equal(log.title, STALE_LOG_TITLE);
  assert.equal(log.locked, true);
  assert.deepEqual(log.comments, []);
  assert.deepEqual(parseStaleLog(log.body).map((g) => g.from), ['2026-10-29T13:39:00Z', '2026-10-29T06:23:00Z', '2026-10-29T00:53:00Z']);
  assert.match(log.body, /\| 2026-10-29 06:23 UTC \| 2026-10-29 13:39 UTC \| 7 hours 16 minutes \|/);
  // a retry of the same gap changes nothing
  const before = log.body;
  assert.equal((await reportStaleGap(gh, { gap: gaps[0], settings, now: new Date('2026-10-29T22:00:00Z') })).action, 'exists');
  assert.equal(log.body, before);
  // once the owner closes it, the next short gap starts a new log
  log.state = 'closed';
  await reportStaleGap(gh, { gap: { from: '2026-10-30T00:00:00Z', to: '2026-10-30T03:00:00Z' }, settings, now: new Date('2026-10-30T03:00:00Z') });
  assert.equal(fake.issues.length, 2);
  assert.equal(parseStaleLog(fake.issues[1].body).length, 1);
});

test('review stale-boundary-retry: a logged gap whose retry crosses 8 hours is not escalated', async () => {
  const fake = new FakeGitHub();
  const gh = fake.client();
  const gap = { from: '2026-10-28T09:00:00Z', to: '2026-10-28T16:55:00Z' };
  assert.equal((await reportStaleGap(gh, { gap, settings, now: new Date(gap.to) })).action, 'logged');
  const r = await reportStaleGap(gh, { gap: { ...gap, to: '2026-10-28T17:10:00Z' }, settings, now: new Date('2026-10-28T17:10:00Z') });
  assert.equal(r.action, 'exists');
  assert.equal(fake.issues.length, 1);
});

test('S7: the rolling log keeps the newest gaps and drops bad stored entries (F5)', async () => {
  const fake = new FakeGitHub();
  const gh = fake.client();
  const start = Date.parse('2026-10-01T00:00:00Z');
  for (let k = 0; k < STALE_LOG_MAX + 5; k += 1) {
    const from = new Date(start + k * 6 * 3600000).toISOString();
    await reportStaleGap(gh, { gap: { from, to: new Date(Date.parse(from) + 2 * 3600000).toISOString() }, settings, now: new Date(from) });
  }
  const kept = parseStaleLog(fake.issues[0].body);
  assert.equal(kept.length, STALE_LOG_MAX);
  assert.equal(kept[0].from, new Date(start + (STALE_LOG_MAX + 4) * 6 * 3600000).toISOString().replace('.000Z', 'Z'));
  assert.deepEqual(parseStaleLog('<!-- gnosh-uptime:stale-log-data:2026-10-01T00:00:00Z/2026-10-01T02:00:00Z,2026-13-01T00:00:00Z/2026-13-01T01:00:00Z,2026-10-02T05:00:00Z/2026-10-02T01:00:00Z -->'),
    [{ from: '2026-10-01T00:00:00Z', to: '2026-10-01T02:00:00Z' }]);
  assert.deepEqual(parseStaleLog('no marker'), []);
});

test('review F4: two open bot issues for one target: the linked one is kept, the other closed as a duplicate, stable over runs', async () => {
  const fake = new FakeGitHub();
  let { data } = await cycle(fake, null, false, 0);
  ({ data } = await cycle(fake, data, false, 1));
  const a = fake.issues[0];
  const b = fake.addIssue({ title: 'Shop is down', body: a.body, labels: ['outage'] }); // orphan duplicate
  ({ data } = await cycle(fake, data, false, 2));
  assert.equal(data.targets[0].issue, a.number);
  assert.equal(b.state, 'closed');
  assert.match(b.comments[0], new RegExp(`duplicate of #${a.number}`));
  ({ data } = await cycle(fake, data, false, 3));
  assert.equal(data.targets[0].issue, a.number);
  assert.equal(a.state, 'open');
});

test('review F4: data lost and two marker issues open: the lowest is adopted, the other closed', async () => {
  const fake = new FakeGitHub();
  const body = `x\n<!-- gnosh-uptime:outage:${targetId('Shop')} -->`;
  fake.addIssue({ title: 'Shop is down', body, labels: ['outage'] });
  fake.addIssue({ title: 'Shop is down', body, labels: ['outage'] });
  const { data } = await cycle(fake, null, false, 0);
  assert.equal(data.targets[0].issue, 1);
  assert.equal(fake.issues[1].state, 'closed');
  assert.equal(fake.issues[0].state, 'open');
});

test('review F5: someone removes the outage label; on recovery the still-open issue gets the comment and is closed', async () => {
  const fake = new FakeGitHub();
  let { data } = await cycle(fake, null, false, 0);
  ({ data } = await cycle(fake, data, false, 1));
  const issue = fake.issues[0];
  issue.labels = [];
  ({ data } = await cycle(fake, data, false, 2));
  assert.equal(data.targets[0].suppressed, true);
  await cycle(fake, data, true, 3);
  assert.equal(issue.state, 'closed');
  assert.match(issue.comments[0], /is working again/);
  assert.match(issue.comments[0], /Closing this issue/);
});

test('review F6: the stale issue names a config problem as a possible cause', () => {
  // staleBody is exercised through reportStaleGap above; check the cause line here
  return import('../src/issues.js').then(({ staleBody }) => {
    const body = staleBody({ from: '2026-10-28T09:10:00Z', to: '2026-10-28T14:05:00Z' }, settings, 'gn0sh/gnosh-uptime');
    assert.match(body, /config file had a problem that stopped every site from being checked/);
  });
});

test('QA T18 B1: config-error title and body depend on what the errors did', async () => {
  const setting = [{ entry: 'Setting "timeoutSecond"', reason: 'This setting is not known.', line: 2 }];
  const site = [{ entry: 'Site #2 "Bad"', reason: 'The address must start with https:// or http://.', line: 5, index: 2, name: 'Bad' }];
  const settingsOnly = configErrorBody(setting, 3, 'gn0sh/gnosh-uptime');
  assert.equal(settingsOnly.title, 'Config file has problems');
  assert.match(settingsOnly.body, /No site is skipped: all \*\*3\*\* site\(s\) are still being checked/);
  assert.doesNotMatch(settingsOnly.body, /skipping/);
  const some = configErrorBody([...setting, ...site], 2, 'gn0sh/gnosh-uptime');
  assert.equal(some.title, 'Config file has problems: some sites are not being checked');
  assert.match(some.body, /It is skipping \*\*1\*\* site\(s\) listed below. Your other \*\*2\*\* site\(s\) are still being checked/);
  const unparsed = configErrorBody([{ entry: 'The config file', reason: 'The file is not valid JSON.', line: 3 }], 0, 'gn0sh/gnosh-uptime', false);
  assert.equal(unparsed.title, 'Config file has problems: no sites are being checked');
  assert.match(unparsed.body, /no sites are checked/);
  assert.doesNotMatch(unparsed.body, /Your other/);
  const allBad = configErrorBody(site, 0, 'gn0sh/gnosh-uptime');
  assert.equal(allBad.title, 'Config file has problems: no sites are being checked');
});

test('QA T18 B1: when the impact changes, the open issue title is updated too', async () => {
  const fake = new FakeGitHub();
  const gh = fake.client();
  await syncConfigErrorIssue(gh, { errors: [{ entry: 'Setting "x"', reason: 'r', line: 1 }], validCount: 3 });
  assert.equal(fake.issues[0].title, 'Config file has problems');
  await syncConfigErrorIssue(gh, { errors: [{ entry: 'The config file', reason: 'not valid JSON', line: 1 }], validCount: 0, parsed: false });
  assert.equal(fake.issues.length, 1);
  assert.equal(fake.issues[0].title, 'Config file has problems: no sites are being checked');
});

test('QA T18 B5: the stale issue uses wording that fits one or many sites', async () => {
  const { staleBody } = await import('../src/issues.js');
  const body = staleBody({ from: '2026-10-28T09:10:00Z', to: '2026-10-28T14:05:00Z' }, settings, 'gn0sh/gnosh-uptime');
  assert.match(body, /the status page told visitors that we haven't been able to check recently/);
  assert.doesNotMatch(body, /it's working/);
});
