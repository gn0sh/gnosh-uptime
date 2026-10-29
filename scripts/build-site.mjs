#!/usr/bin/env node
// Builds the page shell: copies site/ to _site/ and fills the <meta> tags
// (architecture §2, §10; T13). Usage: GITHUB_REPOSITORY=owner/repo node scripts/build-site.mjs
//
// - The data URL and repo come only from GITHUB_REPOSITORY (a GitHub-provided
//   value), validated before use (threat model F10).
// - siteName, contact and contactLink come from monitor.config.json, are
//   validated by the same parseConfig the monitor uses, and are written only
//   through site/meta-inject.js (attribute-escaped, threat model F2). A
//   problem in one of those settings fails the build.
// - Test files, fixtures and build-only helpers are not published.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { injectMeta } from '../site/meta-inject.js';
import { parseConfig, CONFIG_PATH, WORKFLOW_PATH } from '../src/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_SETTINGS = ['siteName', 'contact', 'contactLink'];
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Throws unless repo is a plain "owner/name" as GitHub allows them. */
export function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new Error('GITHUB_REPOSITORY must look like "owner/repo" (letters, digits, "-", "_", ".").');
  }
  const name = repo.split('/')[1];
  if (name === '.' || name === '..') throw new Error('GITHUB_REPOSITORY has an invalid repo name.');
  return repo;
}

export function dataUrlFor(repo) {
  return `https://raw.githubusercontent.com/${validateRepo(repo)}/monitor-data/status.json`;
}

/** True for site/ entries that must not be published. `rel` uses "/" separators. */
export function isExcluded(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'fixtures') return true;
  const file = parts[parts.length - 1];
  return file.endsWith('.test.js') || file === 'meta-inject.js' || file.startsWith('.');
}

/**
 * Page settings from the config text. Throws if the config can't be read or
 * a page setting is invalid (the page would otherwise silently lose it).
 */
export function pageSettings(configText, workflowText = null) {
  const cfg = parseConfig(configText, workflowText);
  if (!cfg.parsed) {
    const why = cfg.errors.map((e) => e.reason).join(' ');
    throw new Error(`${CONFIG_PATH} could not be read, so the page can't be built. ${why}`);
  }
  const bad = cfg.errors.filter((e) => PAGE_SETTINGS.some((k) => e.entry === `Setting "${k}"`));
  if (bad.length) throw new Error(bad.map((e) => `${e.entry}: ${e.reason}`).join('\n'));
  const out = {};
  for (const k of PAGE_SETTINGS) out[k] = cfg.settings[k] ?? null;
  return out;
}

function listFiles(dir, base = dir) {
  const files = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    const rel = relative(base, abs).split(sep).join('/');
    if (isExcluded(rel)) continue;
    if (ent.isDirectory()) files.push(...listFiles(abs, base));
    else if (ent.isFile()) files.push(rel);
    // symlinks and other types are skipped on purpose
  }
  return files;
}

/**
 * @param {{repo:string, root?:string, siteDir?:string, outDir?:string,
 *          configText?:string|null, workflowText?:string|null}} opts
 * @returns {{outDir:string, files:string[]}}
 */
export function buildSite(opts) {
  const root = opts.root ?? ROOT;
  const siteDir = resolve(root, opts.siteDir ?? 'site');
  const outDir = resolve(root, opts.outDir ?? '_site');
  const repo = validateRepo(opts.repo);

  // Refuse to wipe anything that isn't a subfolder of root, or the source itself.
  const relOut = relative(root, outDir);
  if (!relOut || relOut.startsWith('..') || resolve(outDir) === siteDir || siteDir.startsWith(outDir + sep)) {
    throw new Error(`Refusing to build into ${outDir}`);
  }

  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const configText = opts.configText !== undefined ? opts.configText : read(CONFIG_PATH);
  const workflowText = opts.workflowText !== undefined ? opts.workflowText : read(WORKFLOW_PATH);
  const settings = pageSettings(configText, workflowText);

  const files = listFiles(siteDir);
  if (!files.includes('index.html')) throw new Error(`${siteDir} has no index.html`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const rel of files) {
    const dest = join(outDir, ...rel.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    if (rel === 'index.html') continue;
    cpSync(join(siteDir, ...rel.split('/')), dest);
  }
  const html = injectMeta(readFileSync(join(siteDir, 'index.html'), 'utf8'), {
    dataUrl: dataUrlFor(repo),
    repo,
    ...settings,
  });
  writeFileSync(join(outDir, 'index.html'), html);
  // No .nojekyll: Pages deployed from Actions artifacts are not run through Jekyll.
  return { outDir, files: files.sort() };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { outDir, files } = buildSite({ repo: process.env.GITHUB_REPOSITORY });
    process.stdout.write(`Built ${basename(outDir)}/ with ${files.length} files: ${files.join(', ')}\n`);
  } catch (e) {
    process.stderr.write(`Page build failed: ${e.message}\n`);
    process.exit(1);
  }
}
