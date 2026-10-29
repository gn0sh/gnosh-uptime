#!/usr/bin/env node
// CI-only accessibility check (AC-P10, design "zero serious or critical
// violations in every state fixture"). Used by validate.yml's a11y job only.
//
// For each site/fixtures/*.json (plus a "load-error" case) it builds a copy of
// the page whose data URL is
//   https://raw.githubusercontent.com/a11y/<fixture>/monitor-data/status.json
// and runs axe in headless Chrome with that host mapped to a local HTTPS
// server (throwaway certificate). So the page is tested exactly as built,
// CSP included, against fixture data. Fixture times are moved to "now" so
// fresh fixtures stay fresh and the stale fixture stays stale.
//
// Env: A11Y_KEY, A11Y_CERT (PEM paths), optional AXE_BIN, CHROMEWEBDRIVER.

import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSite } from './build-site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'site', 'fixtures');
const OUT = join(ROOT, '_a11y');
/** The "now" the fixtures were written for (site/render.test.js). */
export const FIXTURE_NOW_MS = Date.parse('2026-10-28T14:12:00Z');
const DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAIL_IMPACTS = new Set(['serious', 'critical']);
export const LOAD_ERROR = 'load-error';

/** Moves every timestamp by (nowMs - FIXTURE_NOW_MS) and every day by the matching number of UTC days. */
export function shiftFixture(value, nowMs) {
  const delta = nowMs - FIXTURE_NOW_MS;
  const days = Math.round((Math.floor(nowMs / DAY) - Math.floor(FIXTURE_NOW_MS / DAY)));
  const walk = (v) => {
    if (typeof v === 'string') {
      if (ISO_RE.test(v)) return new Date(Date.parse(v) + delta).toISOString().replace('.000Z', 'Z');
      if (DATE_RE.test(v)) return new Date(Date.parse(`${v}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

export function fixtureNames(dir = FIXTURES) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

/** Maps a raw-host request path to a fixture name, or null. */
export function fixtureForPath(path) {
  const m = /^\/a11y\/([a-z0-9-]+)\/monitor-data\/status\.json$/.exec(path);
  return m ? m[1] : null;
}

/** Fails on serious or critical violations. Returns {failed, lines}. */
export function summarize(results) {
  const lines = [];
  let failed = false;
  for (const r of results) {
    const bad = r.violations.filter((v) => FAIL_IMPACTS.has(v.impact));
    if (bad.length) failed = true;
    lines.push(`${bad.length ? 'FAIL' : 'ok  '} ${r.url}: ${r.violations.length} violation(s), ${bad.length} serious/critical`);
    for (const v of r.violations) lines.push(`     - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
  }
  if (results.length === 0) { failed = true; lines.push('FAIL no axe results'); }
  return { failed, lines };
}

/**
 * Review R6: a clean axe run means nothing if the page never reached the
 * fixture server (CSP, certificate, host mapping or CORS problem), because
 * then every copy shows the load-error page. Every fixture, including the
 * 404 load-error case, must have been requested at least once.
 */
export function missingFetches(names, hits) {
  return names.filter((n) => !(hits.get(n) > 0));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function listen(server) {
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
}

async function main() {
  const nowMs = Date.now();
  const names = [...fixtureNames(), LOAD_ERROR];
  rmSync(OUT, { recursive: true, force: true });
  for (const n of names) buildSite({ repo: `a11y/${n}`, outDir: join('_a11y', 'site', n) });
  const siteRoot = join(OUT, 'site');

  const pageServer = createHttp((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(siteRoot, `.${path}`);
    if (path.endsWith('/')) file = join(file, 'index.html');
    if (!file.startsWith(siteRoot + sep) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  const hits = new Map();
  const dataServer = createHttps({ key: readFileSync(process.env.A11Y_KEY), cert: readFileSync(process.env.A11Y_CERT) }, (req, res) => {
    const name = fixtureForPath(new URL(req.url, 'https://x').pathname);
    if (name) hits.set(name, (hits.get(name) ?? 0) + 1);
    const cors = { 'access-control-allow-origin': '*' };
    if (!name || name === LOAD_ERROR || !existsSync(join(FIXTURES, `${name}.json`))) { res.writeHead(404, cors).end(); return; }
    const body = JSON.stringify(shiftFixture(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')), nowMs));
    res.writeHead(200, { ...cors, 'content-type': 'text/plain; charset=utf-8' }).end(body);
  });
  const pagePort = await listen(pageServer);
  const dataPort = await listen(dataServer);

  const axe = process.env.AXE_BIN ?? join(ROOT, 'tools', 'a11y', 'node_modules', '.bin', 'axe');
  const driver = process.env.CHROMEWEBDRIVER ? join(process.env.CHROMEWEBDRIVER, 'chromedriver') : 'chromedriver';
  const resultsDir = join(OUT, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const args = [
    ...names.map((n) => `http://127.0.0.1:${pagePort}/${n}/`),
    '--chromedriver-path', driver,
    '--chrome-options', `host-resolver-rules=MAP raw.githubusercontent.com:443 127.0.0.1:${dataPort};ignore-certificate-errors;no-sandbox`,
    '--load-delay', '3000',
    '--dir', resultsDir, '--save', 'results.json',
  ];
  const code = await new Promise((ok) => spawn(axe, args, { stdio: 'inherit' }).on('close', ok).on('error', (e) => { console.error(e.message); ok(2); }));
  pageServer.close();
  dataServer.close();
  if (code !== 0) { console.error(`axe exited with ${code}`); process.exit(1); }

  const results = JSON.parse(readFileSync(join(resultsDir, 'results.json'), 'utf8'));
  const { failed, lines } = summarize(Array.isArray(results) ? results : [results]);
  console.log(lines.join('\n'));
  const missing = missingFetches(names, hits);
  if (missing.length) {
    console.error(`FAIL the page never fetched data for: ${missing.join(', ')}. axe tested the load-error page instead.`);
    process.exit(1);
  }
  console.log(`Data fetched for all ${names.length} cases.`);
  if (failed) process.exit(1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
