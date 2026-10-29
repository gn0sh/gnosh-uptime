import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRun, detectGap, targetId, isoSeconds } from '../src/state.js';
import { isValidStoredData } from '../src/datastore.js';

const REPO = 'gn0sh/gnosh-uptime';
const settings = { failuresBeforeAlert: 2, intervalMinutes: 15, staleAfterMinutes: 60, timeoutMs: 10000, contact: null, contactLink: null, siteName: null };
const T0 = Date.parse('2026-10-28T10:07:00Z');
const at = (k) => new Date(T0 + k * 15 * 60000);

function run(prev, ups, k, extra = {}) {
  const now = at(k);
  const results = Object.entries(ups).map(([name, up]) => ({ name, url: `https://${name.toLowerCase()}.example.com/`, up, reason: up ? null : 'HTTP 503', checkedAt: isoSeconds(now) }));
  return applyRun(prev, results, { settings: extra.settings ?? settings, configErrorCount: 0, repo: REPO, openIssueNumbers: extra.open ?? null }, now);
}

/** Simulates the issues layer: give each open action an issue number. */
function withIssues(out, open, next = { n: 100 }) {
  for (const a of out.actions) {
    if (a.type === 'open') {
      out.data.targets[a.index].issue = next.n;
      open.add(next.n++);
    }
    if (a.type === 'recover' || a.type === 'close-removed') open.delete(a.issue);
  }
  return out;
}

test('first run creates records with today counted', () => {
  const { data, actions } = run(null, { Blog: true }, 0);
  assert.deepEqual(actions, []);
  assert.equal(data.v, 1);
  assert.equal(data.lastRunAt, '2026-10-28T10:07:00Z');
  assert.deepEqual(data.targets[0].days, [['2026-10-28', 1, 1]]);
  assert.equal(data.targets[0].state, 'up');
  assert.equal(isValidStoredData(data), true);
});

test('A5: N=2, fail then pass opens nothing', () => {
  let out = run(null, { Shop: false }, 0);
  assert.deepEqual(out.actions, []);
  assert.equal(out.data.targets[0].failStreak, 1);
  out = run(out.data, { Shop: true }, 1);
  assert.deepEqual(out.actions, []);
  assert.equal(out.data.targets[0].failStreak, 0);
  assert.equal(out.data.targets[0].outageStartedAt, null);
});

test('A3: 5 failures give exactly one open action', () => {
  const open = new Set();
  let data = null;
  let opens = 0;
  for (let k = 0; k < 5; k++) {
    const out = withIssues(run(data, { Shop: false }, k, { open }), open);
    opens += out.actions.filter((a) => a.type === 'open').length;
    data = out.data;
  }
  assert.equal(opens, 1);
  assert.equal(data.targets[0].failStreak, 5);
  assert.equal(data.targets[0].outageStartedAt, '2026-10-28T10:07:00Z');
});

test('A4: recovery gives a recover action with start and recovery times', () => {
  const open = new Set();
  let data = null;
  for (let k = 0; k < 3; k++) data = withIssues(run(data, { Shop: false }, k, { open }), open).data;
  const out = run(data, { Shop: true }, 3, { open });
  assert.equal(out.actions.length, 1);
  const a = out.actions[0];
  assert.equal(a.type, 'recover');
  assert.equal(a.issue, 100);
  assert.equal(a.closedByPerson, false);
  assert.equal(a.outageStartedAt, '2026-10-28T10:07:00Z');
  assert.equal(a.recoveredAt, '2026-10-28T10:52:00Z');
  assert.equal(a.failedCount, 3);
  assert.equal(Date.parse(a.recoveredAt) - Date.parse(a.outageStartedAt), 45 * 60000);
  assert.equal(out.data.targets[0].issue, null);
});

test('A7: a person closes the issue; no reopen until recovery, then a later outage opens again', () => {
  const open = new Set();
  let data = null;
  for (let k = 0; k < 2; k++) data = withIssues(run(data, { Shop: false }, k, { open }), open).data;
  assert.equal(data.targets[0].issue, 100);
  open.delete(100); // a person closed it
  for (let k = 2; k < 6; k++) {
    const out = withIssues(run(data, { Shop: false }, k, { open }), open);
    assert.deepEqual(out.actions, [], `run ${k}`);
    data = out.data;
    assert.equal(data.targets[0].suppressed, true);
    assert.equal(data.targets[0].issue, 100); // SC-8: kept for the recovery comment
  }
  let out = withIssues(run(data, { Shop: true }, 6, { open }), open);
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].type, 'recover');
  assert.equal(out.actions[0].closedByPerson, true);
  data = out.data;
  assert.equal(data.targets[0].suppressed, false);
  data = withIssues(run(data, { Shop: false }, 7, { open }), open).data;
  out = withIssues(run(data, { Shop: false }, 8, { open }), open);
  assert.deepEqual(out.actions.map((a) => a.type), ['open']);
});

