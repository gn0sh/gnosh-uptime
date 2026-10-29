import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildModel, validateData, segmentsText, relTime, absTime, percentText, issueHref,
  reasonLine, durationWords, intervalWords, STALE_LABEL, loadingModel, safeContactHref, ISSUE_TRUST,
} from './render.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(FIX + n + '.json', 'utf8'));
const NOW = Date.parse('2026-10-28T14:12:00Z'); // the fixtures' last run is 14:05:12
const MIN = 60000;
const headline = (m) => segmentsText(m.headline);
const allText = (m) => JSON.stringify(m);
// Build-time meta values (threat model F2/F10): repo and contact never come from data.
const OPTS = { repo: 'gn0sh/gnosh-uptime', contact: 'Email help@example.com', contactLink: 'mailto:help@example.com' };
const build = (d, now = NOW, extra = {}) => buildModel(d, now, { ...OPTS, ...extra });

function target(over = {}) {
  return { name: 'Shop', url: 'https://shop.example.com/', state: 'up', lastCheckedAt: '2026-10-28T14:05:03Z',
    lastFailureReason: null, failStreak: 0, outageStartedAt: null, issue: null, suppressed: false,
    days: [['2026-10-28', 10, 10]], ...over };
}
function data(targets, over = {}) {
  return { v: 1, repo: 'gn0sh/gnosh-uptime', lastRunAt: '2026-10-28T14:05:12Z', intervalMinutes: 15,
    staleAfterMinutes: 60, failuresBeforeAlert: 2, contact: null, configErrorCount: 0, targets, ...over };
}

test('every fixture except wrong-version validates', () => {
  for (const f of readdirSync(FIX).filter((x) => x.endsWith('.json'))) {
    const r = validateData(fixture(f.slice(0, -5)));
    assert.equal(r.ok, f !== 'wrong-version.json', f + ' ' + JSON.stringify(r));
  }
});

test('P2: all-working summary sentence, first in the headline, with the time sentence (S1)', () => {
  const m = build(fixture('all-up'), NOW);
  assert.equal(m.pageState, 'all-up');
  assert.equal(headline(m), 'Everything is working. We last checked 6 minutes ago, at 14:05 UTC.');
  assert.equal(m.title, 'Everything is working – Example Co status');
  assert.ok(m.headline.some((s) => s.datetime === '2026-10-28T14:05:12Z'));
});

test('P2: one site down names it and says everything else is working', () => {
  const m = build(fixture('one-down'), NOW);
  assert.equal(m.pageState, 'some-down');
  assert.equal(headline(m),
    'Shop is not working right now. Everything else is working. We last checked 6 minutes ago, at 14:05 UTC.');
  assert.equal(m.title, 'Not working: Shop – Example Co status');
  assert.equal(m.problems.length, 1);
  assert.equal(segmentsText(m.problems[0].segs), 'Shop: read the outage report');
});

test('headline name forms: single target, 2, 3, 4+, all, long names', () => {
  const d = (n, T = 5) => data(Array.from({ length: T }, (_, i) =>
    target({ name: `S${i}`, state: i < n ? 'down' : 'up' })));
  assert.match(headline(build(data([target({ state: 'down' })]), NOW)), /^Shop is not working right now\. We last/);
  assert.match(headline(build(d(2), NOW)), /^S0 and S1 are not working right now\. Everything else is working\./);
  assert.match(headline(build(d(3), NOW)), /^S0, S1 and S2 are not working right now\. Everything else/);
  assert.match(headline(build(d(4), NOW)), /^4 of our 5 sites are not working right now\. They are listed below\./);
  assert.match(headline(build(d(5), NOW)), /^None of our sites are working right now\./);
  const long = data([target({ name: 'A'.repeat(45), state: 'down' }), target({ name: 'B'.repeat(45), state: 'down' }), target({ name: 'C' })]);
  assert.match(headline(build(long, NOW)), /^2 of our 3 sites are not working/);
  assert.equal(build(d(3), NOW).title, 'Not working: 3 sites – gnosh-uptime status');
});

