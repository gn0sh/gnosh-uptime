import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepalive, keepaliveReport } from '../src/keepalive.js';
import { FakeGitHub } from './helpers/fake-github.js';

test('every invocation calls PUT .../actions/workflows/monitor.yml/enable and only that', async () => {
  const fake = new FakeGitHub();
  const r = await keepalive({ gh: fake.client(), now: () => new Date('2026-10-28T14:05:00Z') });
  assert.deepEqual(r, { ok: true, status: 204, at: '2026-10-28T14:05:00Z' });
  assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), ['PUT /repos/gn0sh/gnosh-uptime/actions/workflows/monitor.yml/enable']);
});

test('60 days of 15-minute runs, also with half the runs dropped: the largest gap between calls is far below 60 days', async () => {
  for (const dropRate of [0, 0.5]) {
    const fake = new FakeGitHub();
    const gh = fake.client();
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const start = Date.parse('2026-10-01T00:07:00Z');
    const callTimes = [];
    for (let t = start; t < start + 60 * 86400000; t += 15 * 60000) {
      if (rand() < dropRate) continue;
      const before = fake.calls.length;
      await keepalive({ gh, now: () => new Date(t) });
      if (fake.calls.length > before) callTimes.push(t);
    }
    let maxGap = 0;
    for (let k = 1; k < callTimes.length; k++) maxGap = Math.max(maxGap, callTimes[k] - callTimes[k - 1]);
    assert.ok(callTimes.length > 1000);
    assert.ok(maxGap < 86400000, `max gap ${maxGap / 60000} minutes`);
  }
});

test('a non-204 response gives ok:false, a ::warning:: line and a summary line', async () => {
  const fake = new FakeGitHub();
  fake.enableStatus = 403;
  const r = await keepalive({ gh: fake.client() });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  const rep = keepaliveReport(r, 'gn0sh/gnosh-uptime');
  assert.match(rep.warning, /^::warning::Keepalive failed \(HTTP 403\)/);
  assert.match(rep.summary, /Keepalive failed \(HTTP 403\)/);
  assert.match(rep.summary, /#if-checks-stop/);
});

test('a network error gives ok:false with status null and never throws', async () => {
  const gh = async () => { throw new Error('ECONNRESET'); };
  gh.repo = 'gn0sh/gnosh-uptime';
  const r = await keepalive({ gh });
  assert.equal(r.ok, false);
  assert.equal(r.status, null);
  assert.match(keepaliveReport(r).warning, /no response/);
});