test('A9 logic: with 15-minute runs, the issue opens on the 2nd completed run after the outage starts', () => {
  const outageStart = T0 + 5 * 15 * 60000 + 3 * 60000; // between run 5 and run 6
  const open = new Set();
  let data = null;
  let openedAt = null;
  let completedAfterStart = 0;
  for (let k = 0; k < 12 && openedAt === null; k++) {
    const t = at(k).getTime();
    const up = t < outageStart;
    if (!up) completedAfterStart++;
    const out = withIssues(run(data, { Shop: up }, k, { open }), open);
    if (out.actions.some((a) => a.type === 'open')) openedAt = t;
    data = out.data;
  }
  assert.equal(completedAfterStart, 2);
  const latency = (openedAt - outageStart) / 60000;
  assert.ok(latency > 15 && latency <= 30, `latency ${latency}`);
});

test('days: older than 90 are pruned, today increments, UTC day boundary', () => {
  const prev = run(null, { Blog: true }, 0).data;
  prev.targets[0].days = [['2026-07-01', 96, 96], ['2026-07-30', 96, 90], ['2026-07-31', 96, 96], ['2026-10-28', 10, 9]];
  const out = run(prev, { Blog: false }, 1);
  // window is 2026-07-31 .. 2026-10-28 (90 days)
  assert.deepEqual(out.data.targets[0].days, [['2026-07-31', 96, 96], ['2026-10-28', 11, 9]]);
  const late = applyRun(out.data, [{ name: 'Blog', url: 'https://blog.example.com/', up: true, reason: null, checkedAt: '2026-10-29T00:01:00Z' }],
    { settings, configErrorCount: 0, repo: REPO }, new Date('2026-10-29T00:01:00Z'));
  assert.deepEqual(late.data.targets[0].days.at(-1), ['2026-10-29', 1, 1]);
  assert.deepEqual(late.data.targets[0].days.map((d) => d[0]), ['2026-10-28', '2026-10-29']); // 07-31 fell out
});

test('D4: a removed target is gone after one run, with close-removed when it had an issue', () => {
  const open = new Set();
  let data = null;
  for (let k = 0; k < 2; k++) data = withIssues(run(data, { Shop: false, Blog: true }, k, { open }), open).data;
  const out = run(data, { Blog: true }, 2, { open });
  assert.deepEqual(out.data.targets.map((t) => t.name), ['Blog']);
  assert.deepEqual(out.actions, [{ type: 'close-removed', name: 'Shop', issue: 100 }]);
  const quiet = run(run(null, { A: true, B: true }, 0).data, { A: true }, 1);
  assert.deepEqual(quiet.actions, []);
  assert.equal(quiet.data.targets.length, 1);
});

test('fixture 95 ok / 5 failed gives counts for 95.0%', () => {
  let data = null;
  for (let k = 0; k < 100; k++) {
    const now = new Date(Date.parse('2026-10-28T00:00:00Z') + k * 10 * 60000);
    data = applyRun(data, [{ name: 'Blog', url: 'https://blog.example.com/', up: k % 20 !== 0, reason: k % 20 ? null : 'timeout', checkedAt: isoSeconds(now) }],
      { settings: { ...settings, failuresBeforeAlert: 10 }, configErrorCount: 0, repo: REPO }, now).data;
  }
  const days = data.targets[0].days;
  const checks = days.reduce((s, d) => s + d[1], 0);
  const ok = days.reduce((s, d) => s + d[2], 0);
  assert.equal(checks, 100);
  assert.equal(ok, 95);
  assert.equal((Math.floor((ok / checks) * 1000) / 10).toFixed(1), '95.0');
});

test('header carries settings, configErrorCount, contact and lastRunAt', () => {
  const s = { ...settings, contact: 'Email us', contactLink: 'mailto:a@example.com', siteName: 'Co' };
  const { data } = applyRun(null, [], { settings: s, configErrorCount: 3, repo: REPO }, at(0));
  assert.equal(data.configErrorCount, 3);
  assert.equal(data.contact, 'Email us');
  assert.equal(data.contactLink, 'mailto:a@example.com');
  assert.equal(data.siteName, 'Co');
  assert.equal(data.intervalMinutes, 15);
  assert.deepEqual(data.targets, []);
});

test('records are built from known fields only', () => {
  const prev = run(null, { Blog: true }, 0).data;
  prev.targets[0].evil = '<script>';
  const { data } = run(prev, { Blog: true }, 1);
  assert.equal('evil' in data.targets[0], false);
});

test('detectGap', () => {
  assert.equal(detectGap(null, at(0), 60), null);
  assert.equal(detectGap('2026-10-28T10:00:00Z', new Date('2026-10-28T11:00:00Z'), 60), null);
  assert.deepEqual(detectGap('2026-10-28T08:00:00.000Z', new Date('2026-10-28T11:00:30Z'), 60),
    { from: '2026-10-28T08:00:00Z', to: '2026-10-28T11:00:30Z', minutes: 181 });
});

test('targetId is 12 hex chars and stable', () => {
  assert.match(targetId('Shop -->'), /^[0-9a-f]{12}$/);
  assert.equal(targetId('Shop'), targetId('Shop'));
  assert.notEqual(targetId('Shop'), targetId('shop'));
});
