// Workflow lint (T12 DoD; SEC3, X2, P8, K5, S5(b); threat model F6, F12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './helpers/mini-yaml.js';
import { deriveIntervalMinutes } from '../src/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, '.github', 'workflows');
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const text = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));
const parsed = Object.fromEntries(FILES.map((f) => [f, parseYaml(text[f])]));
const wf = (f) => parsed[f].value;
const steps = (job) => job.steps ?? [];
const allSteps = (f) => Object.values(wf(f).jobs).flatMap(steps);

// Exactly what each job may have. Anything more (or less) fails.
const EXPECTED_PERMISSIONS = {
  'monitor.yml': { keepalive: { actions: 'write', contents: 'read' }, monitor: { contents: 'write', issues: 'write' } },
  'validate.yml': { validate: { contents: 'read' } },
};
// The only expressions allowed anywhere (never inside run:, see below).
const ALLOWED_EXPRESSIONS = new Set([
  'github.token', 'github.repository',
]);

test('the expected workflows exist and parse', () => {
  // Internal tool, no public page: there is no Pages workflow (ADR-0005, superseded).
  assert.deepEqual(FILES, ['monitor.yml', 'validate.yml']);
  for (const f of FILES) assert.equal(typeof wf(f).jobs, 'object', f);
});

test('SEC3: no ${{ inside any run: block', () => {
  for (const f of FILES) {
    assert.ok(parsed[f].runBlocks.length > 0, `${f} has run steps`);
    for (const r of parsed[f].runBlocks) assert.ok(!r.text.includes('${{'), `${f} line ${r.line}: \${{ inside run:`);
  }
});

test('expressions use only GitHub-provided values, never secrets or event text', () => {
  for (const f of FILES) {
    for (const m of text[f].matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)) {
      assert.ok(ALLOWED_EXPRESSIONS.has(m[1]), `${f}: expression not allowed: ${m[0]}`);
    }
    assert.ok(!/\bsecrets\./.test(text[f]), `${f} uses secrets`);
  }
});

test('X2: permissions: {} at the top, and every job has exactly its minimal permissions', () => {
  for (const f of FILES) {
    assert.match(text[f], /^permissions: \{\}$/m, `${f} top-level permissions`);
    assert.deepEqual(wf(f).permissions, {}, f);
    const jobs = wf(f).jobs;
    assert.deepEqual(Object.keys(jobs).sort(), Object.keys(EXPECTED_PERMISSIONS[f]).sort(), `${f} job list`);
    for (const [name, job] of Object.entries(jobs)) {
      assert.deepEqual(job.permissions, EXPECTED_PERMISSIONS[f][name], `${f} ${name} permissions`);
    }
  }
});

test('T6: no pull_request_target or workflow_run triggers', () => {
  for (const f of FILES) {
    const on = wf(f).on;
    assert.ok(on && typeof on === 'object', `${f} has on:`);
    assert.ok(!('pull_request_target' in on) && !('workflow_run' in on), f);
    assert.ok(!/pull_request_target|workflow_run/.test(text[f]), f);
  }
});

