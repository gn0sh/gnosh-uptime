#!/usr/bin/env node
// T14: data bound (AC-D3) and one-year git history growth simulation (Risk R3).
//
// Not part of `npm test` (its glob is test/**/*.test.js) and it skips itself
// under a bare `node --test`. It makes no network calls and never pushes:
// it writes only to a scratch directory.
//
//   node test/sim/history-growth.mjs [--days 365] [--runs-per-day 96]
//        [--targets 20] [--seed 14] [--dir <scratch>] [--no-git] [--keep]
//
// Phase 1 (bounds): feeds worst-case, config-valid inputs through the real
//   parseConfig -> applyRun -> serializeData -> JSON.parse -> isValidStoredData
//   path and reports which ones fit the D3 record/header asserts.
// Phase 2 (year): days x runs-per-day runs of applyRun for N targets with
//   maximum-length names and URLs. Every run's output is serialized with the
//   production writer, read back through the production validator and used
//   as the next run's input, exactly like readData/writeData. Asserts the file
//   stays under 1 MB (and the 256 KB writer cap). Each version is committed
//   to an orphan branch in a scratch git repo via git fast-import, then
//   `git gc` and `git gc --aggressive` are run and .git is measured.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../../src/config.js';
import { applyRun, isoSeconds } from '../../src/state.js';
import { serializeData, isValidStoredData, DataSizeError, MAX_TOTAL_BYTES, MAX_HEADER_BYTES, MAX_RECORD_BYTES } from '../../src/datastore.js';
import { REASON, httpReason } from '../../src/reasons.js';