test('partly checked: no "Everything is working", names the unchecked site', () => {
  const m = build(fixture('partly-checked'), NOW);
  assert.equal(m.pageState, 'partly');
  assert.match(headline(m), /^Everything we have checked is working\. We haven't checked Blog yet\. We last checked/);
  assert.ok(!headline(m).includes('Everything is working'));
});

test('never checked state', () => {
  const m = build(fixture('never-checked'), NOW);
  assert.equal(m.pageState, 'never');
  assert.equal(headline(m),
    "We haven't checked these sites yet, so we don't know if they're working. Please come back in about an hour.");
  assert.equal(m.targets[0].stateLabel, 'Not checked yet');
  assert.deepEqual(m.targets[0].uptime, [], 'F8: no uptime lines before the first check');
});

test('P3: per-target state words', () => {
  const m = build(fixture('one-down'), NOW);
  assert.deepEqual(m.targets.map((t) => t.stateLabel), ['Not working', 'Working', 'Working']);
  const shop = m.targets[0];
  assert.equal(segmentsText(shop.lines[0]), 'Not working since about 13:20 UTC (51 minutes ago).');
  assert.equal(segmentsText(shop.lines[1]), 'Last checked 6 minutes ago, at 14:05 UTC.');
  assert.equal(shop.reason, 'What we saw: the site took too long to answer.');
  assert.equal(segmentsText(m.targets[1].lines[0]), 'Last checked 6 minutes ago, at 14:05 UTC.');
});

test('S2/S3/S4: frozen data, clock moved past the threshold, goes stale', () => {
  const d = fixture('all-up');
  const fresh = build(d, Date.parse('2026-10-28T15:05:00Z')); // under 60 min since the last check
  assert.equal(fresh.pageState, 'all-up');
  const m = build(d, Date.parse('2026-10-28T15:05:13Z'));
  assert.equal(m.pageState, 'stale');
  assert.equal(headline(m),
    "We haven't been able to check recently, so we don't know if things are working. Our last check was 1 hour ago, at 14:05 UTC.");
  assert.equal(m.title, 'Not checked recently – Example Co status');
  const text = allText(m);
  assert.ok(!text.includes('Everything is working'), 'S4: no "Everything is working"');
  for (const c of m.targets) {
    assert.equal(c.stateLabel, STALE_LABEL);
    assert.notEqual(c.stateLabel, 'Working');
    assert.equal(segmentsText(c.lines[0]), 'When we last checked, 1 hour ago at 14:05 UTC, it was working.');
  }
  assert.ok(!/"Working"/.test(text), 'S4: no bare "Working" label anywhere');
  assert.equal(m.notices[0].kind, 'stale');
  assert.equal(m.notices[0].small[0].href, 'https://github.com/gn0sh/gnosh-uptime#if-checks-stop');
});

test('stale fixture: one target wording, issue link kept, stale beats "not working"', () => {
  const m = build(fixture('stale'), NOW);
  assert.equal(m.pageState, 'stale');
  assert.equal(m.problems.length, 0);
  assert.equal(segmentsText(m.targets[1].lines[0]), 'When we last checked, 5 hours ago at 09:10 UTC, it was not working.');
  assert.equal(m.targets[1].issue.href, 'https://github.com/gn0sh/gnosh-uptime/issues/42');
  const one = build(data([target()], { lastRunAt: '2026-10-28T09:00:00Z' }), NOW);
  assert.match(headline(one), /so we don't know if Shop is working\. Our last check was 5 hours ago/);
});

test('SC-3: a single target not checked for longer than the threshold is not "Working"', () => {
  const m = build(data([target({ lastCheckedAt: '2026-10-28T12:00:00Z' }), target({ name: 'Blog' })]), NOW);
  assert.equal(m.pageState, 'partly');
  assert.equal(m.targets[0].stateLabel, STALE_LABEL);
  assert.match(headline(m), /We haven't been able to check Shop recently\./);
});

test('P4/P5: 7- and 90-day percentages, days not checked excluded, 95/5 gives 95.0%', () => {
  const m = build(fixture('p5-95-5'), NOW);
  assert.deepEqual(m.targets[0].uptime, ['Last 7 days: 95.0% working', 'Last 90 days: 95.0% working']);
  const d = data([target({ days: [['2026-10-01', 100, 50], ['2026-10-26', 100, 100], ['2026-10-28', 100, 99]] })]);
  // The 1 October day is outside 7 days but inside 90; the missing days count for nothing.
  assert.deepEqual(build(d, NOW).targets[0].uptime, ['Last 7 days: 99.5% working', 'Last 90 days: 83.0% working']);
  // Days older than 90 are ignored.
  const old = data([target({ days: [['2026-07-01', 10, 0], ['2026-10-28', 10, 10]] })]);
  assert.equal(build(old, NOW).targets[0].uptime[1], 'Last 90 days: 100.0% working');
});

test('SC-6: percentages round down', () => {
  assert.equal(percentText(9996, 10000), '99.9%');
  assert.equal(percentText(95, 100), '95.0%');
  assert.equal(percentText(100, 100), '100.0%');
  assert.equal(percentText(0, 0), null);
  assert.equal(percentText(1, 3), '33.3%');
});

test('P4: a day with no record gets the not-checked label; history classes and summary', () => {
  const d = data([target({ days: [['2026-10-25', 96, 96], ['2026-10-27', 96, 60], ['2026-10-28', 10, 2]] })]);
  const h = build(d, NOW).targets[0].history;
  assert.equal(h.marks.length, 90);
  assert.deepEqual(h.marks.slice(-4).map((x) => x.cls), ['ok', 'none', 'some', 'most']);
  assert.equal(h.marks.filter((x) => x.cls === 'pre').length, 86);
  const byDate = Object.fromEntries(h.rows.map((r) => [r.date, r]));
  assert.equal(byDate['2026-10-26'].result, 'Not checked this day');
  assert.equal(byDate['2026-10-26'].checks, '0 checks');
  assert.equal(byDate['2026-10-26'].day, 'Monday 26 October');
  assert.equal(byDate['2026-10-27'].result, 'Some problems (62.5% working)');
  assert.equal(byDate['2026-10-28'].result, 'Mostly not working (20.0% working)');
  assert.equal(h.rows[0].date, '2026-10-28', 'newest first');
  assert.equal(h.summary, 'Since we started checking on Sunday 25 October: working all day on 1 day, '
    + 'problems on 2 days, not checked on 1 day. Most recent problem: Wednesday 28 October.');
  assert.equal(h.detailsSummary, 'Show day-by-day history for Shop');
  assert.equal(h.caption, 'Day-by-day history for Shop, newest first');
});

test('history summary for a full clean window', () => {
  const days = [];
  for (let i = 89; i >= 0; i--) days.push([new Date(NOW - i * 86400000).toISOString().slice(0, 10), 96, 96]);
  const h = build(data([target({ days })]), NOW).targets[0].history;
  assert.equal(h.summary, 'Working all day on every day in the last 90 days.');
  assert.equal(h.startLabel, '90 days ago');
});

test('P9: malformed data or wrong version gives the load-error model, never "Working"', () => {
  const cases = [null, 'x', [], {}, fixture('wrong-version'),
    data([target()], { lastRunAt: 'yesterday' }),
    data([target({ state: 'fine' })]),
    data([target({ days: [['2026-13-01', 1, 1]] })]),
    data([target({ days: [['2026-10-28', 1, 2]] })]),
    data([target({ name: 5 })]),
    data([target({ issue: '7' })]),
    data('nope'.split(''), { targets: 'x' }),
  ];
  for (const c of cases) {
    const m = build(c, NOW);
    assert.equal(m.pageState, 'error', JSON.stringify(c)?.slice(0, 80));
    assert.equal(headline(m), "We can't load the status right now.");
    assert.equal(m.targets.length, 0);
    assert.ok(!allText(m).includes('Working'));
    assert.equal(m.button.text, 'Try again');
    assert.equal(m.title, 'Status unavailable – gnosh-uptime status');
  }
});

test('P7: issue link only for a valid positive int and repo, and not for a human-closed issue', () => {
  assert.equal(issueHref('gn0sh/gnosh-uptime', 42), 'https://github.com/gn0sh/gnosh-uptime/issues/42');
  for (const [r, n] of [['gn0sh/gnosh-uptime', 0], ['gn0sh/gnosh-uptime', -1], ['gn0sh/gnosh-uptime', 1.5],
    ['gn0sh/gnosh-uptime', NaN], ['gn0sh/gnosh-uptime', '42'], ['evil.com/../x', 1], ['a/b/c', 1],
    ['javascript:alert(1)//x', 1], ['', 1], [null, 1], ['gn0sh/..', 1]]) {
    assert.equal(issueHref(r, n), null, `${r} ${n}`);
  }
  const card = (over) => build(data([target({ state: 'down', ...over }), target({ name: 'B' })])).targets[0];
  assert.equal(card({ issue: 42 }).issue.text, 'Read the outage report for Shop');
  assert.equal(card({ issue: 42 }).issueNote, "The report is on GitHub. You don't need an account to read it.");
  assert.equal(card({ issue: 1.5 }).issue, null);
  assert.equal(card({ issue: 1.5 }).nextCheck, "We'll check again soon.");
  assert.equal(build(data([target({ state: 'down', issue: 42 })]), NOW, { repo: 'not a repo' }).targets[0].issue, null);
  assert.equal(card({ issue: 42, suppressed: true }).issue, null);
  const m = build(data([target({ state: 'down', issue: null }), target({ name: 'B' })]), NOW);
  assert.deepEqual(m.problems[0].segs, [{ text: 'Shop' }]);
});

test('names are carried as plain text, never interpreted', () => {
  const m = build(fixture('long-names'), NOW);
  const evil = '<img src=x onerror=alert(1)>"&\'<script>alert(2)</script>';
  assert.equal(m.targets[0].name, evil);
  assert.ok(headline(m).startsWith(evil + ' is not working right now.'));
});

test('reason lines map the fixed vocabulary', () => {
  assert.equal(reasonLine('HTTP 404'), 'What we saw: the site answered with an error (code 404).');
  assert.equal(reasonLine('DNS failure'), "What we saw: we couldn't find the site's address.");
  assert.equal(reasonLine('TLS error'), "What we saw: there was a problem with the site's secure connection.");
  assert.equal(reasonLine('connection error'), "What we saw: we couldn't connect to the site.");
  assert.equal(reasonLine('too many redirects'), 'What we saw: the site kept sending us to other pages.');
  assert.equal(reasonLine('blocked redirect'), "What we saw: the site sent us to an address we don't check.");
  assert.equal(reasonLine('something new'), 'What we saw: something went wrong when we checked.');
  assert.equal(reasonLine(null), null);
});

test('time formatting', () => {
  assert.equal(relTime(NOW + 5 * MIN, NOW), 'less than a minute ago');
  assert.equal(relTime(NOW - 30000, NOW), 'less than a minute ago');
  assert.equal(relTime(NOW - MIN, NOW), '1 minute ago');
  assert.equal(relTime(NOW - 59 * MIN, NOW), '59 minutes ago');
  assert.equal(relTime(NOW - 119 * MIN, NOW), '1 hour ago');
  assert.equal(relTime(NOW - 47.9 * 60 * MIN, NOW), '47 hours ago');
  assert.equal(relTime(NOW - 50 * 60 * MIN, NOW), '2 days ago');
  assert.equal(absTime(Date.parse('2026-10-28T09:10:00Z'), NOW), '09:10 UTC');
  assert.equal(absTime(Date.parse('2026-10-27T14:05:00Z'), NOW), '14:05 UTC on Tuesday 27 October');
  assert.equal(absTime(Date.parse('2025-10-27T14:05:00Z'), NOW), '14:05 UTC on Monday 27 October 2025');
  assert.equal(durationWords(75 * MIN), '1 hour 15 minutes');
  assert.equal(durationWords((2 * 24 * 60 + 3 * 60 + 20) * MIN), '2 days 3 hours');
  assert.equal(intervalWords(15), '15 minutes');
  assert.equal(intervalWords(60), '1 hour');
});

test('F2: contact in status.json is ignored; only the build-time value shows', () => {
  const d = { ...fixture('all-up'), contact: 'Call the fake helpline', contactLink: 'https://evil.example/' };
  assert.equal(segmentsText(build(d).contact), 'Questions? Email help@example.com');
  assert.equal(buildModel(d, NOW, { repo: OPTS.repo }).contact, null);
});

test('F3: contact text links only https:/mailto: substrings, re-checked with new URL()', () => {
  const c = (text) => buildModel(fixture('all-up'), NOW, { contact: text }).contact;
  assert.deepEqual(c('Email mailto:help@example.com or see https://ok.example/help.'), [
    { text: 'Questions? Email ' }, { text: 'help@example.com', href: 'mailto:help@example.com' },
    { text: ' or see ' }, { text: 'https://ok.example/help', href: 'https://ok.example/help' }, { text: '.' }]);
  for (const evil of ['JaVaScRiPt:0,alert(1)', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:x', 'file:///etc/passwd', 'http://plain.example/']) {
    const segs = c('Go ' + evil);
    assert.ok(segs.every((s) => !s.href), evil);
    assert.equal(segmentsText(segs), 'Questions? Go ' + evil);
  }
  const mixed = c('https://ok.example javascript:1');
  assert.deepEqual(mixed.filter((s) => s.href).map((s) => s.href), ['https://ok.example/']);
  assert.ok(segmentsText(mixed).endsWith(' javascript:1'));
  assert.deepEqual(c('https://user:pw@evil.example/').filter((s) => s.href), []);
  for (const bad of ['JaVaScRiPt:0', 'data:text/html,x', 'mailto:a@b.co?subject=x', 'mailto:', 'https://', ' javascript:1']) {
    assert.equal(safeContactHref(bad), null, bad);
  }
  assert.equal(safeContactHref('MAILTO:help@example.com'), 'mailto:help@example.com');
});

test('F10: issue and README links use the deploy-time repo, never data.repo', () => {
  const d = { ...fixture('one-down'), repo: 'attacker/lookalike' };
  const m = build(d);
  assert.equal(m.targets[0].issue.href, 'https://github.com/gn0sh/gnosh-uptime/issues/42');
  assert.ok(!allText(m).includes('attacker'));
  const noRepo = buildModel(d, NOW, {});
  assert.equal(noRepo.targets[0].issue, null);
  assert.equal(noRepo.problems[0].segs.some((s) => s.href), false);
  const stale = buildModel({ ...fixture('stale'), repo: 'attacker/x' }, NOW, {});
  assert.equal(stale.notices[0].small[0].href, 'https://github.com/gn0sh/gnosh-uptime#if-checks-stop');
});

test('F1: outage links carry a line saying to trust only the site owner', () => {
  const m = build(fixture('one-down'));
  assert.equal(m.targets[0].issueTrust, ISSUE_TRUST);
  assert.equal(m.problemsNote, ISSUE_TRUST);
  assert.equal(m.targets[1].issueTrust, null);
  const noLink = build(data([target({ state: 'down' }), target({ name: 'B' })]));
  assert.equal(noLink.problemsNote, null);
  assert.equal(noLink.targets[0].issueTrust, null);
});

test('a lastRunAt in the future (visitor clock behind) is never negative', () => {
  const m = build(fixture('all-up'), Date.parse('2026-10-28T14:00:00Z'));
  assert.match(headline(m), /We last checked less than a minute ago/);
});

test('P11/SC-2/SC-7: contact line, link only for https: or mailto:', () => {
  const m = build(fixture('all-up'), NOW);
  assert.deepEqual(m.contact, [{ text: 'Questions? ' }, { text: 'Email help@example.com', href: 'mailto:help@example.com' }]);
  const c = (contact, contactLink) => buildModel(fixture('all-up'), NOW, { repo: OPTS.repo, contact, contactLink }).contact;
  assert.deepEqual(c('Questions? Call 555 0100 before 10:30'), [{ text: 'Questions? Call 555 0100 before 10:30' }]);
  assert.deepEqual(c('Help', 'javascript:alert(1)'), [{ text: 'Questions? Help' }]);
  assert.deepEqual(c(null, 'https://example.com/help'), [{ text: 'Questions? ' }, { text: 'Contact us', href: 'https://example.com/help' }]);
  assert.equal(c(null, null), null);
  assert.equal(safeContactHref('https://user:pw@example.com/'), null);
  assert.equal(safeContactHref('http://example.com/'), null);
  assert.equal(safeContactHref('mailto:a@b.co?subject=x'), null);
  // SC-7: the build-time contact still shows when data fails to load.
  const err = build(null, NOW, { contact: 'Email help@example.com', contactLink: 'mailto:help@example.com' });
  assert.equal(segmentsText(err.contact), 'Questions? Email help@example.com');
  assert.equal(loadingModel({ contact: 'Hi' }).contact[0].text, 'Questions? Hi');
});

test('A9/P6: about text uses the interval and makes no timing promises', () => {
  const m = build(fixture('all-up'), NOW);
  assert.match(m.about[0], /^We check each site about every 15 minutes\. Checks can be late/);
  assert.ok(m.about.some((p) => p.includes('about 30 to 60 minutes later')));
  const text = allText(m).toLowerCase();
  for (const w of ['guaranteed', 'real-time', 'realtime', 'instantly', 'before your users', 'exactly']) {
    assert.ok(!text.includes(w), w);
  }
});

test('no sites, many sites, refresh failure notice', () => {
  const none = build(fixture('no-sites'), NOW);
  assert.equal(none.pageState, 'none');
  assert.equal(headline(none), 'There are no sites on this status page yet.');
  const many = build(fixture('twenty-targets'), NOW);
  assert.equal(many.countLine, '20 sites');
  assert.equal(many.targets.length, 20);
  assert.match(headline(many), /^Site 8 is not working right now\. Everything else is working\./);
  const r = build(fixture('all-up'), NOW, { refreshFailedAtMs: NOW, lastGoodFetchMs: NOW - 6 * MIN });
  assert.equal(segmentsText(r.notices[0].text), "We couldn't get newer information. This page shows what we knew 6 minutes ago.");
});

test('loading model', () => {
  const m = loadingModel({ siteName: 'Example Co' });
  assert.equal(headline(m), 'Getting the latest status…');
  assert.equal(m.title, 'Example Co status');
});

test('code review F8: never-checked cards show no uptime lines in any page state', () => {
  for (const f of ['never-checked', 'partly-checked']) {
    for (const c of build(fixture(f)).targets.filter((x) => x.stateLabel === 'Not checked yet')) {
      assert.deepEqual(c.uptime, [], f);
      assert.ok(!JSON.stringify(c).includes('% working'), f);
    }
  }
  assert.equal(build(fixture('partly-checked')).targets[0].uptime.length, 2, 'checked cards keep them');
});

test('code review F2: configErrorCount > 0 never shows the all-working state', () => {
  const setup = "We couldn't check 2 of our sites because of a setup problem.";
  const m = build({ ...fixture('all-up'), configErrorCount: 2 });
  assert.equal(m.pageState, 'partly');
  assert.equal(headline(m), `Everything we have checked is working. ${setup} We last checked 6 minutes ago, at 14:05 UTC.`);
  assert.ok(!allText(m).includes('Everything is working'));
  assert.equal(m.title, 'Some sites not checked – Example Co status');
  const one = build({ ...fixture('one-down'), configErrorCount: 2 });
  assert.equal(one.pageState, 'some-down');
  assert.ok(!headline(one).includes('Everything else is working'));
  assert.match(headline(one), /^Shop is not working right now\. We couldn't check 2 of our sites because of a setup problem\./);
  for (const f of ['stale', 'never-checked', 'no-sites']) {
    const x = build({ ...fixture(f), configErrorCount: 2 });
    assert.ok(x.notices.some((n) => n.kind === 'setup' && segmentsText(n.text) === setup), f);
  }
  assert.equal(build(fixture('all-up')).pageState, 'all-up', 'zero errors is unchanged');
});