test('T7: every uses: is a first-party action pinned to a 40-hex commit SHA', () => {
  for (const f of FILES) {
    const uses = allSteps(f).filter((s) => s.uses).map((s) => s.uses);
    assert.ok(uses.length > 0, f);
    for (const u of uses) assert.match(u, /^actions\/[a-z0-9-]+@[0-9a-f]{40}$/, `${f}: ${u}`);
    // Every pin carries a version comment so humans can review updates.
    for (const m of text[f].matchAll(/uses: (\S+)(.*)$/gm)) assert.match(m[2], /^ # v\d+\.\d+\.\d+$/, `${f}: ${m[1]}`);
  }
});

test('checkout never persists credentials; setup-node is Node 24 with no cache (F12)', () => {
  for (const f of FILES) {
    for (const s of allSteps(f)) {
      if (s.uses?.startsWith('actions/checkout@')) assert.equal(s.with?.['persist-credentials'], false, `${f} checkout`);
      if (s.uses?.startsWith('actions/setup-node@')) {
        assert.equal(s.with?.['node-version'], 24, `${f} node-version`);
        assert.equal(s.with?.['package-manager-cache'], false, `${f} package-manager-cache`);
        assert.ok(!('cache' in s.with), `${f} setup-node cache`);
      }
      assert.ok(!s.uses?.startsWith('actions/cache@'), `${f} uses actions/cache`);
    }
  }
});

test('every job has a timeout', () => {
  for (const f of FILES) for (const [n, j] of Object.entries(wf(f).jobs)) assert.ok(Number.isInteger(j['timeout-minutes']), `${f} ${n}`);
});

test('nothing deploys: no Pages or id-token permission, environment or deploy step anywhere', () => {
  for (const f of FILES) {
    for (const job of Object.values(wf(f).jobs)) {
      assert.ok(!('pages' in job.permissions) && !('id-token' in job.permissions), f);
      assert.ok(!('environment' in job), f);
    }
    assert.ok(!/deploy-pages|upload-pages-artifact|configure-pages|\bvars\./.test(text[f]), f);
  }
});

test('P8: monitor.yml never deploys', () => {
  const m = wf('monitor.yml');
  for (const job of Object.values(m.jobs)) {
    assert.ok(!('pages' in job.permissions) && !('id-token' in job.permissions));
    assert.ok(!('environment' in job));
  }
  assert.ok(!/deploy-pages|upload-pages-artifact|configure-pages|git push|build-site/.test(text['monitor.yml']));
});

test('monitor.yml: triggers, one-line cron = 15 minutes, concurrency, env, commands', () => {
  const m = wf('monitor.yml');
  assert.deepEqual(m.on.schedule, [{ cron: '7,22,37,52 * * * *' }]);
  assert.ok('workflow_dispatch' in m.on);
  assert.equal(deriveIntervalMinutes(text['monitor.yml']), 15, 'config.js reads the cron');
  assert.deepEqual(m.concurrency, { group: 'monitor', 'cancel-in-progress': false });
  for (const j of Object.values(m.jobs)) assert.equal(j['timeout-minutes'], 5);

  const runStep = (job) => steps(job).find((s) => s.run);
  const mon = runStep(m.jobs.monitor);
  assert.equal(mon.run, 'node src/cli.js run');
  assert.deepEqual(mon.env, { GITHUB_TOKEN: '${{ github.token }}', GITHUB_REPOSITORY: '${{ github.repository }}', UV_THREADPOOL_SIZE: '8' });
  // Manual runs only from the default branch; scheduled runs are always on it.
  assert.equal(m.jobs.monitor.if, "github.event_name == 'schedule' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");

  const ka = runStep(m.jobs.keepalive);
  assert.equal(ka.run, 'node src/cli.js keepalive');
  assert.deepEqual(ka.env, { GITHUB_TOKEN: '${{ github.token }}', GITHUB_REPOSITORY: '${{ github.repository }}' });
  assert.ok(!('needs' in m.jobs.keepalive) && !('needs' in m.jobs.monitor), 'jobs are independent');
  // R2: keepalive has the same gate (scheduled runs always pass it).
  assert.equal(m.jobs.keepalive.if, m.jobs.monitor.if, 'keepalive and monitor share the default-branch gate');
});

test('S5(b): the keepalive job has actions: write and nothing beyond contents: read', () => {
  assert.deepEqual(wf('monitor.yml').jobs.keepalive.permissions, { actions: 'write', contents: 'read' });
  assert.ok(!('actions' in wf('monitor.yml').jobs.monitor.permissions));
});

test('validate.yml: push and PR, validate + tests, required check name stable', () => {
  const v = wf('validate.yml');
  assert.ok('push' in v.on && 'pull_request' in v.on);
  assert.ok(!('paths' in (v.on.push ?? {})) && !('paths' in (v.on.pull_request ?? {})), 'no path filter on a required check');
  assert.equal(v.jobs.validate.name, 'validate');
  const runs = steps(v.jobs.validate).map((s) => s.run).filter(Boolean);
  assert.deepEqual(runs, ['node src/cli.js validate', 'npm test']);
  assert.ok(!/npx /.test(text['validate.yml']), 'no unlocked npx installs (F12)');
});

test('the lint parser rejects what it cannot read and finds run: blocks', () => {
  assert.throws(() => parseYaml('a: [1, 2]\n'));
  assert.throws(() => parseYaml('a: 1\na: 2\n'));
  const r = parseYaml('jobs:\n  j:\n    steps:\n      - run: |\n          echo "${{ x }}"\n        env:\n          A: b # c\n');
  assert.equal(r.runBlocks.length, 1);
  assert.ok(r.runBlocks[0].text.includes('${{'));
  assert.deepEqual(r.value.jobs.j.steps[0].env, { A: 'b' });
});