if (process.env.NODE_TEST_CONTEXT) {
  console.log('history-growth simulation: skipped under node --test (run it directly).');
  process.exit(0);
}

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const k = argv.indexOf(`--${name}`);
  return k === -1 ? def : argv[k + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const DAYS = Number(opt('days', 365));
const RUNS_PER_DAY = Number(opt('runs-per-day', 96));
const N_TARGETS = Number(opt('targets', 20));
const SEED = Number(opt('seed', 14));
const DO_GIT = !flag('no-git');
const KEEP = flag('keep');
const ONE_MB = 1024 * 1024;
const ARCH_BOUND = 79104; // architecture §7: 20 x (90 x 32 + 1,024) + 1,024

// ---------- deterministic PRNG (mulberry32) ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const WORKFLOW = 'on:\n  schedule:\n    - cron: "7,22,37,52 * * * *"\n';

// ---------- inputs ----------
// Name: 50 characters (MAX_NAME_CHARS) of the most bytes per character that
// still round-trips through the stored-data validator. A 4-byte emoji is 4 B
// raw in JSON; a quote is 2 B escaped. Emoji is the larger one.
function maxName(k) {
  const tag = String(k).padStart(2, '0'); // unique per target
  return '😀'.repeat(48) + tag;
}
// URL: exactly 500 characters that URL normalization leaves unchanged, so the
// stored href is also 500 characters (the stored validator's limit).
function maxUrl(k) {
  const head = `https://t${String(k).padStart(2, '0')}.example.com/`;
  return head + 'a'.repeat(500 - head.length);
}

function buildConfig(targets, header = {}) {
  return JSON.stringify({ ...header, targets });
}

// ---------- phase 1: bounds ----------
function tryScenario(label, header, targets, override = {}) {
  const cfg = parseConfig(buildConfig(targets, header), WORKFLOW);
  if (!cfg.ok) return { label, configOk: false, detail: cfg.errors.map((e) => e.reason).join(' | ') };
  const now = new Date('2026-01-01T00:07:00Z');
  const results = cfg.targets.map((t) => ({
    name: t.name, url: t.url, up: false, reason: override.reason ?? REASON.tooManyRedirects, checkedAt: isoSeconds(now),
  }));
  const { data } = applyRun(null, results, { settings: cfg.settings, configErrorCount: 0, repo: 'a-very-long-owner-name-123456789/a-long-repository-name-for-testing-limits' }, now);
  for (const t of data.targets) {
    t.issue = override.issue ?? 2147483647;
    t.outageStartedAt = isoSeconds(now);
  }
  const { targets: ts, ...hdr } = data;
  const recordMax = Math.max(...ts.map(({ days, ...r }) => bytes(r)));
  let text;
  try {
    text = serializeData(data);
  } catch (e) {
    if (!(e instanceof DataSizeError)) throw e;
    return { label, configOk: true, headerBytes: bytes(hdr), recordMax, serialize: `THROWS: ${e.message}`, readBack: 'n/a', hrefChars: Math.max(...ts.map((t) => [...t.url].length)) };
  }
  const readBack = isValidStoredData(JSON.parse(text));
  return { label, configOk: true, headerBytes: bytes(hdr), recordMax, serialize: `ok ${text.length} B`, readBack: readBack ? 'valid' : 'REJECTED (readData would start fresh)', hrefChars: Math.max(...ts.map((t) => [...t.url].length)) };
}

function phaseBounds() {
  const twenty = (fn) => Array.from({ length: 20 }, (_, k) => fn(k));
  const base = 'https://example.com/';
  const asciiHeader = { siteName: 'S'.repeat(60), contact: 'c'.repeat(200), contactLink: `https://example.com/${'c'.repeat(480)}` };
  const scenarios = [
    ['A. 20 x (emoji name 50ch, ASCII url 500ch), no header text', {}, twenty((k) => ({ name: maxName(k), url: maxUrl(k) }))],
    ['B. A + ASCII header maxima (siteName 60, contact 200, contactLink 500)', asciiHeader, twenty((k) => ({ name: maxName(k), url: maxUrl(k) }))],
    ['C. A + multibyte header (siteName 60 emoji, contact 200 emoji)', { siteName: '😀'.repeat(60), contact: '😀'.repeat(200) }, twenty((k) => ({ name: maxName(k), url: maxUrl(k) }))],
    ['D. multibyte header + contactLink 500ch', { siteName: '😀'.repeat(60), contact: '😀'.repeat(200), contactLink: `https://example.com/${'c'.repeat(480)}` }, [{ name: 'A', url: base }]],
    ['E. url 500ch with 150 quote chars (href grows to %22)', {}, [{ name: 'A', url: base + '"'.repeat(150) + 'a'.repeat(500 - base.length - 150) }]],
    ['F. url 500ch with spaces (href grows to %20)', {}, [{ name: 'A', url: base + 'a b'.repeat(160) }]],
    ['G. url 500ch of emoji path (href grows to %F0%9F...)', {}, [{ name: 'A', url: base + '😀'.repeat(500 - base.length) }]],
    ['H. url 470ch ASCII + 10 quotes (href 500 -> 520)', {}, [{ name: 'A', url: base + '"'.repeat(10) + 'a'.repeat(500 - base.length - 10) }]],
    // Lone surrogates are 1 code point each but 6 B each once JSON.stringify escapes them.
    ['I. lone-surrogate header (siteName 60, contact 200) + contactLink 500ch + names 50', { siteName: '\ud800'.repeat(60), contact: '\ud800'.repeat(200), contactLink: `https://example.com/${'c'.repeat(480)}` }, twenty((k) => ({ name: '\ud800'.repeat(48) + String(k).padStart(2, '0'), url: maxUrl(k) }))],
  ];
  return scenarios.map(([label, header, targets]) => tryScenario(label, header, targets));
}

// ---------- phase 2: year ----------
function* runTimes(start) {
  // cron 7,22,37,52 with 0-9 min scheduler delay and a few seconds of run time
  const r = rng(SEED + 1);
  for (let d = 0; d < DAYS; d++) {
    for (let k = 0; k < RUNS_PER_DAY; k++) {
      const slot = start + d * 86400000 + Math.floor((k * 1440) / RUNS_PER_DAY) * 60000 + 7 * 60000;
      yield new Date(slot + Math.floor(r() * 9 * 60000));
    }
  }
}

async function phaseYear(sink) {
  const targets = Array.from({ length: N_TARGETS }, (_, k) => ({ name: maxName(k), url: maxUrl(k) }));
  // The largest header (in bytes) that the writer accepts: multibyte first,
  // falling back to the all-ASCII maxima if the header assert refuses it.
  const link = `https://example.com/${'c'.repeat(480)}`;
  const headers = [
    { siteName: '😀'.repeat(60), contact: '😀'.repeat(200), contactLink: link },
    { siteName: 'S'.repeat(60), contact: 'c'.repeat(200), contactLink: link },
  ];
  const header = headers.find((h) => tryScenario('', h, targets).serialize?.startsWith('ok')) ?? {};
  const cfg = parseConfig(buildConfig(targets, header), WORKFLOW);
  if (!cfg.ok) throw new Error(`year config invalid: ${JSON.stringify(cfg.errors)}`);
  if (cfg.targets.some((t) => t.url.length !== 500)) throw new Error('url normalization changed the max-length URL');

  const r = rng(SEED);
  const failReasons = [REASON.timeout, REASON.dns, REASON.tls, REASON.connection, REASON.tooManyRedirects, httpReason(503), httpReason(404)];
  // Per target: remaining outage runs and its reason
  const outage = cfg.targets.map(() => ({ left: 0, reason: null }));
  const issueOf = new Map();
  let nextIssue = 1000;
  let prev = null;
  let runs = 0;
  let maxSize = 0;
  let maxSizeAt = null;
  let sumSize = 0;
  let opens = 0;
  let recovers = 0;
  let maxDays = 0;
  const checkpoints = {};
  const t0 = Date.now();
  const start = Date.parse('2026-01-01T00:00:00Z');

  for (const now of runTimes(start)) {
    const results = cfg.targets.map((t, k) => {
      const o = outage[k];
      if (o.left === 0 && r() < 0.0015) {
        // ~5 outages per target per year; lengths from 1 run to ~2 days
        o.left = 1 + Math.floor(r() ** 3 * 192);
        o.reason = failReasons[Math.floor(r() * failReasons.length)];
      }
      const up = o.left === 0;
      if (!up) o.left -= 1;
      return { name: t.name, url: t.url, up, reason: up ? null : o.reason, checkedAt: isoSeconds(new Date(now.getTime() + 1000 + Math.floor(r() * 9000))) };
    });
    // The bot's open issues; a person closes one about 10% of the time (A7)
    const open = new Set([...issueOf.values()].filter((n) => r() > 0.0005));
    const { data, actions } = applyRun(prev, results, { settings: cfg.settings, configErrorCount: 0, repo: 'gnosh-sim/uptime', openIssueNumbers: open }, now);
    for (const a of actions) {
      if (a.type === 'open') {
        data.targets[a.index].issue = ++nextIssue;
        issueOf.set(a.name, nextIssue);
        opens++;
      } else if (a.type === 'recover') {
        issueOf.delete(a.name);
        recovers++;
      }
    }
    const text = serializeData(data); // throws DataSizeError over the asserts
    const size = Buffer.byteLength(text, 'utf8');
    if (size >= ONE_MB) throw new Error(`AC-D3 FAIL: status.json is ${size} B at ${now.toISOString()}`);
    const back = JSON.parse(text);
    if (!isValidStoredData(back)) throw new Error(`stored data rejected by isValidStoredData at ${now.toISOString()}`);
    prev = back;
    runs++;
    sumSize += size;
    if (size > maxSize) {
      maxSize = size;
      maxSizeAt = isoSeconds(now);
    }
    maxDays = Math.max(maxDays, ...back.targets.map((t) => t.days.length));
    const day = Math.floor(runs / RUNS_PER_DAY);
    if (runs % RUNS_PER_DAY === 0 && [1, 30, 90, 180, 365].includes(day)) checkpoints[day] = size;
    if (sink) await sink(text, now);
    if (runs % (RUNS_PER_DAY * 30) === 0) process.stderr.write(`  day ${day}: ${size} B, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  const last = prev;
  const { targets: lt, ...lh } = last;
  return {
    runs,
    finalSize: Buffer.byteLength(JSON.stringify(last), 'utf8'),
    maxSize,
    maxSizeAt,
    meanSize: Math.round(sumSize / runs),
    checkpoints,
    headerBytes: bytes(lh),
    recordMax: Math.max(...lt.map(({ days, ...rr }) => bytes(rr))),
    dayTupleMax: Math.max(...lt.flatMap((t) => t.days.map((d) => bytes(d) + 1))),
    maxDays,
    opens,
    recovers,
    seconds: (Date.now() - t0) / 1000,
  };
}

// ---------- git ----------
function duBytes(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += duBytes(p);
    else total += statSync(p).size;
  }
  return total;
}
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });

function startFastImport(dir) {
  const child = spawn('git', ['-C', dir, 'fast-import', '--quiet', '--done'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => child.on('exit', (c) => (c === 0 ? res() : rej(new Error(`fast-import exit ${c}`)))));
  let first = true;
  let mark = 0;
  const write = (s) => (child.stdin.write(s) ? null : new Promise((res) => child.stdin.once('drain', res)));
  const sink = async (text, now) => {
    const ts = Math.floor(now.getTime() / 1000);
    const msg = `data: run ${isoSeconds(now)}`;
    const body = Buffer.from(text, 'utf8');
    const parts = [
      `commit refs/heads/monitor-data\nmark :${++mark}\n`,
      `committer github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> ${ts} +0000\n`,
      `data ${Buffer.byteLength(msg)}\n${msg}\n`,
      first ? '' : `from :${mark - 1}\n`,
      `M 100644 inline status.json\ndata ${body.length}\n`,
    ];
    first = false;
    const p1 = write(parts.join(''));
    if (p1) await p1;
    const p2 = write(body);
    if (p2) await p2;
    const p3 = write('\n');
    if (p3) await p3;
  };
  const finish = async () => {
    child.stdin.end('done\n');
    await done;
  };
  return { sink, finish };
}

function measure(dir, label) {
  const co = git(dir, 'count-objects', '-v');
  const kv = Object.fromEntries(co.trim().split('\n').map((l) => l.split(': ')));
  return { label, gitDirBytes: duBytes(join(dir, '.git')), packBytes: Number(kv['size-pack']) * 1024, looseBytes: Number(kv.size) * 1024, count: Number(kv.count), inPack: Number(kv['in-pack']) };
}

// ---------- main ----------
const fmt = (n) => n.toLocaleString('en-US');
console.log(`T14 history-growth simulation  node ${process.version}  ${execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()}`);
console.log(`days=${DAYS} runs/day=${RUNS_PER_DAY} targets=${N_TARGETS} seed=${SEED} git=${DO_GIT}\n`);

console.log('Phase 1: D3 bounds with worst-case config-valid inputs');
for (const s of phaseBounds()) {
  if (!s.configOk) console.log(`  ${s.label}\n    config rejected: ${s.detail}`);
  else console.log(`  ${s.label}\n    header ${fmt(s.headerBytes)} B, largest record ${fmt(s.recordMax)} B, longest stored url ${s.hrefChars} ch, serialize: ${s.serialize}, read back: ${s.readBack}`);
}

let dir = null;
let fi = null;
if (DO_GIT) {
  dir = mkdtempSync(join(opt('dir', null) ?? tmpdir(), 't14-sim-'));
  git(dir, 'init', '--quiet', '-b', 'monitor-data');
  fi = startFastImport(dir);
}

console.log(`\nPhase 2: ${fmt(DAYS * RUNS_PER_DAY)} runs`);
const y = await phaseYear(fi?.sink);
if (fi) await fi.finish();
console.log(`  runs: ${fmt(y.runs)} in ${y.seconds.toFixed(1)} s; outage issues opened ${y.opens}, recovered ${y.recovers}`);
console.log(`  status.json final ${fmt(y.finalSize)} B, max ${fmt(y.maxSize)} B (at ${y.maxSizeAt}), mean ${fmt(y.meanSize)} B`);
console.log(`  size at day ${Object.entries(y.checkpoints).map(([d, s]) => `${d}: ${fmt(s)} B`).join(', ')}`);
console.log(`  header ${fmt(y.headerBytes)} B (budget ${fmt(MAX_HEADER_BYTES)}), largest target record ${fmt(y.recordMax)} B (budget ${fmt(MAX_RECORD_BYTES)}), largest day tuple incl. comma ${y.dayTupleMax} B (budget 32), max days kept ${y.maxDays} (budget 90)`);
console.log(`  architecture worst case ${fmt(ARCH_BOUND)} B; writer cap ${fmt(MAX_TOTAL_BYTES)} B; AC-D3 limit ${fmt(ONE_MB)} B`);
const d3 = y.maxSize < ONE_MB;
console.log(`  AC-D3 current tree < 1 MB: ${d3 ? 'PASS' : 'FAIL'} (margin x${(ONE_MB / y.maxSize).toFixed(1)})`);

if (DO_GIT) {
  console.log(`\nGit (scratch repo ${dir}, branch monitor-data, no remote)`);
  const commits = Number(git(dir, 'rev-list', '--count', 'monitor-data').trim());
  console.log(`  commits: ${fmt(commits)}`);
  const rows = [measure(dir, 'after fast-import')];
  let t = Date.now();
  git(dir, 'gc', '--quiet', '--prune=now');
  rows.push({ ...measure(dir, 'after git gc'), s: (Date.now() - t) / 1000 });
  t = Date.now();
  git(dir, 'gc', '--aggressive', '--quiet', '--prune=now');
  rows.push({ ...measure(dir, 'after git gc --aggressive'), s: (Date.now() - t) / 1000 });
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(28)} .git ${fmt(r.gitDirBytes).padStart(13)} B (${(r.gitDirBytes / ONE_MB).toFixed(2)} MiB), pack ${fmt(r.packBytes)} B, loose ${fmt(r.looseBytes)} B${r.s ? `, took ${r.s.toFixed(1)} s` : ''}`);
  }
  const fin = rows[rows.length - 1].gitDirBytes;
  console.log(`  per commit after aggressive gc: ${(fin / commits).toFixed(1)} B; raw blob bytes written: ${fmt(y.meanSize * y.runs)} B`);
  const fsck = execFileSync('git', ['-C', dir, 'fsck', '--no-progress'], { encoding: 'utf8' });
  console.log(`  git fsck: ${fsck.trim() === '' ? 'clean' : fsck.trim()}`);
  if (!KEEP) rmSync(dir, { recursive: true, force: true });
  else console.log(`  kept at ${dir}`);
}
process.exitCode = d3 ? 0 : 1;
